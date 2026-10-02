import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const ANALYSIS_LIMITS = { files: 160, nodes: 120000, steps: 200, depth: 64 };

// Only local source is loaded. No package code, JS, SQL, or test module is executed.
export function localProgram(entry, root) {
  const options = {
    noEmit: true, noLib: true, target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
  };
  const host = ts.createCompilerHost(options);
  const loaded = new Set();
  host.resolveModuleNames = (names, containing) => names.map((name) => {
    if (!name.startsWith(".")) return undefined;
    const base = path.resolve(path.dirname(containing), name);
    const candidates = [base, ...[".ts", ".tsx", ".mts", "/index.ts"].map((suffix) => base + suffix)];
    if (/\.m?js$/.test(base)) candidates.unshift(base.replace(/\.m?js$/, ".ts"));
    const resolved = candidates.find((file) =>
      file.startsWith(root + path.sep) && !file.includes(`${path.sep}node_modules${path.sep}`) &&
      /\.([cm]?ts|tsx)$/.test(file) && fs.existsSync(file));
    return resolved ? { resolvedFileName: resolved, extension: ts.Extension.Ts } : undefined;
  });
  const original = host.getSourceFile;
  host.getSourceFile = (file, ...args) => {
    loaded.add(file);
    if (loaded.size > ANALYSIS_LIMITS.files) throw new Error("local DB analysis file limit exceeded");
    return original(file, ...args);
  };
  return ts.createProgram([entry], options, host);
}

export function resolvedSymbol(checker, node) {
  let symbol = node && checker.getSymbolAtLocation(node);
  const seen = new Set();
  while (symbol && (symbol.flags & ts.SymbolFlags.Alias) && !seen.has(symbol)) {
    seen.add(symbol);
    const next = checker.getAliasedSymbol(symbol);
    if (!next || next === symbol) break;
    symbol = next;
  }
  return symbol;
}

function isWritten(symbol, checker, seen = new Set()) {
  if (!symbol || seen.has(symbol)) return false;
  if (seen.size >= ANALYSIS_LIMITS.depth) return true;
  seen.add(symbol);
  const declaration = symbol.declarations?.[0];
  if (!declaration) return false;
  let written = false;
  const receiverSymbol = (node) => {
    while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) node = node.expression;
    return resolvedSymbol(checker, node);
  };
  const visit = (node) => {
    if (ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        receiverSymbol(node.left) === symbol) written = true;
    if ((ts.isDeleteExpression(node) || ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        receiverSymbol(node.expression ?? node.operand) === symbol) written = true;
    if (ts.isCallExpression(node) && node.expression.getText() === "Object.assign" &&
        node.arguments[0] && receiverSymbol(node.arguments[0]) === symbol) written = true;
    if (ts.isVariableDeclaration(node) && node.initializer &&
        resolvedSymbol(checker, node.initializer) === symbol &&
        isWritten(resolvedSymbol(checker, node.name), checker, seen)) written = true;
    ts.forEachChild(node, visit);
  };
  visit(declaration.getSourceFile());
  return written;
}

export function functionAt(checker, expression, unwrap, seen = new Set()) {
  expression = unwrap(expression);
  if (!expression) return undefined;
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
  const symbol = resolvedSymbol(checker, expression);
  if (!symbol || seen.has(symbol) || seen.size >= ANALYSIS_LIMITS.depth) return undefined;
  seen.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) return declaration;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return functionAt(checker, declaration.initializer, unwrap, seen);
    }
    if (ts.isPropertyAssignment(declaration)) {
      return functionAt(checker, declaration.initializer, unwrap, seen);
    }
    if (ts.isExportAssignment(declaration)) return functionAt(checker, declaration.expression, unwrap, seen);
  }
}

// Const-only symbolic evaluation: symbol identity protects against lexical shadowing.
// Unknown/cyclic/mutable expressions must never be taken as evidence of read-only SQL.
export function resolveSql(expression, checker, unwrap, seen = new Set(), depth = 0, tagged = false) {
  expression = unwrap(expression);
  if (!expression || depth > ANALYSIS_LIMITS.depth) return undefined;
  const next = (value, isTagged = tagged) =>
    resolveSql(value, checker, unwrap, new Set(seen), depth + 1, isTagged);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
    const symbol = resolvedSymbol(checker, expression);
    if (!symbol || seen.has(symbol)) return undefined;
    seen.add(symbol);
    const declaration = symbol.declarations?.find(ts.isVariableDeclaration);
    if (declaration?.initializer && (declaration.parent.flags & ts.NodeFlags.Const) &&
        !isWritten(symbol, checker)) {
      return next(declaration.initializer);
    }
    const property = symbol.declarations?.find(ts.isPropertyAssignment);
    // Object properties can be written even on const objects; only resolve
    // them through an object literal below, not as free-standing property reads.
    if (property) return undefined;
    return undefined;
  }
  if (ts.isObjectLiteralExpression(expression)) {
    // Spreads/computed keys/duplicates can replace text at runtime.
    if (expression.properties.some((p) => ts.isSpreadAssignment(p) || !p.name || ts.isComputedPropertyName(p.name))) return undefined;
    const texts = expression.properties.filter((p) => p.name.text === "text");
    if (texts.length !== 1) return undefined;
    const text = texts[0];
    if (ts.isShorthandPropertyAssignment(text)) {
      let value = checker.getShorthandAssignmentValueSymbol(text);
      if (value && (value.flags & ts.SymbolFlags.Alias)) value = checker.getAliasedSymbol(value);
      const declaration = value?.declarations?.find(ts.isVariableDeclaration);
      return declaration?.initializer && (declaration.parent.flags & ts.NodeFlags.Const) &&
        !isWritten(value, checker) ?
        next(declaration.initializer) : undefined;
    }
    return ts.isPropertyAssignment(text) ? next(text.initializer) : undefined;
  }
  if (ts.isTaggedTemplateExpression(expression)) return next(expression.template, true);
  if (ts.isTemplateExpression(expression)) {
    const fragment = (node, visited = new Set()) => {
      node = unwrap(node);
      if (!node || visited.size > ANALYSIS_LIMITS.depth) return true;
      if (ts.isTaggedTemplateExpression(node)) return true;
      if (ts.isCallExpression(node)) return true; // opaque runtime call may generate SQL
      if (ts.isIdentifier(node)) {
        const symbol = resolvedSymbol(checker, node);
        if (!symbol || visited.has(symbol)) return false;
        visited.add(symbol);
        const declaration = symbol.declarations?.find(ts.isVariableDeclaration);
        return declaration?.initializer ? fragment(declaration.initializer, visited) : false;
      }
      return false;
    };
    let result = expression.head.text;
    for (const span of expression.templateSpans) {
      if (tagged && !fragment(span.expression)) {
        result += " ? " + span.literal.text;
        continue;
      }
      const value = next(span.expression);
      // Drizzle tagged interpolation is a value placeholder, not command text.
      if (value === undefined) return undefined;
      result += (value ?? " ? ") + span.literal.text;
    }
    return result;
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = next(expression.left), right = next(expression.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === "raw") return next(expression.arguments[0], false);
  return undefined;
}