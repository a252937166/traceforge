import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  executeLegacyWorkflow,
  executeReplacementWorkflow,
  scenarios,
} from "../src/domain.js";

function scenario(id: string) {
  const found = scenarios.find((entry) => entry.id === id);
  assert.ok(found, `missing scenario ${id}`);
  return found;
}

test("champion corpus exposes two observations, GPT counterexample, exact boundary, and held-out priority check", () => {
  assert.deepEqual(
    scenarios.map(({ id, stage, visibility, input }) => ({
      id,
      stage,
      visibility,
      amountCents: input.amountCents,
      customerTier: input.customerTier,
    })),
    [
      {
        id: "observed-standard-damaged-4500",
        stage: "observed",
        visibility: "visible",
        amountCents: 4_500,
        customerTier: "STANDARD",
      },
      {
        id: "observed-vip-damaged-12000",
        stage: "observed",
        visibility: "visible",
        amountCents: 12_000,
        customerTier: "VIP",
      },
      {
        id: "counterexample-standard-damaged-100000",
        stage: "counterexample",
        visibility: "visible",
        amountCents: 100_000,
        customerTier: "STANDARD",
      },
      {
        id: "boundary-standard-damaged-49999",
        stage: "boundary",
        visibility: "visible",
        amountCents: 49_999,
        customerTier: "STANDARD",
      },
      {
        id: "boundary-standard-damaged-50000",
        stage: "boundary",
        visibility: "visible",
        amountCents: 50_000,
        customerTier: "STANDARD",
      },
      {
        id: "heldout-vip-damaged-50000",
        stage: "held-out",
        visibility: "hidden",
        amountCents: 50_000,
        customerTier: "VIP",
      },
    ],
  );
});

test("seeded candidate is rejected for both VIP priority and damaged disposition", () => {
  const standardInput = scenario("observed-standard-damaged-4500").input;
  const vipInput = scenario("observed-vip-damaged-12000").input;

  const legacyStandard = executeLegacyWorkflow(standardInput).result;
  const seededStandard = executeReplacementWorkflow(standardInput, "seeded").result;
  assert.equal(legacyStandard.decision, "REFUND");
  assert.deepEqual(legacyStandard.inventoryAfter, {
    sku: standardInput.sku,
    sellable: 10,
    quarantine: 1,
  });
  assert.deepEqual(seededStandard.inventoryAfter, {
    sku: standardInput.sku,
    sellable: 11,
    quarantine: 0,
  });

  const legacyVip = executeLegacyWorkflow(vipInput).result;
  const seededVip = executeReplacementWorkflow(vipInput, "seeded").result;
  assert.equal(legacyVip.decision, "REPLACEMENT");
  assert.equal(seededVip.decision, "REFUND");
  assert.notDeepEqual(seededVip.sideEffects, legacyVip.sideEffects);
});

test("generated module independently matches the legacy oracle across the complete suite", () => {
  for (const entry of scenarios) {
    const legacy = executeLegacyWorkflow(entry.input);
    const generated = executeReplacementWorkflow(entry.input, "generated");
    assert.notEqual(generated.implementationId, legacy.implementationId);
    assert.deepEqual(generated.result, legacy.result, entry.id);
  }
});

test("50,000 cents is the exact threshold and outranks VIP replacement", () => {
  const below = executeLegacyWorkflow(
    scenario("boundary-standard-damaged-49999").input,
  ).result;
  const exact = executeLegacyWorkflow(
    scenario("boundary-standard-damaged-50000").input,
  ).result;
  const heldOutVip = executeLegacyWorkflow(
    scenario("heldout-vip-damaged-50000").input,
  ).result;

  assert.equal(below.decision, "REFUND");
  assert.equal(exact.decision, "MANUAL_REVIEW");
  assert.deepEqual(exact.inventoryAfter, exact.inventoryBefore);
  assert.deepEqual(exact.sideEffects.map((effect) => effect.type), ["REVIEW_QUEUE"]);
  assert.equal(heldOutVip.decision, "MANUAL_REVIEW");
  assert.deepEqual(heldOutVip.inventoryAfter, heldOutVip.inventoryBefore);
});

test("candidate module has no dependency on the legacy implementation", async () => {
  const source = await readFile(
    new URL("../src/candidates/generated-return-workflow.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /from\s+["'][^"']*legacy\//);
  assert.match(source, /function executeGeneratedReturnWorkflow/);
});
