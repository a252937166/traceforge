import recordedInvocationEvidence from "./recorded-model-invocations.generated.json" with { type: "json" };
import type { ModelInvocationEvidence } from "./migration-types.js";

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

/**
 * Runtime-safe copy of the bounded invocation metadata extracted into the
 * evidence manifest. Raw prompts and outputs remain in docs/evidence and are
 * never loaded by the public API.
 */
export const recordedModelInvocations =
  recordedInvocationEvidence.invocations as ModelInvocationEvidence[];
