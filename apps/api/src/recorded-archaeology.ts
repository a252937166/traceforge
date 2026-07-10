import { sha256Digest } from "./digest.js";
import type { ModelInvocationEvidence } from "./migration-types.js";

export const RECORDED_AT = "2026-07-10T17:06:31.357Z";

export const recordedArchaeology = {
  sourceRunId: "migration_57dcf6ff-c7b0-4842-8a66-a74e08565b7b",
  disclosure: "Recorded real GPT-5.6 Sol run — replay only; no model call is running now.",
  initialHypotheses: [
    {
      id: "RULE-STANDARD-REFUND",
      revision: 1,
      statement: "For the observed STANDARD + DAMAGED + 4,500-cent branch, the system refunds and adds one quarantined unit.",
      status: "challenged",
      confidence: 0.99,
      evidenceIds: [
        "ev_trace_c96b75a9-df7e-42d2-9a2b-fedb84e37396_002",
        "ev_trace_c96b75a9-df7e-42d2-9a2b-fedb84e37396_005",
        "ev_trace_c96b75a9-df7e-42d2-9a2b-fedb84e37396_006",
      ],
    },
    {
      id: "RULE-VIP-REPLACEMENT",
      revision: 1,
      statement: "For the observed VIP + DAMAGED + 12,000-cent branch, the system replaces and adds one quarantined unit.",
      status: "challenged",
      confidence: 0.99,
      evidenceIds: [
        "ev_trace_6642d425-3bff-4ffa-a505-ebef7e060e75_002",
        "ev_trace_6642d425-3bff-4ffa-a505-ebef7e060e75_005",
        "ev_trace_6642d425-3bff-4ffa-a505-ebef7e060e75_006",
      ],
    },
    {
      id: "HYP-AMOUNT-BANDED-REFUND",
      revision: 1,
      statement: "A competing explanation is that damaged returns below 12,000 cents refund regardless of tier.",
      status: "falsified",
      confidence: 0.35,
      evidenceIds: ["ev_trace_c96b75a9-df7e-42d2-9a2b-fedb84e37396_002"],
      falsifiedByCounterexampleId: "CX-STANDARD-12000",
    },
    {
      id: "HYP-AMOUNT-BANDED-REPLACEMENT",
      revision: 1,
      statement: "A competing explanation is that damaged returns at or above 12,000 cents replace regardless of tier.",
      status: "falsified",
      confidence: 0.35,
      evidenceIds: ["ev_trace_6642d425-3bff-4ffa-a505-ebef7e060e75_002"],
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
        returnId: "RET-HUNT-001",
        sku: "SKU-COPPER-01",
        amountCents: 12_000,
        customerTier: "STANDARD",
        itemCondition: "DAMAGED",
        initialInventory: { sellable: 10, quarantine: 0 },
      },
      observedOutcome: {
        decision: "REFUND",
        inventoryBefore: { sellable: 10, quarantine: 0 },
        inventoryAfter: { sellable: 10, quarantine: 1 },
      },
      evidenceIds: ["ev_ce_01_input", "ev_ce_01_rule", "ev_ce_01_state", "ev_ce_01_effects"],
      targetHypothesisIds: ["HYP-AMOUNT-BANDED-REFUND", "HYP-AMOUNT-BANDED-REPLACEMENT"],
    },
    {
      id: "CX-HIGH-VALUE-75000",
      title: "Probe a high-value priority exception",
      rationale: "Stress the remaining tier-only explanation with a materially higher amount and test whether review defers inventory movement.",
      status: "confirmed",
      scenario: {
        returnId: "RET-HUNT-002",
        sku: "SKU-COPPER-01",
        amountCents: 75_000,
        customerTier: "VIP",
        itemCondition: "DAMAGED",
        initialInventory: { sellable: 10, quarantine: 0 },
      },
      observedOutcome: {
        decision: "MANUAL_REVIEW",
        inventoryBefore: { sellable: 10, quarantine: 0 },
        inventoryAfter: { sellable: 10, quarantine: 0 },
      },
      evidenceIds: ["ev_ce_02_input", "ev_ce_02_rule", "ev_ce_02_state", "ev_ce_02_effects"],
      targetHypothesisIds: ["RULE-VIP-REPLACEMENT"],
    },
  ],
  refinedHypotheses: [
    {
      id: "H-HIGH-VALUE-HOLD",
      revision: 2,
      statement: "Within the observed damaged-return domain, the 50,000-cent review boundary outranks tier handling and leaves money and inventory untouched.",
      status: "accepted",
      confidence: 1,
      evidenceIds: [
        "ev_trace_5ed95113-3f7d-488b-96cc-27b27010e419_002",
        "ev_trace_5ed95113-3f7d-488b-96cc-27b27010e419_005",
        "ev_trace_5ed95113-3f7d-488b-96cc-27b27010e419_006",
        "ev_trace_70902b12-bfa8-4481-8f8b-7f379233218c_002",
        "ev_trace_70902b12-bfa8-4481-8f8b-7f379233218c_005",
        "ev_trace_70902b12-bfa8-4481-8f8b-7f379233218c_006",
        "ev_trace_0968e5d4-d287-4877-857c-b4b74855e913_005",
        "ev_trace_0968e5d4-d287-4877-857c-b4b74855e913_006",
      ],
      supersedesId: "RULE-STANDARD-REFUND",
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
    "019f4cf8-e79c-7af0-8a2a-9ade019a5d7b",
    23_559,
    recordedArchaeology.initialHypotheses,
    ["trace_c96b75a9-df7e-42d2-9a2b-fedb84e37396", "trace_6642d425-3bff-4ffa-a505-ebef7e060e75"],
  ),
  invocation(
    "counterexample-hunter",
    "019f4cf9-f48d-77a1-a6d4-a5c54894e138",
    23_689,
    recordedArchaeology.counterexamples[0],
    ["trace_c96b75a9-df7e-42d2-9a2b-fedb84e37396", "trace_6642d425-3bff-4ffa-a505-ebef7e060e75"],
  ),
  invocation(
    "counterexample-hunter",
    "019f4cfa-af8a-7592-b3d7-1a055683863d",
    25_769,
    recordedArchaeology.counterexamples[1],
    [
      "trace_c96b75a9-df7e-42d2-9a2b-fedb84e37396",
      "trace_6642d425-3bff-4ffa-a505-ebef7e060e75",
      "trace_a1a58f7c-b889-44db-bc71-193a8a1a67fa",
    ],
  ),
  invocation(
    "contract-critic",
    "019f4cfb-aab9-7e41-a8a2-aa4157748559",
    46_005,
    recordedArchaeology.contract,
    [
      "trace_c96b75a9-df7e-42d2-9a2b-fedb84e37396",
      "trace_6642d425-3bff-4ffa-a505-ebef7e060e75",
      "trace_a1a58f7c-b889-44db-bc71-193a8a1a67fa",
      "trace_70902b12-bfa8-4481-8f8b-7f379233218c",
      "trace_5ed95113-3f7d-488b-96cc-27b27010e419",
      "trace_0968e5d4-d287-4877-857c-b4b74855e913",
    ],
  ),
];
