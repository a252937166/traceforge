import assert from "node:assert/strict";
import { test } from "node:test";
import {
  executeGeneratedReplacementWorkflow,
  executeLegacyWorkflow,
  executeReplacementWorkflow,
  executeWorkflow,
  scenarios,
} from "../src/domain.js";
import { GENERATED_REPAIR_BASELINE } from "../src/candidates/generated-repair.js";
import { sha256Digest } from "../src/digest.js";
import { TraceForgeService } from "../src/service.js";
import { ArtifactStore } from "../src/store.js";

test("the controlled mutation sends a damaged refund to sellable inventory", () => {
  const input = scenarios.find((scenario) => scenario.id === "damaged-small-refund")?.input;
  assert.ok(input);
  const legacy = executeWorkflow(input, "legacy").result;
  const buggy = executeWorkflow(input, "replacement", "buggy").result;

  assert.deepEqual(legacy.inventoryAfter, { sku: input.sku, sellable: 10, quarantine: 1 });
  assert.deepEqual(buggy.inventoryAfter, { sku: input.sku, sellable: 11, quarantine: 0 });
  assert.equal(legacy.returnRecord.refundCents, buggy.returnRecord.refundCents);
});

test("legacy and replacement use independent implementation identities and mutation scope", () => {
  const input = scenarios.find((scenario) => scenario.id === "damaged-small-refund")?.input;
  assert.ok(input);
  const legacy = executeLegacyWorkflow(input);
  const buggyReplacement = executeReplacementWorkflow(input, "buggy");
  const fixedReplacement = executeReplacementWorkflow(input, "fixed");

  assert.equal(legacy.implementationId, "legacy.return-workflow.v1");
  assert.equal(buggyReplacement.implementationId, "replacement.return-workflow.v0-mutated");
  assert.equal(fixedReplacement.implementationId, "replacement.return-workflow.v1-reference");
  assert.notEqual(legacy.implementationId, buggyReplacement.implementationId);
  assert.deepEqual(legacy.result.inventoryAfter, fixedReplacement.result.inventoryAfter);
  assert.notDeepEqual(legacy.result.inventoryAfter, buggyReplacement.result.inventoryAfter);
});

test("the immutable generated baseline fails before a real repair is produced", () => {
  const input = scenarios.find((scenario) => scenario.id === "damaged-small-refund")?.input;
  assert.ok(input);
  const legacy = executeLegacyWorkflow(input);
  const generatedBaseline = executeGeneratedReplacementWorkflow(input, GENERATED_REPAIR_BASELINE);

  assert.equal(generatedBaseline.implementationId, "replacement.return-workflow.generated-candidate");
  assert.equal(GENERATED_REPAIR_BASELINE.metadata.status, "unconfigured");
  assert.notDeepEqual(legacy.result.inventoryAfter, generatedBaseline.result.inventoryAfter);
  assert.deepEqual(generatedBaseline.result.inventoryAfter, {
    sku: input.sku,
    sellable: 11,
    quarantine: 0,
  });
});

test("generated candidate traces seal the exact repair configuration as evidence", () => {
  const store = new ArtifactStore(":memory:");
  const service = new TraceForgeService(store);
  const run = service.runDemo({ scenarioId: "damaged-small-refund", candidateVersion: "generated" });
  const configurationEvidence = run.traces.replacement.evidence.find(
    (entry) => entry.type === "repair.configuration",
  );

  assert.ok(configurationEvidence);
  assert.match(configurationEvidence.digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(configurationEvidence.payload, GENERATED_REPAIR_BASELINE);
  store.close();
});

test("differential verifier catches the mutation and fixed candidate passes", () => {
  const store = new ArtifactStore(":memory:");
  const service = new TraceForgeService(store);
  const failed = service.runDemo({ scenarioId: "damaged-small-refund", candidateVersion: "buggy" });
  const passed = service.runDemo({ scenarioId: "damaged-small-refund", candidateVersion: "fixed" });

  assert.equal(failed.status, "FAILED");
  assert.equal(failed.proofBundle.mutationDetected, true);
  assert.deepEqual(
    failed.proofBundle.mismatches.map((mismatch) => mismatch.path),
    ["inventoryAfter.sellable", "inventoryAfter.quarantine"],
  );
  assert.equal(passed.status, "PASSED");
  assert.equal(passed.proofBundle.mismatches.length, 0);
  store.close();
});

test("contract claims are evidence-linked and explicitly bounded", () => {
  const store = new ArtifactStore(":memory:");
  const service = new TraceForgeService(store);
  const run = service.runDemo({ scenarioId: "damaged-small-refund" });

  assert.equal(run.contract.generation.openaiUsed, false);
  assert.ok(run.rules.every((rule) => rule.evidenceIds.every((id) => id.startsWith("ev_trace_"))));
  assert.match(run.contract.unknowns[0] ?? "", /evidence-bounded/i);
  assert.ok(store.getProof(run.proofBundle.proofId));
  store.close();
});

test("verifier compares business side effects read back from isolated SQLite partitions", () => {
  const store = new ArtifactStore(":memory:");
  const service = new TraceForgeService(store);
  const run = service.runDemo({ scenarioId: "damaged-small-refund", candidateVersion: "buggy" });
  const legacyState = store.snapshotBusinessState("legacy", "SKU-RED-01", "RET-1001");
  const replacementState = store.snapshotBusinessState("replacement", "SKU-RED-01", "RET-1001");

  assert.equal(run.traces.legacy.stateSource, "node:sqlite");
  assert.notEqual(run.traces.legacy.implementationId, run.traces.replacement.implementationId);
  assert.deepEqual(run.traces.legacy.result.inventoryAfter, legacyState.inventory);
  assert.deepEqual(run.traces.replacement.result.inventoryAfter, replacementState.inventory);
  assert.deepEqual(legacyState.inventory, { sku: "SKU-RED-01", sellable: 10, quarantine: 1 });
  assert.deepEqual(replacementState.inventory, { sku: "SKU-RED-01", sellable: 11, quarantine: 0 });
  assert.equal(legacyState.returnRecord?.status, "REFUNDED");
  assert.equal(replacementState.returnRecord?.status, "REFUNDED");
  store.close();
});

test("evidence and proof SHA-256 digests are stable and independently reproducible", () => {
  const store = new ArtifactStore(":memory:");
  const service = new TraceForgeService(store);
  const run = service.runDemo({ scenarioId: "damaged-small-refund", candidateVersion: "buggy" });
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
  store.close();
});
