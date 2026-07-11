import assert from "node:assert/strict";
import { test } from "node:test";
import {
  executeLegacyWorkflow,
  executeReplacementWorkflow,
  executeWorkflow,
  scenarios,
} from "../src/domain.js";
import { sha256Digest } from "../src/digest.js";
import { TraceForgeService } from "../src/service.js";
import { ArtifactStore } from "../src/store.js";

const observedStandard = scenarios.find(
  (scenario) => scenario.id === "observed-standard-damaged-4500",
);
assert.ok(observedStandard);

test("seeded candidate sends a damaged refund to sellable inventory", () => {
  const input = observedStandard.input;
  const legacy = executeWorkflow(input, "legacy").result;
  const seeded = executeWorkflow(input, "replacement", "seeded").result;

  assert.deepEqual(legacy.inventoryAfter, { sku: input.sku, sellable: 10, quarantine: 1 });
  assert.deepEqual(seeded.inventoryAfter, { sku: input.sku, sellable: 11, quarantine: 0 });
  assert.equal(legacy.returnRecord.refundCents, seeded.returnRecord.refundCents);
});

test("legacy, seeded, and generated modules have independent implementation identities", () => {
  const input = observedStandard.input;
  const legacy = executeLegacyWorkflow(input);
  const seeded = executeReplacementWorkflow(input, "seeded");
  const generated = executeReplacementWorkflow(input, "generated");

  assert.equal(legacy.implementationId, "legacy.return-workflow.v1");
  assert.equal(seeded.implementationId, "replacement.return-workflow.seeded-candidate");
  assert.equal(generated.implementationId, "replacement.return-workflow.generated-candidate");
  assert.notEqual(legacy.implementationId, seeded.implementationId);
  assert.notDeepEqual(legacy.result.inventoryAfter, seeded.result.inventoryAfter);
  assert.deepEqual(legacy.result, generated.result);
});

test("generated candidate trace identifies the full independent module as evidence", () => {
  const store = new ArtifactStore(":memory:");
  try {
    const service = new TraceForgeService(store);
    const run = service.runDemo({
      scenarioId: observedStandard.id,
      candidateVersion: "generated",
    });
    const moduleEvidence = run.traces.replacement.evidence.find(
      (entry) => entry.type === "candidate.module",
    );

    assert.ok(moduleEvidence);
    assert.match(moduleEvidence.digest, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(moduleEvidence.payload, {
      version: "generated",
      independentLegacyImports: 0,
    });
    assert.equal(run.traces.replacement.implementationId, "replacement.return-workflow.generated-candidate");
  } finally {
    store.close();
  }
});

test("differential verifier rejects seeded candidate and accepts generated candidate", () => {
  const store = new ArtifactStore(":memory:");
  try {
    const service = new TraceForgeService(store);
    const failed = service.runDemo({
      scenarioId: observedStandard.id,
      candidateVersion: "seeded",
    });
    const passed = service.runDemo({
      scenarioId: observedStandard.id,
      candidateVersion: "generated",
    });

    assert.equal(failed.status, "FAILED");
    assert.equal(failed.proofBundle.mutationDetected, true);
    assert.deepEqual(
      failed.proofBundle.mismatches.map((mismatch) => mismatch.path),
      ["inventoryAfter.sellable", "inventoryAfter.quarantine"],
    );
    assert.equal(passed.status, "PASSED");
    assert.equal(passed.proofBundle.mismatches.length, 0);
  } finally {
    store.close();
  }
});

test("contract claims are evidence-linked and explicitly bounded", () => {
  const store = new ArtifactStore(":memory:");
  try {
    const service = new TraceForgeService(store);
    const run = service.runDemo({
      scenarioId: observedStandard.id,
      candidateVersion: "seeded",
    });

    assert.equal(run.contract.generation.openaiUsed, false);
    assert.ok(run.rules.every((rule) => rule.evidenceIds.every((id) => id.startsWith("ev_trace_"))));
    assert.match(run.contract.unknowns[0] ?? "", /evidence-bounded/i);
    assert.ok(store.getProof(run.proofBundle.proofId));
  } finally {
    store.close();
  }
});

test("verifier compares business effects read back from isolated SQLite partitions", () => {
  const store = new ArtifactStore(":memory:");
  try {
    const service = new TraceForgeService(store);
    const input = observedStandard.input;
    const run = service.runDemo({
      scenarioId: observedStandard.id,
      candidateVersion: "seeded",
    });
    const legacyState = store.snapshotBusinessState("legacy", input.sku, input.returnId);
    const replacementState = store.snapshotBusinessState("replacement", input.sku, input.returnId);

    assert.equal(run.traces.legacy.stateSource, "node:sqlite");
    assert.notEqual(run.traces.legacy.implementationId, run.traces.replacement.implementationId);
    assert.deepEqual(run.traces.legacy.result.inventoryAfter, legacyState.inventory);
    assert.deepEqual(run.traces.replacement.result.inventoryAfter, replacementState.inventory);
    assert.deepEqual(legacyState.inventory, { sku: input.sku, sellable: 10, quarantine: 1 });
    assert.deepEqual(replacementState.inventory, { sku: input.sku, sellable: 11, quarantine: 0 });
    assert.equal(legacyState.returnRecord?.status, "REFUNDED");
    assert.equal(replacementState.returnRecord?.status, "REFUNDED");
  } finally {
    store.close();
  }
});

test("evidence and proof SHA-256 digests are stable and independently reproducible", () => {
  const store = new ArtifactStore(":memory:");
  try {
    const service = new TraceForgeService(store);
    const run = service.runDemo({
      scenarioId: observedStandard.id,
      candidateVersion: "seeded",
    });
    const evidence = run.traces.legacy.evidence[0];
    assert.ok(evidence);
    const expectedEvidenceDigest = sha256Digest({
      type: evidence.type,
      title: evidence.title,
      detail: evidence.detail,
      payload: evidence.payload,
      sequence: evidence.sequence,
      capturedAt: evidence.capturedAt,
    });
    const { digest, ...proofBody } = run.proofBundle;

    assert.match(evidence.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(evidence.digest, expectedEvidenceDigest);
    assert.match(digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(digest, sha256Digest(proofBody));
    assert.ok(run.events.every((event) => /^sha256:[a-f0-9]{64}$/.test(event.digest)));
  } finally {
    store.close();
  }
});
