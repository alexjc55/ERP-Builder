#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const API_DIR = path.join("artifacts", "api-server");
const LOCK_RUNNER = "../../scripts/with-validation-lock.sh";
const PAGE_TEST = "src/routes/page-select-status-sync.db.test.ts";
const RELEASE_SCRIPT =
  "pnpm run typecheck && pnpm run validate:page-select-status-sync && pnpm --filter @workspace/db run generate";
const DB_COMMAND_FORMAT =
  /^bash \.\.\/\.\.\/scripts\/with-validation-lock\.sh tsx --test --test-concurrency=1 (src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.db\.test\.ts)$/;
const PAGE_SELECT_WRAPPER = `#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

node scripts/check-db-test-wiring.mjs
corepack pnpm --filter @workspace/api-server run test:page-select-status-db
`;

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function findTestFiles(directory, relativeTo) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findTestFiles(absolute, relativeTo)));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      found.push(path.relative(relativeTo, absolute).split(path.sep).join("/"));
    }
  }
  return found.sort();
}

const MUTATION_METHODS = new Set(["insert", "update", "delete"]);
const MUTATING_SQL_COMMANDS = new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "replace",
  "create",
  "alter",
  "drop",
  "truncate",
  "grant",
  "revoke",
  "comment",
  "vacuum",
  "reindex",
  "cluster",
]);
const SQL_COMMANDS = new Set([
  ...MUTATING_SQL_COMMANDS,
  "select",
  "values",
  "show",
  "explain",
]);

function symbolAt(checker, node) {
  return node && checker.getSymbolAtLocation(node);
}

function unwrapExpression(expression) {
  while (
    expression &&
    (ts.isParenthesizedExpression(expression) ||
      ts.isAwaitExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isSatisfiesExpression(expression))
  ) {
    expression = expression.expression;
  }
  return expression;
}

function propertyParts(expression) {
  expression = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(expression)) {
    return { receiver: expression.expression, name: expression.name.text };
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    (ts.isStringLiteral(expression.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression))
  ) {
    return {
      receiver: expression.expression,
      name: expression.argumentExpression.text,
    };
  }
  return undefined;
}

function bindingPropertyName(element) {
  const name = element.propertyName ?? element.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function sqlText(expression) {
  expression = unwrapExpression(expression);
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }
  if (ts.isTemplateExpression(expression)) {
    return (
      expression.head.text +
      expression.templateSpans
        .map((span) => ` ${span.literal.text}`)
        .join("")
    );
  }
  if (ts.isTaggedTemplateExpression(expression)) {
    return sqlText(expression.template);
  }
  if (ts.isCallExpression(expression)) {
    const property = propertyParts(expression.expression);
    if (property?.name === "raw" && expression.arguments[0]) {
      return sqlText(expression.arguments[0]);
    }
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = sqlText(expression.left);
    const right = sqlText(expression.right);
    return left === undefined || right === undefined
      ? undefined
      : `${left} ${right}`;
  }
  return undefined;
}

function tokenizeSql(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (text.startsWith("--", index)) {
      const newline = text.indexOf("\n", index + 2);
      index = newline === -1 ? text.length : newline + 1;
      continue;
    }
    if (text.startsWith("/*", index)) {
      let commentDepth = 1;
      index += 2;
      while (index < text.length && commentDepth > 0) {
        if (text.startsWith("/*", index)) {
          commentDepth += 1;
          index += 2;
        } else if (text.startsWith("*/", index)) {
          commentDepth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      continue;
    }
    if (character === "'" || character === '"') {
      const quote = character;
      index += 1;
      while (index < text.length) {
        if (text[index] === quote && text[index + 1] === quote) {
          index += 2;
        } else if (text[index] === quote) {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }
    if (character === "$") {
      const delimiter = text.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (delimiter) {
        const end = text.indexOf(delimiter, index + delimiter.length);
        index = end === -1 ? text.length : end + delimiter.length;
        continue;
      }
    }
    if (character === "(" || character === ")" || character === ";") {
      tokens.push(character);
      index += 1;
      continue;
    }
    const word = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/)?.[0];
    if (word) {
      tokens.push(word.toLowerCase());
      index += word.length;
      continue;
    }
    index += 1;
  }
  return tokens;
}

function tokenGroupMutates(tokens) {
  const groups = [];
  const segments = [[]];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "(") {
      const precededBy = segments.at(-1).at(-1);
      const groupStart = index + 1;
      let groupDepth = 1;
      while (index + 1 < tokens.length && groupDepth > 0) {
        index += 1;
        if (tokens[index] === "(") groupDepth += 1;
        if (tokens[index] === ")") groupDepth -= 1;
      }
      groups.push({ precededBy, tokens: tokens.slice(groupStart, index) });
    } else if (tokens[index] === ";") {
      segments.push([]);
    } else if (tokens[index] !== ")") {
      segments.at(-1).push(tokens[index]);
    }
  }
  for (const segment of segments) {
    const command = segment.find((token) => SQL_COMMANDS.has(token));
    if (command && MUTATING_SQL_COMMANDS.has(command)) return true;
  }
  return groups.some(
    (group) =>
      (group.precededBy === "as" ||
        group.precededBy === "materialized" ||
        group.tokens[0] === "with") &&
      tokenGroupMutates(group.tokens),
  );
}

function isMutatingSql(expression) {
  const text = sqlText(expression);
  if (text === undefined) return false;
  return tokenGroupMutates(tokenizeSql(text));
}

function findDbMutations(absoluteFile) {
  const program = ts.createProgram([absoluteFile], {
    allowJs: false,
    noEmit: true,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  });
  const source = program.getSourceFile(absoluteFile);
  if (!source) return [];
  const checker = program.getTypeChecker();
  const dbSymbols = new Set();
  const poolSymbols = new Set();
  const clientSymbols = new Set();
  const namespaceSymbols = new Set();
  const txSymbols = new Set();
  const functionAliases = new Map();
  const nodes = [];

  function walk(node) {
    nodes.push(node);
    ts.forEachChild(node, walk);
  }
  walk(source);

  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@workspace/db" ||
      statement.importClause?.isTypeOnly
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      const symbol = symbolAt(checker, bindings.name);
      if (symbol) namespaceSymbols.add(symbol);
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly && (element.propertyName ?? element.name).text === "db") {
          const symbol = symbolAt(checker, element.name);
          if (symbol) dbSymbols.add(symbol);
        } else if (
          !element.isTypeOnly &&
          (element.propertyName ?? element.name).text === "pool"
        ) {
          const symbol = symbolAt(checker, element.name);
          if (symbol) poolSymbols.add(symbol);
        }
      }
    }
  }

  const hasSymbol = (set, node) => set.has(symbolAt(checker, unwrapExpression(node)));
  const isWorkspaceDbImport = (node) => {
    node = unwrapExpression(node);
    return (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "@workspace/db"
    );
  };
  const isNamespace = (node) => hasSymbol(namespaceSymbols, node);
  const isDb = (node) => {
    node = unwrapExpression(node);
    if (hasSymbol(dbSymbols, node)) return true;
    const property = propertyParts(node);
    return property?.name === "db" && isNamespace(property.receiver);
  };
  const isPool = (node) => {
    node = unwrapExpression(node);
    if (hasSymbol(poolSymbols, node)) return true;
    const property = propertyParts(node);
    return property?.name === "pool" && isNamespace(property.receiver);
  };
  const isClient = (node) => hasSymbol(clientSymbols, node);
  const isTx = (node) => hasSymbol(txSymbols, node);
  const addIdentifierSymbol = (set, node) => {
    if (!ts.isIdentifier(node)) return false;
    const symbol = symbolAt(checker, node);
    if (!symbol || set.has(symbol)) return false;
    set.add(symbol);
    return true;
  };

  function trackBinding(name, initializer) {
    if (ts.isIdentifier(name)) {
      if (isNamespace(initializer) || isWorkspaceDbImport(initializer)) {
        return addIdentifierSymbol(namespaceSymbols, name);
      }
      if (isDb(initializer)) return addIdentifierSymbol(dbSymbols, name);
      if (isPool(initializer)) return addIdentifierSymbol(poolSymbols, name);
      if (isClient(initializer)) return addIdentifierSymbol(clientSymbols, name);
      if (isTx(initializer)) return addIdentifierSymbol(txSymbols, name);
      const property = propertyParts(initializer);
      if (
        ts.isCallExpression(unwrapExpression(initializer)) &&
        propertyParts(unwrapExpression(initializer).expression)?.name === "connect" &&
        isPool(propertyParts(unwrapExpression(initializer).expression).receiver)
      ) {
        return addIdentifierSymbol(clientSymbols, name);
      }
      if (
        property &&
        (MUTATION_METHODS.has(property.name) ||
          property.name === "execute" ||
          property.name === "query") &&
        (isDb(property.receiver) ||
          isTx(property.receiver) ||
          ((isPool(property.receiver) || isClient(property.receiver)) &&
            property.name === "query"))
      ) {
        const symbol = symbolAt(checker, name);
        if (symbol && !functionAliases.has(symbol)) {
          functionAliases.set(symbol, property.name);
          return true;
        }
      }
      return false;
    }
    if (!ts.isObjectBindingPattern(name)) return false;
    let changed = false;
    for (const element of name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const propertyName = bindingPropertyName(element);
      if (
        (isNamespace(initializer) || isWorkspaceDbImport(initializer)) &&
        propertyName === "db"
      ) {
        changed = addIdentifierSymbol(dbSymbols, element.name) || changed;
      } else if (
        (isNamespace(initializer) || isWorkspaceDbImport(initializer)) &&
        propertyName === "pool"
      ) {
        changed = addIdentifierSymbol(poolSymbols, element.name) || changed;
      } else if (
        (isDb(initializer) || isTx(initializer)) &&
        propertyName &&
        (MUTATION_METHODS.has(propertyName) || propertyName === "execute")
      ) {
        const symbol = symbolAt(checker, element.name);
        if (symbol && !functionAliases.has(symbol)) {
          functionAliases.set(symbol, propertyName);
          changed = true;
        }
      }
    }
    return changed;
  }

  function transactionCallback(call) {
    const property = propertyParts(call.expression);
    if (
      property?.name !== "transaction" ||
      (!isDb(property.receiver) && !isTx(property.receiver))
    ) {
      return undefined;
    }
    const callback = unwrapExpression(call.arguments[0]);
    if (
      callback &&
      (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
    ) {
      return callback;
    }
    if (callback && ts.isIdentifier(callback)) {
      const declaration = symbolAt(checker, callback)?.declarations?.find(
        (item) =>
          ts.isFunctionDeclaration(item) ||
          ts.isFunctionExpression(item) ||
          ts.isArrowFunction(item) ||
          (ts.isVariableDeclaration(item) &&
            item.initializer &&
            (ts.isFunctionExpression(unwrapExpression(item.initializer)) ||
              ts.isArrowFunction(unwrapExpression(item.initializer)))),
      );
      if (declaration && ts.isVariableDeclaration(declaration)) {
        return unwrapExpression(declaration.initializer);
      }
      return declaration;
    }
    return undefined;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        changed = trackBinding(node.name, node.initializer) || changed;
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        changed = trackBinding(node.left, node.right) || changed;
      } else if (ts.isCallExpression(node)) {
        const callback = transactionCallback(node);
        const parameter = callback?.parameters[0]?.name;
        if (parameter) {
          changed = addIdentifierSymbol(txSymbols, parameter) || changed;
        }
      }
    }
  }

  const mutations = [];
  for (const node of nodes) {
    if (!ts.isCallExpression(node)) continue;
    const calledSymbol = symbolAt(checker, unwrapExpression(node.expression));
    const aliasMethod = calledSymbol && functionAliases.get(calledSymbol);
    if (
      aliasMethod &&
      (MUTATION_METHODS.has(aliasMethod) ||
        ((aliasMethod === "execute" || aliasMethod === "query") &&
          node.arguments[0] &&
          isMutatingSql(node.arguments[0])))
    ) {
      mutations.push(node);
      continue;
    }
    const property = propertyParts(node.expression);
    if (
      !property ||
      (!isDb(property.receiver) &&
        !isTx(property.receiver) &&
        !isPool(property.receiver) &&
        !isClient(property.receiver))
    ) {
      continue;
    }
    if (
      ((isDb(property.receiver) || isTx(property.receiver)) &&
        MUTATION_METHODS.has(property.name)) ||
      ((property.name === "execute" || property.name === "query") &&
        node.arguments[0] &&
        isMutatingSql(node.arguments[0]))
    ) {
      mutations.push(node);
    }
  }
  return mutations.map((node) => {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    return { line: position.line + 1, column: position.character + 1 };
  });
}

function dbTestReferences(command) {
  return (
    command.match(/[^\s"';&|()]+\.db\.test\.ts\b/g)?.map((value) =>
      value.replace(/^\.\//, ""),
    ) ?? []
  );
}

function validateDbCommand(scriptName, command, errors) {
  const label = `API script "${scriptName}"`;
  const references = dbTestReferences(command);
  const exactMatch = command.match(DB_COMMAND_FORMAT);
  if (!exactMatch) {
    errors.push(
      `${label} must use exact DB command format: bash ${LOCK_RUNNER} tsx --test --test-concurrency=1 src/<safe-path>.db.test.ts`,
    );
  }
  if (references.length !== 1) {
    errors.push(
      `${label} must reference exactly one .db.test.ts file (found ${references.length})`,
    );
  }

  const tokens = command.trim().split(/\s+/);
  const lockIndexes = tokens.flatMap((token, index) =>
    token === LOCK_RUNNER ? [index] : [],
  );
  const tsxIndexes = tokens.flatMap((token, index) =>
    token === "tsx" ? [index] : [],
  );
  if (
    tokens[0] !== "bash" ||
    lockIndexes.length !== 1 ||
    lockIndexes[0] !== 1 ||
    tsxIndexes.length !== 1 ||
    tsxIndexes[0] !== 2
  ) {
    errors.push(
      `${label} must safely invoke "bash ${LOCK_RUNNER} tsx" with the shared validation lock before tsx`,
    );
  }
  if (/[;&|]/.test(command)) {
    errors.push(`${label} contains unsafe shell control operators`);
  }

  const concurrency = tokens.filter((token) =>
    token.startsWith("--test-concurrency"),
  );
  if (concurrency.length !== 1 || concurrency[0] !== "--test-concurrency=1") {
    errors.push(
      `${label} must contain exactly --test-concurrency=1 (no missing or alternate concurrency)`,
    );
  }
  if (tokens.filter((token) => token === "--test").length !== 1) {
    errors.push(`${label} must contain exactly one standalone --test token`);
  }
  return exactMatch ? [exactMatch[1]] : references;
}

export async function validateDbTestWiring(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const apiRoot = path.join(root, API_DIR);
  const [rootPackage, apiPackage, wrapper, testFiles] = await Promise.all([
    readJson(path.join(root, "package.json")),
    readJson(path.join(apiRoot, "package.json")),
    readFile(
      path.join(root, "scripts", "validate-page-select-status-sync.sh"),
      "utf8",
    ),
    findTestFiles(path.join(apiRoot, "src"), apiRoot),
  ]);
  const dbTests = testFiles.filter((file) => file.endsWith(".db.test.ts"));
  const errors = [];
  const registrations = new Map(dbTests.map((file) => [file, []]));

  for (const file of testFiles) {
    if (file.endsWith(".db.test.ts")) continue;
    const mutations = findDbMutations(path.join(apiRoot, file));
    if (mutations.length) {
      const first = mutations[0];
      errors.push(
        `mutating DB test "${file}:${first.line}:${first.column}" must use the .db.test.ts suffix and safe API script registration`,
      );
    }
  }

  for (const [name, value] of Object.entries(apiPackage.scripts ?? {})) {
    if (typeof value !== "string" || !value.includes(".db.test.ts")) continue;
    const references = validateDbCommand(name, value, errors);
    for (const reference of references) {
      if (!registrations.has(reference)) {
        errors.push(
          `API script "${name}" references unknown DB test file "${reference}"`,
        );
      } else {
        registrations.get(reference).push(name);
      }
    }
  }

  for (const [file, scripts] of registrations) {
    if (scripts.length === 0) {
      errors.push(`DB test "${file}" is unregistered in API package scripts`);
    } else if (scripts.length > 1) {
      errors.push(
        `DB test "${file}" is multiply registered by API scripts: ${scripts.join(", ")}`,
      );
    }
  }

  if (rootPackage.scripts?.release !== RELEASE_SCRIPT) {
    errors.push(
      `root release script must run the exact safe sequence (page gate before schema generation): "${RELEASE_SCRIPT}"`,
    );
  }

  const rootGate = rootPackage.scripts?.["validate:page-select-status-sync"];
  if (rootGate !== "bash scripts/validate-page-select-status-sync.sh") {
    errors.push(
      `root validate:page-select-status-sync must point to "bash scripts/validate-page-select-status-sync.sh"`,
    );
  }
  if (
    rootPackage.scripts?.["validate:db-test-wiring"] !==
    "node scripts/check-db-test-wiring.mjs"
  ) {
    errors.push(
      'root validate:db-test-wiring must point exactly to "node scripts/check-db-test-wiring.mjs"',
    );
  }

  if (/with-validation-lock\.sh/.test(wrapper)) {
    errors.push(
      "page-select validation wrapper must not acquire validation lock; the API DB command owns the single lock",
    );
  }
  if (wrapper !== PAGE_SELECT_WRAPPER) {
    errors.push(
      "page-select validation wrapper must match the exact safe validation/delegation template",
    );
  }
  const wrapperLines = wrapper.split(/\r?\n/).map((line) => line.trim());
  const delegationLineMatches = wrapperLines.flatMap((line, index) => {
    const match = line.match(
      /^(?:corepack\s+)?pnpm\s+--filter\s+@workspace\/api-server\s+run\s+([^\s]+)$/,
    );
    return match ? [{ index, script: match[1] }] : [];
  });
  const delegatedScripts = delegationLineMatches.map((match) => match.script);
  if (
    delegatedScripts.length !== 1 ||
    delegatedScripts[0] !== "test:page-select-status-db"
  ) {
    errors.push(
      'page-select validation wrapper must delegate exactly to API script "test:page-select-status-db"',
    );
  }
  const guard = "node scripts/check-db-test-wiring.mjs";
  const guardLineIndexes = wrapperLines.flatMap((line, index) =>
    line === guard ? [index] : [],
  );
  const delegationLineIndex = delegationLineMatches.find(
    (match) => match.script === "test:page-select-status-db",
  )?.index;
  if (guardLineIndexes.length !== 1) {
    errors.push(
      `page-select validation wrapper must invoke exactly once "${guard}" (found ${guardLineIndexes.length})`,
    );
  } else if (
    delegationLineIndex !== undefined &&
    guardLineIndexes[0] > delegationLineIndex
  ) {
    errors.push(
      "page-select validation wrapper must run the DB wiring guard before API delegation",
    );
  }

  const pageScript = apiPackage.scripts?.["test:page-select-status-db"];
  const pageReferences =
    typeof pageScript === "string" ? dbTestReferences(pageScript) : [];
  if (
    pageReferences.length !== 1 ||
    pageReferences[0] !== PAGE_TEST
  ) {
    errors.push(
      `API script "test:page-select-status-db" must map exactly to "${PAGE_TEST}"`,
    );
  }

  if (errors.length) {
    throw new Error(
      `DB test wiring validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
  return { dbTestCount: dbTests.length };
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  try {
    const result = await validateDbTestWiring();
    console.log(`DB test wiring is valid (${result.dbTestCount} tests).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}