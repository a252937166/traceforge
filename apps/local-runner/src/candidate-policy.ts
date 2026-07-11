import ts from "typescript";
import { sha256Text } from "./fixture-digest.js";

const GENERATED_FUNCTION = "executeGeneratedReturnWorkflow";
const ALLOWED_VALUE_IMPORTS = new Set(["../scenarios.js"]);
const ALLOWED_TYPE_IMPORTS = new Set(["../types.js"]);
const FORBIDDEN_IDENTIFIERS = new Set([
  "Bun",
  "Deno",
  "Function",
  "WebSocket",
  "XMLHttpRequest",
  "eval",
  "fetch",
  "global",
  "globalThis",
  "process",
  "require",
]);
const ALLOWED_PROPERTY_ACCESS = new Set([
  "assign",
  "amountCents",
  "customerTier",
  "decision",
  "initialInventory",
  "inventoryAfter",
  "inventoryBefore",
  "itemCondition",
  "push",
  "quarantine",
  "refundCents",
  "returnId",
  "returnRecord",
  "ruleId",
  "sellable",
  "sideEffects",
  "sku",
  "statement",
  "status",
]);
const ALLOWED_DIRECT_CALLS = new Set([
  "candidateEvents",
  "validateWorkflowInput",
]);

function isExactFailureCodeAssignment(node: ts.CallExpression): boolean {
  if (
    !ts.isPropertyAccessExpression(node.expression)
    || !ts.isIdentifier(node.expression.expression)
    || node.expression.expression.text !== "Object"
    || node.expression.name.text !== "assign"
    || node.arguments.length !== 2
  ) {
    return false;
  }
  const [errorArgument, metadataArgument] = node.arguments;
  if (
    !errorArgument
    || !ts.isNewExpression(errorArgument)
    || !ts.isIdentifier(errorArgument.expression)
    || errorArgument.expression.text !== "Error"
    || errorArgument.arguments?.length !== 1
    || !ts.isStringLiteral(errorArgument.arguments[0]!)
    || errorArgument.arguments[0]!.text !== "replacement cannot be issued without sellable stock"
    || !metadataArgument
    || !ts.isObjectLiteralExpression(metadataArgument)
    || metadataArgument.properties.length !== 1
  ) {
    return false;
  }
  const property = metadataArgument.properties[0];
  return Boolean(
    property
    && ts.isPropertyAssignment(property)
    && ts.isIdentifier(property.name)
    && property.name.text === "code"
    && ts.isStringLiteral(property.initializer)
    && property.initializer.text === "INSUFFICIENT_SELLABLE_STOCK",
  );
}

export interface CandidatePolicyEvidence {
  sourceDigest: string;
  changedFunction: typeof GENERATED_FUNCTION;
  allowedImports: string[];
}

function sourceFile(source: string): ts.SourceFile {
  const file = ts.createSourceFile(
    "generated-return-workflow.ts",
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics = (
    file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    throw new Error("LOCAL_CANDIDATE_TYPESCRIPT_INVALID");
  }
  return file;
}

function generatedFunction(file: ts.SourceFile): ts.FunctionDeclaration {
  const matches = file.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === GENERATED_FUNCTION,
  );
  if (matches.length !== 1 || !matches[0]?.body) {
    throw new Error("LOCAL_CANDIDATE_GENERATED_FUNCTION_INVALID");
  }
  return matches[0];
}

function withoutGeneratedFunction(source: string, file: ts.SourceFile): string {
  const generated = generatedFunction(file);
  return `${source.slice(0, generated.getStart(file))}/* TRACEFORGE_GENERATED_FUNCTION */${source.slice(generated.end)}`;
}

export function validateCandidateSource(
  candidateSource: string,
  baseSource: string,
): CandidatePolicyEvidence {
  if (candidateSource.length > 60_000) throw new Error("LOCAL_CANDIDATE_SOURCE_TOO_LARGE");
  const candidateFile = sourceFile(candidateSource);
  const baseFile = sourceFile(baseSource);

  if (withoutGeneratedFunction(candidateSource, candidateFile) !== withoutGeneratedFunction(baseSource, baseFile)) {
    throw new Error("LOCAL_CANDIDATE_CHANGED_OUTSIDE_GENERATED_FUNCTION");
  }

  const imports: string[] = [];
  for (const statement of candidateFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) {
        throw new Error("LOCAL_CANDIDATE_IMPORT_INVALID");
      }
      const specifier = statement.moduleSpecifier.text;
      const typeOnly = statement.importClause?.isTypeOnly === true;
      const allowed = typeOnly ? ALLOWED_TYPE_IMPORTS : ALLOWED_VALUE_IMPORTS;
      if (!allowed.has(specifier)) {
        throw new Error(`LOCAL_CANDIDATE_IMPORT_BLOCKED:${specifier}`);
      }
      imports.push(specifier);
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      throw new Error("LOCAL_CANDIDATE_REEXPORT_BLOCKED");
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      throw new Error("LOCAL_CANDIDATE_IMPORT_EQUALS_BLOCKED");
    }
  }

  const generated = generatedFunction(candidateFile);
  const visit = (node: ts.Node): void => {
    if (node !== generated && ts.isFunctionLike(node)) {
      throw new Error("LOCAL_CANDIDATE_NESTED_EXECUTABLE_BLOCKED");
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      throw new Error("LOCAL_CANDIDATE_DYNAMIC_IMPORT_BLOCKED");
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const directCall = ts.isIdentifier(expression) && ALLOWED_DIRECT_CALLS.has(expression.text);
      const sideEffectPush = ts.isPropertyAccessExpression(expression)
        && ts.isIdentifier(expression.expression)
        && expression.expression.text === "sideEffects"
        && expression.name.text === "push";
      const failureCodeAssignment = isExactFailureCodeAssignment(node);
      if (!directCall && !sideEffectPush && !failureCodeAssignment) {
        throw new Error("LOCAL_CANDIDATE_CALL_BLOCKED");
      }
    }
    if (ts.isNewExpression(node)) {
      if (!ts.isIdentifier(node.expression) || node.expression.text !== "Error") {
        throw new Error("LOCAL_CANDIDATE_CONSTRUCTOR_BLOCKED");
      }
    }
    if (ts.isElementAccessExpression(node)) {
      throw new Error("LOCAL_CANDIDATE_COMPUTED_ACCESS_BLOCKED");
    }
    if (ts.isPropertyAccessExpression(node) && !ALLOWED_PROPERTY_ACCESS.has(node.name.text)) {
      throw new Error(`LOCAL_CANDIDATE_PROPERTY_BLOCKED:${node.name.text}`);
    }
    if (
      ts.isForStatement(node)
      || ts.isForInStatement(node)
      || ts.isForOfStatement(node)
      || ts.isWhileStatement(node)
      || ts.isDoStatement(node)
    ) {
      throw new Error("LOCAL_CANDIDATE_LOOP_BLOCKED");
    }
    if (
      ts.isClassDeclaration(node)
      || ts.isClassExpression(node)
      || ts.isTaggedTemplateExpression(node)
      || ts.isAwaitExpression(node)
      || ts.isYieldExpression(node)
      || ts.isDeleteExpression(node)
      || ts.isMetaProperty(node)
      || node.kind === ts.SyntaxKind.ThisKeyword
      || node.kind === ts.SyntaxKind.SuperKeyword
      || ts.isRegularExpressionLiteral(node)
    ) {
      throw new Error("LOCAL_CANDIDATE_RUNTIME_SYNTAX_BLOCKED");
    }
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
      && ts.isIdentifier(node.name)
      && ["constructor", "prototype", "__proto__"].includes(node.name.text)
    ) {
      throw new Error(`LOCAL_CANDIDATE_PROPERTY_BLOCKED:${node.name.text}`);
    }
    if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
      throw new Error(`LOCAL_CANDIDATE_IDENTIFIER_BLOCKED:${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(generated);

  if (!candidateSource.includes('implementationId: "replacement.return-workflow.generated-candidate"')) {
    throw new Error("LOCAL_CANDIDATE_IMPLEMENTATION_ID_INVALID");
  }

  return {
    sourceDigest: sha256Text(candidateSource),
    changedFunction: GENERATED_FUNCTION,
    allowedImports: [...new Set(imports)].sort(),
  };
}
