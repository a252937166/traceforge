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

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      throw new Error("LOCAL_CANDIDATE_DYNAMIC_IMPORT_BLOCKED");
    }
    if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
      throw new Error(`LOCAL_CANDIDATE_IDENTIFIER_BLOCKED:${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(generatedFunction(candidateFile));

  if (!candidateSource.includes('implementationId: "replacement.return-workflow.generated-candidate"')) {
    throw new Error("LOCAL_CANDIDATE_IMPLEMENTATION_ID_INVALID");
  }

  return {
    sourceDigest: sha256Text(candidateSource),
    changedFunction: GENERATED_FUNCTION,
    allowedImports: [...new Set(imports)].sort(),
  };
}
