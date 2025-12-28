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
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  // verbatimModuleSyntax: true,
  resolveJsonModule: true,

  // strictness
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noFallthroughCasesInSwitch: true,
  noUncheckedIndexedAccess: true,
  allowUnreachableCode: false,
};

interface ImportRequest {
  default: ts.Identifier | null;
  named: Record<string, ts.Identifier>;
  types: ts.ImportSpecifier[];
  star: ts.Identifier | null;
}

/** TSLD performs all work in one pass over a type-checked AST. */
class Transformer {
  f: ts.NodeFactory;
  ctx: ts.TransformationContext;
  checker: ts.TypeChecker;
  file: ts.SourceFile;
  /** Maps library symbols to lazily generated symbols. */
  libSymbols = new Map<
    keyof typeof import("@clo/ts-lie-detector/runtime.ts"),
    ts.ImportSpecifier
  >();
  /**
   * For runtime imports that TSLD wants to add, these are stored here. At the
   * end of the visit, these are converted into import statements.
   * Keys are module specifiers.
   */
  imports = new Map<string, ImportRequest>();

  constructor(
    ctx: ts.TransformationContext,
    checker: ts.TypeChecker,
    file: ts.SourceFile,
  ) {
    this.ctx = ctx;
    this.checker = checker;
    this.file = file;
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

  getDeclaredModuleName(node: ts.Node): string {
    while (node) {
      if (ts.isSourceFile(node)) return node.fileName;
      if (ts.isModuleDeclaration(node)) return node.name.text;
      node = node.parent;
    }
    throw new Error("AST node not inside of a module");
  }

  importUniqueSymbolByType(type: ts.Type): ts.Expression | null {
    const symbol = type.getSymbol();
    assert(symbol);

    const importableCandidates: { file: string; decl: ts.Declaration }[] = [];

    // first, attempt to find a symbol within the file
    for (const decl of symbol.declarations ?? []) {
      const file = this.getDeclaredModuleName(decl);
      if (file === this.file.fileName) {
        // TODO: it is possible to locate a unique symbol in
        // something other than a variable declaration, but it's
        // extremely stupid and no one really does this in the wild.
        assert(ts.isVariableDeclaration(decl));
        assert(ts.isIdentifier(decl.name));
        return decl.name;
      }
      importableCandidates.push({ file, decl });
    }

    for (const { file, decl } of importableCandidates) {
      // TODO: it is possible to locate a unique symbol in
      // something other than a variable declaration, but it's
      // extremely stupid and no one really does this in the wild.
      assert(ts.isVariableDeclaration(decl));
      assert(ts.isIdentifier(decl.name));
      const list = decl.parent;
      assert(ts.isVariableDeclarationList(list));
      const stmt = list.parent;
      assert(ts.isVariableStatement(stmt));
      // TODO: it's very possible to locate a non-exported unique symbol,
      // or exporting the symbol in many other ways.
      assert(
        stmt.modifiers!.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword),
      );
      return this.importValue(file, decl.name.text);
    }

    throw new Error("Symbol is unimportable/");
  }

  importValue(fileName: string, name: string) {
    const { f } = this;
    let req = this.getOrPutImport(fileName);
    if (req.named[name]) return req.named[name];
    req.star ??= f.createUniqueName(
      path.basename(fileName, path.extname(fileName)),
    );
    const nameNode = this.identifierOrString(name);
    return ts.isIdentifier(nameNode)
      ? f.createPropertyAccessExpression(req.star, nameNode)
      : f.createElementAccessExpression(req.star, nameNode);
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
    if (type.flags & ts.TypeFlags.UniqueESSymbol) {
      const symbolValue = this.importUniqueSymbolByType(type);
      return f.createCallExpression(this.libSymbol("t_symbol"), [], [
        symbolValue ?? f.createNull(),
      ]);
    }
    if (type.flags & ts.TypeFlags.ESSymbol) {
      return f.createCallExpression(this.libSymbol("t_symbol"), [], [
        f.createNull(),
      ]);
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
      const rest = checks[restIndex]!;
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
    throw new Error(
      `Unimplemented type assertion for: ${checker.typeToString(type)}`,
    );
  }

  visit = (
    node: ts.Node,
    childVisit?: (node: ts.Node) => ts.Node | ts.Node[] | undefined,
  ): ts.Node | ts.Node[] | undefined => {
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
    if (ts.isFunctionLike(node) && "body" in node && node.body) {
      return this.visitFunctionWithBody(node as NormalFunctionWithBody);
    }

    return ts.visitEachChild(node, childVisit ?? this.visit, this.ctx);
  };

  visitFunctionWithBody(node: NormalFunctionWithBody) {
    let transformed;

    if (node.type && ts.isTypePredicateNode(node.type)) {
      if (node.type.assertsModifier) {
        transformed = this.transformAssertPredicateFn(node);
      } else {
        transformed = this.transformTypePredicateFn(node);
      }
    } else {
      transformed = ts.visitEachChild(
        node,
        this.visit,
        this.ctx,
      ) as NormalFunctionWithBody;
    }

    return this.annotateFunctionParameters(transformed);
  }

  functionBodyToStmts(node: ts.Expression | ts.Block) {
    const { f } = this;
    if (ts.isBlock(node)) return node.statements;
    return [f.createReturnStatement(node)];
  }

  transformAssertPredicateFn(node: NormalFunctionWithBody) {
    const { type } = node;
    assert(type && ts.isTypePredicateNode(type));
    const { f, checker } = this;

    const paramName = ts.isIdentifier(type.parameterName)
      ? type.parameterName
      : f.createThis();

    const assertion = type.type
      // assert that the input is of the right type
      ? f.createExpressionStatement(
        f.createCallExpression(
          this.libSymbol("t_assert"),
          [],
          [
            paramName,
            this.getCheckFn(
              checker.getTypeFromTypeNode(type.type),
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

    const stmts = this.functionBodyToStmts(node.body)
      .flatMap(visit) as ts.Statement[];
    if (!stmts.some((x) => ts.isReturnStatement(x))) {
      stmts.push(assertion);
    }

    return this.updateFunctionBody(node, stmts) as NormalFunctionWithBody;
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

  transformTypePredicateFn(node: NormalFunctionWithBody) {
    const { type } = node;
    assert(type && ts.isTypePredicateNode(type));
    const { f, checker } = this;

    const paramName = ts.isIdentifier(type.parameterName)
      ? type.parameterName
      : f.createThis();

    assert(type.type);
    const assertion = f.createExpressionStatement(
      f.createCallExpression(
        this.libSymbol("t_assert"),
        [],
        [
          paramName,
          this.getCheckFn(checker.getTypeFromTypeNode(type.type)),
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

    const stmts = this.functionBodyToStmts(node.body)
      .flatMap(visit) as ts.Statement[];
    return this.updateFunctionBody(node, stmts) as NormalFunctionWithBody;
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

  identifierOrString(name: string) {
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
      return this.f.createStringLiteral(name);
    }
    const id = this.f.createIdentifier(name);
    if (ts.identifierToKeywordKind(id)) return this.f.createStringLiteral(name);
    return id;
  }

  getOrPutImport(fileName: string) {
    const { imports } = this;
    let req = imports.get(fileName);
    if (!req) {
      imports.set(
        fileName,
        req = { default: null, named: {}, types: [], star: null },
      );
    }
    return req;
  }

  annotateFunctionParameters(node: NormalFunctionWithBody) {
    const { f } = this;
    const parameterAssertions: ts.Statement[] = [];
    for (const param of node.parameters) {
      if (param.type) {
        const paramType = this.checker.getTypeAtLocation(param.type);

        assert(ts.isIdentifier(param.name)); // TODO:
        const paramIdentifier = param.name;

        let checkFn = this.getCheckFn(paramType);
        if (param.questionToken) {
          checkFn = f.createCallExpression(this.libSymbol("t_or"), [], [
            this.libSymbol("t_undefined"),
            checkFn,
          ]);
        }
        const assertion = f.createExpressionStatement(
          f.createCallExpression(this.libSymbol("t_assert"), [], [
            paramIdentifier,
            checkFn,
          ]),
        );
        parameterAssertions.push(assertion);
      }
    }

    const bodyStatements = this.functionBodyToStmts(node.body);
    const newBodyStatements = [...parameterAssertions, ...bodyStatements];
    return this.updateFunctionBody(node, newBodyStatements);
  }
}

export function createTransformer(
  checker: ts.TypeChecker,
  options: Partial<LieDetectorOptions>,
) {
  const libPath = options.runtimePath ?? defaultOptions.runtimePath;
  return (ctx: ts.TransformationContext) => (rootNode: ts.SourceFile) => {
    const instance = new Transformer(ctx, checker, rootNode);
    const { f, imports } = instance;

    // pass 1: split imports and non-imports with a shallow visit
    let rootStatements: ts.Statement[] = [];
    for (const stmt of rootNode.statements) {
      if (!ts.isImportDeclaration(stmt)) {
        rootStatements.push(stmt);
        continue;
      }
      const { importClause } = stmt;
      if (
        !importClause
        || importClause.phaseModifier === ts.SyntaxKind.TypeKeyword
      ) {
        // bare import or type-only import
        rootStatements.push(stmt);
        continue;
      }
      assert(ts.isStringLiteral(stmt.moduleSpecifier));
      const req = instance.getOrPutImport(stmt.moduleSpecifier.text);
      if (importClause.name) req.default = importClause.name;
      if (importClause.namedBindings) {
        if (ts.isNamespaceImport(importClause.namedBindings)) {
          req.star = importClause.namedBindings.name;
        } else if (ts.isNamedImports(importClause.namedBindings)) {
          const { type = [], runtime = [] } = Object.groupBy(
            importClause.namedBindings.elements,
            (node) => node.isTypeOnly ? "type" : "runtime",
          );
          req.named = Object.fromEntries(
            runtime.map(node =>
              [
                node.propertyName ? node.propertyName.text : node.name.text,
                node.name,
              ] as const
            ),
          );
          req.types = type;
        }
      }
    }

    // pass 2. visit recursively the entire ast
    rootStatements = rootStatements.map(node =>
      ts.visitNode(node, instance.visit) as ts.Statement
    );

    for (const [path, decl] of imports) {
      const names = Object.entries(decl.named);
      const bindings = [
        decl.star && f.createNamespaceImport(decl.star),
        (names.length > 0 || decl.types.length > 0)
        && f.createNamedImports([
          ...names.map(([ext, local]) =>
            f.createImportSpecifier(
              false,
              ext === local.text ? undefined : instance.identifierOrString(ext),
              local,
            )
          ),
          ...decl.types,
        ]),
      ].filter(Boolean) as ts.NamedImportBindings[];
      rootStatements.unshift(f.createImportDeclaration(
        undefined,
        f.createImportClause(
          undefined,
          decl.default ?? undefined,
          bindings[0],
        ),
        f.createStringLiteral(path),
      ));
      if (bindings[1]) {
        rootStatements.unshift(f.createImportDeclaration(
          undefined,
          f.createImportClause(undefined, undefined, bindings[1]),
          f.createStringLiteral(path),
        ));
      }
    }

    // For transform tests, they set the library path to `""` as a special
    // indicator to disable the import to reduce noise in fixtures.
    if (libPath !== "") {
      rootStatements.unshift(f.createImportDeclaration(
        undefined,
        f.createImportClause(
          undefined,
          undefined,
          f.createNamedImports([...instance.libSymbols.values()]),
        ),
        f.createStringLiteral(libPath),
      ));
    }

    return f.updateSourceFile(rootNode, rootStatements);
  };
}

import assert from "assert";
import path from "path";
import * as ts from "typescript";
