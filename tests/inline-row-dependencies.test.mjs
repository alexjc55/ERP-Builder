import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import ts from "typescript";

// The shared row context is a memoization boundary, not an event handler:
// every captured render input must invalidate it. Check real bound symbols so
// nested row-local variables and property names cannot hide missing dependencies.
test("memoized record row context tracks every captured render input", () => {
  const filename = path.resolve("artifacts/erp-platform/src/components/EntityRecords.tsx");
  const program = ts.createProgram([filename], { noResolve: true, jsx: ts.JsxEmit.Preserve });
  const source = program.getSourceFile(filename);
  const checker = program.getTypeChecker();
  let component;
  let declaration;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "EntityRecords") component = node;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "recordRowContext") declaration = node;
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(component && declaration, "Expected the memoized record row context");
  const call = declaration.initializer;
  assert.ok(ts.isCallExpression(call) && call.expression.getText(source) === "useMemo");
  const [renderer, dependencies] = call.arguments;
  assert.ok(ts.isArrowFunction(renderer) && ts.isArrayLiteralExpression(dependencies));
  const tracked = new Set();
  function track(node) {
    if (ts.isIdentifier(node)) tracked.add(checker.getSymbolAtLocation(node));
    ts.forEachChild(node, track);
  }
  track(dependencies);

  function stableHookResult(decl) {
    if (ts.isVariableDeclaration(decl)) {
      return decl.initializer && ts.isCallExpression(decl.initializer) &&
        decl.initializer.expression.getText(source) === "useRef";
    }
    if (!ts.isBindingElement(decl) || !ts.isArrayBindingPattern(decl.parent)) return false;
    const binding = decl.parent;
    const variable = binding.parent;
    return binding.elements[1] === decl &&
      ts.isVariableDeclaration(variable) &&
      variable.initializer && ts.isCallExpression(variable.initializer) &&
      ["useState", "useReducer"].includes(variable.initializer.expression.getText(source));
  }

  const missing = new Set();
  function inspect(node) {
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const decl = symbol?.valueDeclaration;
      if (decl && decl.getSourceFile() === source &&
          decl.pos >= component.pos && decl.end <= component.end &&
          !(decl.pos >= renderer.pos && decl.end <= renderer.end) &&
          !stableHookResult(decl) && !tracked.has(symbol)) {
        missing.add(node.text);
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(renderer.body);
  assert.deepEqual([...missing].sort(), [], "Captured render inputs missing from row context dependencies");
});