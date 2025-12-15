import * as path from "node:path";
import assert from "node:assert/strict";
import * as ts from "typescript";
import * as fs from "node:fs";

const filePath = path.resolve("sample1.ts");
console.log("--- input --");
console.log(fs.readFileSync(filePath, "utf-8"));

const host = ts.createCompilerHost({
  target: ts.ScriptTarget.ES2015,
  module: ts.ModuleKind.CommonJS,
});

const program = ts.createProgram([filePath], {}, host);

const sourceFile = program.getSourceFile(filePath);
assert(sourceFile);

const outputs = new Map<string, string>();
const transformed = program.emit(
  undefined,
  function (file, contents) {
    outputs.set(file, contents);
  },
  undefined,
  false,
  { before: [transformer(program)] },
);
const text = outputs.values().next().value;

fs.writeFileSync("demo.js", text);
console.log("--- output ---");
console.log(text);
console.log("--- runtime ---");
await import("./demo.js");

function transformer(program: ts.Program) {
  const checker = program.getTypeChecker();
  return (ctx: ts.TransformationContext) => (rootNode: ts.SourceFile) => {
    const T = ctx.factory;

    let symbols = new Map<string, ts.ImportSpecifier>();

    function libSymbol(name: keyof typeof import("./lib.ts")) {
      assert(name.startsWith("t_"));
      let existing = symbols.get(name);
      if (!existing) {
        const importAs = T.createUniqueName(
          name,
          ts.GeneratedIdentifierFlags.Optimistic,
        );
        const base = importAs.text === name
          ? undefined
          : T.createIdentifier(name);
        existing = T.createImportSpecifier(false, base, importAs);
        symbols.set(name, existing);
      }
      return existing.name;
    }

    function getCheckFn(type: ts.Type): ts.Expression {
      if (type.isLiteral()) {
        return T.createCallExpression(libSymbol("t_literal"), [], [
          typeof type.value === "object"
            ? T.createBigIntLiteral(type.value)
            : typeof type.value === "string"
            ? T.createStringLiteral(type.value)
            : T.createNumericLiteral(type.value),
        ]);
      } else if (type.flags & ts.TypeFlags.Number) {
        return libSymbol("t_number");
      } else if (type.flags & ts.TypeFlags.String) {
        return libSymbol("t_string");
      } else if (type.flags & ts.TypeFlags.Boolean) {
        return libSymbol("t_boolean");
      } else if (type.flags & ts.TypeFlags.BooleanLiteral) {
        return T.createCallExpression(libSymbol("t_literal"), [], [
          type === checker.getTrueType() ? T.createTrue() : T.createFalse(),
        ]);
      } else if (type.isUnion()) {
        let types = type.types;
        const trueIndex = type.types.indexOf(checker.getTrueType());
        const falseIndex = type.types.indexOf(checker.getFalseType());
        if (trueIndex !== -1 && falseIndex !== -1) {
          types = types.slice();
          types.splice(trueIndex, 1, checker.getBooleanType());
          const falseIndex = types.indexOf(checker.getFalseType());
          types.splice(falseIndex, 1);
        }
        return T.createCallExpression(
          libSymbol("t_or"),
          [],
          types.map((checkFn) => getCheckFn(checkFn)),
        );
      } else {
        throw new Error(`Type checker for: ${checker.typeToString(type)}`);
      }
    }

    function visit(node: ts.Node) {
      if (ts.isAsExpression(node)) {
        const type = checker.getTypeFromTypeNode(node.type);
        return T.createCallExpression(
          libSymbol("t_assert"),
          [],
          [
            node.expression,
            getCheckFn(type),
          ],
        );
      }

      return ts.visitEachChild(node, visit, ctx);
    }

    const visited = ts.visitNode(rootNode, visit) as ts.SourceFile;
    const importDecl = T.createImportDeclaration(
      undefined,
      T.createImportClause(
        undefined,
        undefined,
        T.createNamedImports([...symbols.values()]),
      ),
      T.createStringLiteral("./lib.ts"),
    );
    return T.updateSourceFile(
      visited,
      [importDecl, ...visited.statements],
    );
  };
}
