import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { recordedModelInvocations } from "../src/recorded-archaeology.js";
import type { ModelInvocationEvidence } from "../src/migration-types.js";

interface ManifestInvocation {
  role: ModelInvocationEvidence["role"];
  provider: ModelInvocationEvidence["provider"];
  model: ModelInvocationEvidence["model"];
  authPath: ModelInvocationEvidence["authPath"];
  threadId: string;
  startedAt: string;
  completedAt: string;
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
    total_tokens: number;
  };
  inputTraceIds: string[];
  inputEvidenceDigests: string[];
  inputDigest: string;
  outputDigest: string;
  schemaVersion: ModelInvocationEvidence["schemaVersion"];
  status: ModelInvocationEvidence["status"];
}

function asRuntimeEvidence(invocation: ManifestInvocation): ModelInvocationEvidence {
  return {
    role: invocation.role,
    provider: invocation.provider,
    model: invocation.model,
    authPath: invocation.authPath,
    threadId: invocation.threadId,
    startedAt: invocation.startedAt,
    completedAt: invocation.completedAt,
    usage: {
      inputTokens: invocation.usage.input_tokens,
      cachedInputTokens: invocation.usage.cached_input_tokens,
      outputTokens: invocation.usage.output_tokens,
      reasoningOutputTokens: invocation.usage.reasoning_output_tokens,
      totalTokens: invocation.usage.total_tokens,
    },
    inputTraceIds: invocation.inputTraceIds,
    inputEvidenceDigests: invocation.inputEvidenceDigests,
    inputDigest: invocation.inputDigest,
    outputDigest: invocation.outputDigest,
    schemaVersion: invocation.schemaVersion,
    status: invocation.status,
  };
}

test("recorded replay invocation metadata matches the redacted evidence manifest", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../../docs/evidence/live-champion-run/invocations/manifest.json", import.meta.url),
      "utf8",
    ),
  ) as { invocations: ManifestInvocation[] };

  assert.deepEqual(recordedModelInvocations, manifest.invocations.map(asRuntimeEvidence));
  assert.equal(
    recordedModelInvocations.reduce((total, invocation) => total + (invocation.usage.totalTokens ?? 0), 0),
    119_022,
  );
});
