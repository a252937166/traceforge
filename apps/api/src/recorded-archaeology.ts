import { sha256Digest } from "./digest.js";
import type { ModelInvocationEvidence } from "./migration-types.js";

export const RECORDED_AT = "2026-07-10T16:29:39.000Z";

export const recordedArchaeology = {
  sourceRunId: "gpt56-archaeology-2026-07-11",
  disclosure: "Recorded real GPT-5.6 Sol run — replay only; no model call is running now.",
  initialHypotheses: [
    {
      id: "H-TIER-STANDARD",
      revision: 1,
      statement: "STANDARD + DAMAGED returns refund immediately and enter quarantine, regardless of amount.",
      status: "falsified",
      confidence: 0.5,
      evidenceIds: ["ev_seed_01_input", "ev_seed_01_rule", "ev_seed_01_state"],
      falsifiedByCounterexampleId: "CX-EXTREME-100000",
    },
    {
      id: "H-TIER-VIP",
      revision: 1,
      statement: "VIP + DAMAGED returns receive a replacement and enter quarantine, regardless of amount.",
      status: "challenged",
      confidence: 0.5,
      evidenceIds: ["ev_seed_02_input", "ev_seed_02_rule", "ev_seed_02_state"],
    },
    {
      id: "H-AMOUNT-12000",
      revision: 1,
      statement: "12,000 cents is the decision boundary for damaged returns.",
      status: "falsified",
      confidence: 0.5,
      evidenceIds: ["ev_seed_01_input", "ev_seed_02_input"],
      falsifiedByCounterexampleId: "CX-STANDARD-12000",
    },
  ],
  counterexamples: [
    {
      id: "CX-STANDARD-12000",
      title: "Cross tier and the apparent amount boundary",
      rationale: "Distinguish customer-tier priority from an apparent 12,000-cent split.",
      status: "confirmed",
      scenario: {
        returnId: "RET-CE-12000-STD-DMG",
        sku: "SKU-CE-BOUNDARY",
        amountCents: 12_000,
        customerTier: "STANDARD",
        itemCondition: "DAMAGED",
        initialInventory: { sellable: 10, quarantine: 4 },
      },
      observedOutcome: {
        decision: "REFUND",
        inventoryBefore: { sellable: 10, quarantine: 4 },
        inventoryAfter: { sellable: 10, quarantine: 5 },
      },
      evidenceIds: ["ev_ce_01_input", "ev_ce_01_rule", "ev_ce_01_state", "ev_ce_01_effects"],
      targetHypothesisIds: ["H-TIER-STANDARD", "H-AMOUNT-12000"],
    },
    {
      id: "CX-EXTREME-100000",
      title: "Probe a high-value priority exception",
      rationale: "Stress the remaining explanation with the maximum valid amount while holding tier and condition constant.",
      status: "confirmed",
      scenario: {
        returnId: "RET-CE-EXTREME-100000",
        sku: "SKU-CE-EXTREME-001",
        amountCents: 100_000,
        customerTier: "STANDARD",
        itemCondition: "DAMAGED",
        initialInventory: { sellable: 10, quarantine: 0 },
      },
      observedOutcome: {
        decision: "MANUAL_REVIEW",
        inventoryBefore: { sellable: 10, quarantine: 0 },
        inventoryAfter: { sellable: 10, quarantine: 0 },
      },
      evidenceIds: ["ev_ce_02_input", "ev_ce_02_rule", "ev_ce_02_state", "ev_ce_02_effects"],
      targetHypothesisIds: ["H-TIER-STANDARD"],
    },
  ],
  refinedHypotheses: [
    {
      id: "H-HIGH-VALUE-HOLD",
      revision: 2,
      statement: "Within the observed domain, damaged returns at or above 50,000 cents enter MANUAL_REVIEW before money or inventory moves.",
      status: "accepted",
      confidence: 1,
      evidenceIds: [
        "ev_boundary_49999_input",
        "ev_boundary_49999_rule",
        "ev_boundary_49999_state",
        "ev_boundary_50000_input",
        "ev_boundary_50000_rule",
        "ev_boundary_50000_state",
        "ev_ce_02_rule",
        "ev_ce_02_state",
      ],
      supersedesId: "H-TIER-STANDARD",
    },
  ],
  contract: {
    id: "contract-gpt56-recorded-v1",
    scope: "Observed Web returns workflow branches only",
    rules: [
      {
        id: "R-HIGH-VALUE-HOLD",
        priority: 10,
        statement: "At or above 50,000 cents, hold for manual review and leave inventory unchanged.",
      },
      {
        id: "R-STANDARD-REFUND",
        priority: 20,
        statement: "Below the review boundary, observed STANDARD damaged returns refund and enter quarantine.",
      },
      {
        id: "R-VIP-REPLACEMENT",
        priority: 30,
        statement: "At the observed 12,000-cent branch, a VIP damaged return receives a replacement and enters quarantine.",
      },
    ],
    unknowns: [
      "Unobserved customer tiers, conditions, and external payment or carrier integrations remain outside the claim.",
      "The VIP rule is evidence-bounded to the observed normal-value branch plus the held-out high-value test.",
    ],
    disposition: "READY_FOR_BUILD",
  },
} as const;

function invocation(
  role: ModelInvocationEvidence["role"],
  threadId: string,
  totalTokens: number,
  output: unknown,
  inputTraceIds: string[],
): ModelInvocationEvidence {
  const startedAt = RECORDED_AT;
  return {
    role,
    provider: "openai",
    model: "gpt-5.6-sol",
    authPath: "codex-chatgpt",
    threadId,
    startedAt,
    completedAt: RECORDED_AT,
    usage: { totalTokens },
    inputTraceIds,
    inputEvidenceDigests: [],
    inputDigest: sha256Digest({ role, inputTraceIds }),
    outputDigest: sha256Digest(output),
    schemaVersion: "traceforge.behavior-archaeology.v1",
    status: "succeeded",
  };
}

export const recordedModelInvocations: ModelInvocationEvidence[] = [
  invocation(
    "trace-archaeologist",
    "019f4cd8-26a1-7030-96ee-83c5758336ab",
    15_766,
    recordedArchaeology.initialHypotheses,
    ["trace_seed_standard_damaged", "trace_seed_vip_damaged"],
  ),
  invocation(
    "counterexample-hunter",
    "019f4cd9-e3f2-7553-a86b-81a1df6bce27",
    15_204,
    recordedArchaeology.counterexamples[0],
    ["trace_seed_standard_damaged", "trace_seed_vip_damaged"],
  ),
  invocation(
    "counterexample-hunter",
    "019f4cda-eb95-72c1-a2c1-1d61d084a96f",
    14_552,
    recordedArchaeology.counterexamples[1],
    ["trace_seed_standard_damaged", "trace_seed_vip_damaged", "trace_ce_standard_12000"],
  ),
  invocation(
    "contract-critic",
    "019f4cdc-64af-7cd2-871d-fdcc74716a76",
    17_102,
    recordedArchaeology.contract,
    [
      "trace_seed_standard_damaged",
      "trace_seed_vip_damaged",
      "trace_ce_standard_12000",
      "trace_ce_extreme_100000",
      "trace_boundary_49999",
      "trace_boundary_50000",
    ],
  ),
];
