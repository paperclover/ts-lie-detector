import assert from "assert";
import * as ts from "typescript";

export interface LieDetectorOptions {
  runtimePath: string;
}
export const defaultOptions = {
  runtimePath: "@clo/typescript-lie-detector/runtime",
};
export const tsCompilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  strict: true,
  noUncheckedIndexedAccess: true,
  allowUnreachableCode: false,
  skipLibCheck: true,
  verbatimModuleSyntax: true,
};

class Transformer {
  f: ts.NodeFactory;
  ctx: ts.TransformationContext;
  checker: ts.TypeChecker;
  libSymbols = new Map<string, ts.ImportSpecifier>();

  constructor(ctx: ts.TransformationContext, checker: ts.TypeChecker) {
    this.ctx = ctx;
    this.checker = checker;
    this.f = this.ctx.factory;
  }

  libSymbol(name: keyof typeof import("./runtime.ts")) {
    const { f } = this;
    assert(name.startsWith("t_"));
    let existing = this.libSymbols.get(name);
    if (!existing) {
      const importAs = f.createUniqueName(
        name,
        ts.GeneratedIdentifierFlags.Optimistic,
      );
      const base = importAs.text === name
        ? undefined
        : f.createIdentifier(name);
      existing = f.createImportSpecifier(false, base, importAs);
      this.libSymbols.set(name, existing);
    }
    return existing.name;
  }

  getCheckFn(type: ts.Type): ts.Expression {
    const { f, checker } = this;

    // Unknown / any: used only inside composite types; top-level handled in visit
    if (type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) {
      return this.libSymbol("t_ignore");
    }

    // Literal Values
    if (type.isLiteral()) {
      return f.createCallExpression(this.libSymbol("t_literal"), [], [
        typeof type.value === "object"
          ? f.createBigIntLiteral(type.value)
          : typeof type.value === "string"
          ? f.createStringLiteral(type.value)
          : f.createNumericLiteral(type.value),
      ]);
    }
    if (type.flags & ts.TypeFlags.BooleanLiteral) {
      return f.createCallExpression(this.libSymbol("t_literal"), [], [
        type === checker.getTrueType() ? f.createTrue() : f.createFalse(),
      ]);
    }

    // Primative Types
    if (type.flags & ts.TypeFlags.Number) {
      return this.libSymbol("t_number");
    }
    if (type.flags & ts.TypeFlags.String) {
      return this.libSymbol("t_string");
    }
    if (type.flags & ts.TypeFlags.Boolean) {
      return this.libSymbol("t_boolean");
    }
    if (type.flags & ts.TypeFlags.Null) {
      return this.libSymbol("t_null");
    }
    if (type.flags & ts.TypeFlags.Undefined) {
      return this.libSymbol("t_undefined");
    }

    // Array types
    if (checker.isArrayType(type)) {
      const elementType = checker.getElementTypeOfArrayType(type);
      const elementCheck = elementType
        ? this.getCheckFn(elementType)
        : this.libSymbol("t_ignore");
      return f.createCallExpression(this.libSymbol("t_array"), [], [
        elementCheck,
      ]);
    }

    // Tuple types
    if (checker.isTupleType(type)) {
      const tupleRef = type as ts.TupleTypeReference;
      const tupleTarget = tupleRef.target ?? (type as ts.TupleType);
      const typeArgs = checker.getTypeArguments(
        tupleRef as unknown as ts.TypeReference,
      );
      const checks = typeArgs.map((t) => this.getCheckFn(t));
      const flags = tupleTarget.elementFlags ?? [];
      const restIndices = flags.reduce<number[]>((acc, flag, idx) => {
        if ((flag & ts.ElementFlags.Rest) !== 0) acc.push(idx);
        return acc;
      }, []);
      if (restIndices.length > 1) {
        throw new Error(
          `Unsupported tuple form (multiple spreads): ${
            checker.typeToString(type)
          }`,
        );
      }
      const restIndex = restIndices[0] ?? -1;

      // No spread: fixed-length tuple
      if (restIndex === -1) {
        return f.createCallExpression(this.libSymbol("t_tuple"), [], [
          f.createArrayLiteralExpression(checks, true),
        ]);
      }

      const before = checks.slice(0, restIndex);
      const rest = checks[restIndex];
      const after = checks.slice(restIndex + 1);
      return f.createCallExpression(this.libSymbol("t_tuple_spread"), [], [
        f.createArrayLiteralExpression(before, true),
        rest,
        f.createArrayLiteralExpression(after, true),
      ]);
    }

    // Object types
    if (type.flags & ts.TypeFlags.Object) {
      const properties = checker.getPropertiesOfType(type);
      if (properties.length > 0) {
        const shapeProps = properties.map((prop) => {
          const declaration = prop.valueDeclaration ??
            prop.declarations?.[0] ??
            type.symbol?.valueDeclaration ??
            type.symbol?.declarations?.[0];
          assert(declaration);
          const propType = checker.getTypeOfSymbolAtLocation(
            prop,
            declaration,
          );
          return f.createPropertyAssignment(
            prop.getName(),
            this.getCheckFn(propType),
          );
        });
        const optionalKeys = properties
          .filter((prop) => (prop.getFlags() & ts.SymbolFlags.Optional) !== 0)
          .map((prop) => f.createStringLiteral(prop.getName()));
        return f.createCallExpression(this.libSymbol("t_object"), [], [
          f.createObjectLiteralExpression(shapeProps, true),
          f.createArrayLiteralExpression(optionalKeys, false),
        ]);
      }
    }

    // Union types
    if (type.isUnion()) {
      let types = type.types;
      const trueIndex = type.types.indexOf(checker.getTrueType());
      const falseIndex = type.types.indexOf(checker.getFalseType());
      if (trueIndex !== -1 && falseIndex !== -1) {
        types = types.slice();
        types.splice(trueIndex, 1, checker.getBooleanType());
        const falseIndex = types.indexOf(checker.getFalseType());
        types.splice(falseIndex, 1);
      }
      return f.createCallExpression(
        this.libSymbol("t_or"),
        [],
        types.map((checkFn) => this.getCheckFn(checkFn)),
      );
    }

    throw new Error(`Type checker for: ${checker.typeToString(type)}`);
  }

  visit = (node: ts.Node) => {
    const { checker, f } = this;
    if (ts.isAsExpression(node)) {
      const type = checker.getTypeFromTypeNode(node.type);
      // Top-level unknown / any: no assertion
      if (type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) {
        return node.expression;
      }
      return f.createCallExpression(
        this.libSymbol("t_assert"),
        [],
        [
          node.expression,
          this.getCheckFn(type),
        ],
      );
    }

    return ts.visitEachChild(node, this.visit, this.ctx);
  };
}

export function createTransformer(
  checker: ts.TypeChecker,
  options: Partial<LieDetectorOptions>,
) {
  const libPath = options.runtimePath ?? defaultOptions.runtimePath;
  return (ctx: ts.TransformationContext) => (rootNode: ts.SourceFile) => {
    const instance = new Transformer(ctx, checker);
    const { f } = instance;
    const visited = ts.visitNode(rootNode, instance.visit) as ts.SourceFile;
    if (libPath !== "") {
      const importDecl = f.createImportDeclaration(
        undefined,
        f.createImportClause(
          undefined,
          undefined,
          f.createNamedImports([...instance.libSymbols.values()]),
        ),
        f.createStringLiteral(libPath),
      );
      return f.updateSourceFile(
        visited,
        [importDecl, ...visited.statements],
      );
    } else {
      return f.updateSourceFile(
        visited,
        [...visited.statements],
      );
    }
  };
}

export function transformString(source: string) {
  const virtualFileName = "virtual-input.ts";
  const host = ts.createCompilerHost(tsCompilerOptions);
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (name, languageVersion) => {
    if (name === virtualFileName) {
      return ts.createSourceFile(
        virtualFileName,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
    }
    return originalGetSourceFile.call(host, name, languageVersion);
  };

  const program = ts.createProgram([virtualFileName], tsCompilerOptions, host);
  const sourceFile = program.getSourceFile(virtualFileName);
  assert(sourceFile);

  const outputs = new Map<string, string>();
  program.emit(
    undefined,
    function (file, contents) {
      outputs.set(file, contents);
    },
    undefined,
    false,
    {
      before: [
        createTransformer(program.getTypeChecker(), { runtimePath: "" }),
      ],
    },
  );
  return outputs.values().next().value;
}
