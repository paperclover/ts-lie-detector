type NormalFunction = Extract<
  ts.SignatureDeclaration,
  { readonly body?: unknown }
>;
type NormalFunctionWithBody = NormalFunction & {
  body: NonNullable<NormalFunction["body"]>;
};

export interface LieDetectorOptions {
  runtimePath: string;
}

export const defaultOptions: LieDetectorOptions = {
  runtimePath: "@clo/ts-lie-detector/runtime.ts",
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
      // @ts-expect-error TODO
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
      assert(restIndices.length <= 1);
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
          const declaration = prop.valueDeclaration
            ?? prop.declarations?.[0]
            ?? type.symbol?.valueDeclaration
            ?? type.symbol?.declarations?.[0];
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

    /* v8 ignore next -- @preserve */
    throw new Error(`Type checker for: ${checker.typeToString(type)}`);
  }

  visit = (
    node: ts.Node,
    childVisit?: (node: ts.Node) => ts.Node | ts.Node[] | void,
  ) => {
    const { checker, f } = this;
    if (ts.isAsExpression(node)) {
      const type = checker.getTypeFromTypeNode(node.type);
      if (type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) {
        // TODO: insert "/* as unknown */
        return node.expression;
      }
      return f.createCallExpression(this.libSymbol("t_assert"), [], [
        node.expression,
        this.getCheckFn(type),
      ]);
    }

    if (ts.isNonNullExpression(node)) {
      return f.createCallExpression(this.libSymbol("t_assert_nonnull"), [], [
        node.expression,
      ]);
    }

    // Handle function implementations with assertion return types
    if (ts.isFunctionLike(node) && "body" in node) {
      return this.visitFunction(node);
    }

    return ts.visitEachChild(node, childVisit ?? this.visit, this.ctx);
  };

  visitFunction(node: NormalFunction) {
    if (node.type && ts.isTypePredicateNode(node.type) && node.body) {
      if (node.type.assertsModifier) {
        return this.transformAssertPredicateFn(
          node as NormalFunctionWithBody,
          node.type,
        );
      } else {
        return this.transformTypePredicateFn(
          node as NormalFunctionWithBody,
          node.type,
        );
      }
    }

    return ts.visitEachChild(node, this.visit, this.ctx);
  }

  functionBodyToStmts(node: ts.Expression | ts.Block) {
    const { f } = this;
    if (ts.isBlock(node)) return node.statements;
    return [f.createReturnStatement(node)];
  }

  transformAssertPredicateFn(
    node: NormalFunctionWithBody,
    typeNode: ts.TypePredicateNode,
  ) {
    const { f, checker } = this;

    const paramName = ts.isIdentifier(typeNode.parameterName)
      ? typeNode.parameterName
      : f.createThis();

    const assertion = typeNode.type
      // assert that the input is of the right type
      ? f.createExpressionStatement(
        f.createCallExpression(
          this.libSymbol("t_assert"),
          [],
          [
            paramName,
            this.getCheckFn(
              checker.getTypeFromTypeNode(typeNode.type),
            ),
          ],
        ),
      )
      // assert that the input condition is truthy
      : f.createExpressionStatement(
        f.createCallExpression(
          this.libSymbol("t_assert_truthy"),
          [],
          [paramName],
        ),
      );

    const visit = (node: ts.Node) => {
      // when entering nested functions, a new, unrelated scope is created
      if (ts.isFunctionLike(node)) return this.visit(node);
      // every `return` is an escape that implies the predicate passes
      if (ts.isReturnStatement(node)) {
        return this.insertAfterReturn(node, assertion);
      }
      return this.visit(node, visit);
    };

    const stmts = this.functionBodyToStmts(node.body).flatMap(visit);
    if (!stmts.some((x) => ts.isReturnStatement(x))) {
      stmts.push(assertion);
    }

    return this.updateFunctionBody(node, stmts);
  }

  insertAfterReturn(ret: ts.ReturnStatement, after: ts.Statement) {
    const { f } = this;

    if (ret.expression == null) {
      return [after, ret];
    }

    const local = f.createUniqueName("l_return");
    return [
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [
            f.createVariableDeclaration(
              local,
              undefined,
              undefined,
              ret.expression,
            ),
          ],
          ts.NodeFlags.Const,
        ),
      ),
      after,
      f.createReturnStatement(local),
    ];
  }

  transformTypePredicateFn(
    node: NormalFunctionWithBody,
    typeNode: ts.TypePredicateNode,
  ) {
    const { f, checker } = this;

    const paramName = ts.isIdentifier(typeNode.parameterName)
      ? typeNode.parameterName
      : f.createThis();

    assert(typeNode.type);
    const assertion = f.createExpressionStatement(
      f.createCallExpression(
        this.libSymbol("t_assert"),
        [],
        [
          paramName,
          this.getCheckFn(checker.getTypeFromTypeNode(typeNode.type)),
        ],
      ),
    );

    const visit = (node: ts.Node) => {
      // when entering nested functions, a new, unrelated scope is created
      if (ts.isFunctionLike(node)) return this.visit(node);
      // every `return` is an escape that implies the predicate passes
      if (ts.isReturnStatement(node) && node.expression) {
        const local = f.createUniqueName("l_return");
        return [
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [
                f.createVariableDeclaration(
                  local,
                  undefined,
                  undefined,
                  node.expression,
                ),
              ],
              ts.NodeFlags.Const,
            ),
          ),
          f.createIfStatement(local, assertion),
          f.createReturnStatement(local),
        ];
      }
      return this.visit(node, visit);
    };

    const stmts = this.functionBodyToStmts(node.body).flatMap(visit);
    return this.updateFunctionBody(node, stmts);
  }

  updateFunctionBody(
    node: NormalFunctionWithBody,
    statements: ts.Statement[],
  ) {
    const { f } = this;
    const newBody = f.createBlock(statements);
    if (ts.isFunctionDeclaration(node)) {
      return f.updateFunctionDeclaration(
        node,
        node.modifiers,
        node.asteriskToken,
        node.name,
        node.typeParameters,
        node.parameters,
        node.type,
        newBody,
      );
    } else if (ts.isFunctionExpression(node)) {
      return f.updateFunctionExpression(
        node,
        node.modifiers,
        node.asteriskToken,
        node.name,
        node.typeParameters,
        node.parameters,
        node.type,
        newBody,
      );
    } else if (ts.isArrowFunction(node)) {
      return f.updateArrowFunction(
        node,
        node.modifiers,
        node.typeParameters,
        node.parameters,
        node.type,
        node.equalsGreaterThanToken,
        newBody,
      );
    } else if (ts.isMethodDeclaration(node)) {
      return f.updateMethodDeclaration(
        node,
        node.modifiers,
        node.asteriskToken,
        node.name,
        node.questionToken,
        node.typeParameters,
        node.parameters,
        node.type,
        newBody,
      );
    } else if (ts.isConstructorDeclaration(node)) {
      return f.updateConstructorDeclaration(
        node,
        node.modifiers,
        node.parameters,
        newBody,
      );
    } else if (ts.isGetAccessorDeclaration(node)) {
      return f.updateGetAccessorDeclaration(
        node,
        node.modifiers,
        node.name,
        node.parameters,
        node.type,
        newBody,
      );
    } else if (ts.isSetAccessorDeclaration(node)) {
      return f.updateSetAccessorDeclaration(
        node,
        node.modifiers,
        node.name,
        node.parameters,
        newBody,
      );
    }

    /* v8 ignore next -- @preserve */
    throw new Error(
      // @ts-expect-error TODO:
      `Unimplemented in updateBlockContents: ${ts.SyntaxKind[node.kind]}`,
    );
  }
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
      return f.updateSourceFile(visited, [
        importDecl,
        ...visited.statements,
      ]);
    } else {
      return f.updateSourceFile(visited, [...visited.statements]);
    }
  };
}

import assert from "assert";
import * as ts from "typescript";
