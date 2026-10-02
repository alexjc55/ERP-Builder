import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

function launchCommands(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  function literal(node) {
    if (!node) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map((item) => literal(item));
      return values.every((item) => typeof item === "string") ? values : undefined;
    }
  }
  const calls = [];
  function walk(node) {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, walk);
  }
  walk(source);
  const launches = [];
  for (const call of calls) {
    const name = ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text :
      ts.isIdentifier(call.expression) ? call.expression.text : "";
    if (!["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"].includes(name)) continue;
    const executable = literal(call.arguments[0]);
    const args = literal(call.arguments[1]);
    if (typeof executable === "string") {
      if (name === "exec" || name === "execSync") launches.push(executable);
      else if (Array.isArray(args)) launches.push([executable, ...args]);
      else if (!call.arguments[1]) launches.push([executable]);
      else launches.push(undefined);
    } else launches.push(undefined);
  }
  return launches;
}

// A deliberately bounded shell subset, not a shell interpreter. Quoted decoys and
// comments are tokens, never executable edges. Only actual command positions count.
function commands(text) {
  const result = [];
  let tokens = [], token = "", quote = "", comment = false, heredoc;
  const flush = () => { if (token) tokens.push(token); token = ""; };
  const finish = () => { flush(); if (tokens.length) result.push(tokens); tokens = []; };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (heredoc) {
      const end = text.indexOf("\n", i);
      const line = text.slice(i, end < 0 ? text.length : end).trim();
      if (line === heredoc) heredoc = undefined;
      i = end < 0 ? text.length : end;
      continue;
    }
    if (comment) { if (c === "\n") { comment = false; finish(); } continue; }
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < text.length) token += text[++i];
      else token += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === "\\" && text[i + 1] === "\n") { i += 1; continue; }
    if (c === "#" && !token) { comment = true; continue; }
    if (c === "<" && text[i + 1] === "<") {
      flush();
      const match = text.slice(i + 2).match(/^-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
      if (match) { heredoc = match[1]; i = text.indexOf("\n", i); finish(); }
      continue;
    }
    if (";&|\n".includes(c)) { finish(); continue; }
    if (/\s/.test(c)) flush();
    else token += c;
  }
  finish();
  return result;
}

export async function checkLockGraph(root, rootPackage, apiPackage) {
  const errors = new Set();
  const apiRoot = path.join(root, "artifacts/api-server");
  const cache = new Map();
  let visits = 0;
  const lock = (value) => /(?:^|\/)with-validation-lock\.sh$/.test(value ?? "");
  const filePath = (value, cwd) => path.resolve(cwd,
    value.replace(/^\$\{?repo_root\}?\/?/, root + "/"));
  async function inspect(text, cwd, held, chain, active) {
    if (++visits > 4000 || chain.length > 64) {
      errors.add(`validation lock analysis limit exceeded: ${chain.join(" -> ")}`);
      return;
    }
    let owns = held;
    for (let tokens of Array.isArray(text) ? [text] : commands(text)) {
      while (["then", "do", "if", "while", "until", "!"].includes(tokens[0])) tokens = tokens.slice(1);
      while (tokens[0] === "exec" || tokens[0] === "corepack" || tokens[0] === "env" ||
             /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0] ?? "")) tokens = tokens.slice(1);
      if (tokens[0] === "cd") {
        if (tokens[1] === "$repo_root" || tokens[1] === "${repo_root}") cwd = root;
        else if (tokens[1] && !tokens[1].includes("$")) cwd = filePath(tokens[1], cwd);
        continue;
      }
      if (tokens[0] === "acquire_validation_lock") {
        if (owns) errors.add(`double validation lock: ${chain.join(" -> ")} -> acquire_validation_lock`);
        owns = true;
        continue;
      }
      const runner = tokens[0] === "bash" || tokens[0] === "sh" ? tokens[1] : tokens[0];
      if (lock(runner)) {
        if (owns) errors.add(`double validation lock: ${chain.join(" -> ")} -> ${runner}`);
        const offset = runner === tokens[0] ? 1 : 2;
        await inspect(tokens.slice(offset), cwd, true, [...chain, runner], active);
        continue;
      }
      if (["bash", "sh"].includes(tokens[0]) && tokens[1] === "-c") {
        await inspect(tokens[2] ?? "", cwd, owns, [...chain, "shell -c"], active);
        continue;
      }
      if (tokens[0] === "pnpm" || tokens[0] === "npm") {
        const filterIndex = tokens.findIndex((t) => t === "--filter" || t === "-F");
        const filter = filterIndex >= 0 ? tokens[filterIndex + 1] :
          tokens.find((t) => t.startsWith("--filter="))?.slice(9);
        const dirIndex = tokens.findIndex((t) => ["--dir", "-C", "--prefix"].includes(t));
        const targetCwd = dirIndex >= 0 ? filePath(tokens[dirIndex + 1], cwd) : cwd;
        const api = filter === "@workspace/api-server" || targetCwd === apiRoot;
        if (filter && !api) continue;
        const run = tokens.indexOf("run");
        const name = run >= 0 ? tokens[run + 1] : tokens.slice(1).find((token, index, rest) =>
          !token.startsWith("-") && !["--filter", "-F", "--dir", "-C", "--prefix"].includes(rest[index - 1]));
        const pkg = api ? apiPackage : rootPackage;
        if (typeof pkg.scripts?.[name] !== "string") continue;
        await edge(`${api ? "API" : "root"}:${name}`, pkg.scripts[name],
          api ? apiRoot : root, owns, chain, active);
        continue;
      }
      if ((tokens[0] === "source" || tokens[0] === ".") && lock(tokens[1])) continue;
      if (tokens[0] === "node" && /\.[cm]?js$/.test(tokens[1] ?? "")) {
        const file = filePath(tokens[1], cwd);
        // The guard itself is a static leaf, not a command launcher.
        if (path.basename(file) === "check-db-test-wiring.mjs") continue;
        try {
          if (!cache.has(file)) cache.set(file, await readFile(file, "utf8"));
          for (const launch of launchCommands(cache.get(file), file)) {
            if (launch === undefined) {
              if (owns) errors.add(`opaque process launch while validation lock is held: ${chain.join(" -> ")} -> ${tokens[1]}`);
              continue;
            }
            await edge(`${file}:${JSON.stringify(launch)}`, launch, cwd, owns, chain, active);
          }
        } catch (error) {
          errors.add(`cannot statically inspect validation launcher ${tokens[1]}: ${error.message}`);
        }
        continue;
      }
      const script = ["bash", "sh", "source", "."].includes(tokens[0]) ? tokens[1] : tokens[0];
      if (script?.endsWith(".sh") && !script.includes("$(")) {
        const file = filePath(script, cwd);
        if (!file.startsWith(root + path.sep)) {
          errors.add(`validation wrapper outside repository: ${chain.join(" -> ")} -> ${script}`);
          continue;
        }
        try {
          if (!cache.has(file)) cache.set(file, await readFile(file, "utf8"));
          const inherited = await edge(file, cache.get(file), cwd, owns, chain, active);
          if (tokens[0] === "source" || tokens[0] === ".") owns = inherited ?? owns;
        } catch (error) {
          errors.add(`cannot statically inspect validation wrapper ${script}: ${error.message}`);
        }
      }
    }
    return owns;
  }
  async function edge(id, text, cwd, held, chain, active) {
    const key = `${id}:${held}:${cwd}`;
    if (active.has(key)) return held; // finite graph cycles; a lock transition has its own state.
    return await inspect(text, cwd, held, [...chain, id], new Set([...active, key]));
  }
  for (const [name, text] of Object.entries(rootPackage.scripts ?? {})) {
    if (typeof text === "string" && /^(validate:|test:)/.test(name)) {
      await edge(`root:${name}`, text, root, false, [], new Set());
    }
  }
  return [...errors];
}