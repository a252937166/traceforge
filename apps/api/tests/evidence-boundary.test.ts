import assert from "node:assert/strict";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import {
  executeGeneratedReturnWorkflow,
  executeSeededReturnWorkflow,
} from "../src/candidates/generated-return-workflow.js";
import { buildCodexRepairPrompt, validateCodexRepairInput } from "../src/codex-adapter.js";
import {
  executeLegacyWorkflow,
  executeReplacementWorkflow,
  executeWorkflow,
  OutsideEvidenceBoundaryError,
  scenarios,
} from "../src/domain.js";
import { TraceForgeService } from "../src/service.js";
import { ArtifactStore } from "../src/store.js";
import type { ReturnWorkflowInput } from "../src/types.js";

const sellableInput: ReturnWorkflowInput = {
  returnId: "RET-OUTSIDE-SELLABLE-001",
  sku: "SKU-OUTSIDE-SELLABLE-001",
  amountCents: 12_000,
  customerTier: "VIP",
  itemCondition: "SELLABLE",
  initialInventory: { sellable: 10, quarantine: 0 },
};

function assertOutsideEvidenceBoundary(error: unknown): boolean {
  assert.ok(error instanceof OutsideEvidenceBoundaryError);
  assert.equal(error.code, "OUTSIDE_EVIDENCE_BOUNDARY");
  assert.equal(error.message, "input is outside the evidence-bounded DAMAGED-only contract");
  assert.equal(error.itemCondition, "SELLABLE");
  return true;
}

class BusinessWriteSpyStore extends ArtifactStore {
  resetCalls = 0;
  applyCalls = 0;
  traceWrites = 0;

  override resetBusinessState(...args: Parameters<ArtifactStore["resetBusinessState"]>) {
    this.resetCalls += 1;
    return super.resetBusinessState(...args);
  }

  override applyBusinessResult(...args: Parameters<ArtifactStore["applyBusinessResult"]>) {
    this.applyCalls += 1;
    return super.applyBusinessResult(...args);
  }

  override putTrace(...args: Parameters<ArtifactStore["putTrace"]>) {
    this.traceWrites += 1;
    return super.putTrace(...args);
  }
}

test("supported dispatch rejects SELLABLE before either candidate executes", () => {
  for (const executeCandidate of [executeSeededReturnWorkflow, executeGeneratedReturnWorkflow]) {
    assert.throws(
      () => executeCandidate(sellableInput),
      assertOutsideEvidenceBoundary,
    );
  }
  for (const version of ["seeded", "generated"] as const) {
    assert.throws(
      () => executeReplacementWorkflow(sellableInput, version),
      assertOutsideEvidenceBoundary,
    );
  }
  assert.throws(
    () => executeWorkflow(sellableInput, "legacy"),
    assertOutsideEvidenceBoundary,
  );

  // Preserve the historical oracle honestly: it can still be inspected
  // directly, but the migration host will not extrapolate this branch into a
  // supported replacement contract.
  const historicalOracle = executeLegacyWorkflow(sellableInput);
  assert.equal(historicalOracle.result.inventoryAfter.sellable, 10);
  assert.equal(historicalOracle.result.inventoryAfter.quarantine, 0);
  assert.deepEqual(
    historicalOracle.result.sideEffects.map(({ type }) => type),
    ["SHIPMENT", "INVENTORY_MOVE"],
  );
});

test("host rejects SELLABLE atomically before SQLite reset, commit, trace persistence, or side effects", () => {
  const store = new BusinessWriteSpyStore(":memory:");
  const service = new TraceForgeService(store);
  try {
    assert.throws(
      () => service.capture("replacement", sellableInput, "generated", "outside-sellable"),
      assertOutsideEvidenceBoundary,
    );
    assert.throws(
      () => service.captureAttempt("legacy", sellableInput, "seeded", "outside-sellable"),
      assertOutsideEvidenceBoundary,
    );
    assert.deepEqual(
      {
        resetBusinessState: store.resetCalls,
        applyBusinessResult: store.applyCalls,
        traceWrites: store.traceWrites,
      },
      {
        resetBusinessState: 0,
        applyBusinessResult: 0,
        traceWrites: 0,
      },
    );
  } finally {
    store.close();
  }
});

test("HTTP boundary exposes the stable failure code without touching the business store", async () => {
  const store = new BusinessWriteSpyStore(":memory:");
  const { app, migrationStore } = createApp({
    store,
    env: { TRACEFORGE_ENABLE_GPT56: "0", TRACEFORGE_ENABLE_CODEX: "0" },
  });
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = (server as Server).address();
    assert.ok(address && typeof address !== "string");
    const requests = [
      {
        path: "/api/traces/capture",
        body: {
          system: "replacement",
          candidateVersion: "generated",
          input: sellableInput,
        },
      },
      {
        path: "/api/verifications",
        body: { candidateVersion: "generated", input: sellableInput },
      },
    ];
    for (const request of requests) {
      const response = await fetch(`http://127.0.0.1:${address.port}${request.path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.body),
      });
      const body = await response.json() as {
        error: { code: string; message: string; evidenceBoundary: { itemCondition: string } };
      };

      assert.equal(response.status, 422, request.path);
      assert.deepEqual(body.error, {
        code: "OUTSIDE_EVIDENCE_BOUNDARY",
        message: "input is outside the evidence-bounded DAMAGED-only contract",
        evidenceBoundary: { itemCondition: "DAMAGED" },
      });
    }
    assert.equal(store.resetCalls, 0);
    assert.equal(store.applyCalls, 0);
    assert.equal(store.traceWrites, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    migrationStore.close();
    store.close();
  }
});

test("canonical host contract and Codex handoff keep the asserted scope DAMAGED-only", () => {
  const store = new ArtifactStore(":memory:");
  const service = new TraceForgeService(store);
  try {
    const run = service.runDemo({
      scenarioId: "observed-standard-damaged-4500",
      candidateVersion: "seeded",
    });
    assert.match(run.contract.scope, /Observed RULE-STANDARD-REFUND DAMAGED branch only/);
    assert.match(run.contract.scope, /non-DAMAGED condition is outside/i);
    assert.match(run.contract.preconditions[0] ?? "", /OUTSIDE_EVIDENCE_BOUNDARY/);
    assert.match(buildCodexRepairPrompt(), /contract is DAMAGED-only/);

    const outsideScenario = {
      ...scenarios[0]!,
      id: "outside-sellable-codex-input",
      input: { ...scenarios[0]!.input, itemCondition: "SELLABLE" as const },
    };
    assert.throws(
      () => validateCodexRepairInput({
        behaviorContract: run.contract,
        failedProofs: [run.proofBundle],
        visibleScenarios: [outsideScenario],
      }),
      /CODEX_REPAIR_REJECTS_OUTSIDE_EVIDENCE_BOUNDARY/,
    );
  } finally {
    store.close();
  }
});
