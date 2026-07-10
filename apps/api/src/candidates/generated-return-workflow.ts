import { validateWorkflowInput } from "../scenarios.js";
import type {
  Decision,
  ReturnWorkflowInput,
  WorkflowEvent,
  WorkflowExecution,
  WorkflowResult,
} from "../types.js";

type CandidateRule = {
  decision: Decision;
  ruleId: string;
  statement: string;
};

/**
 * Deliberately incomplete first candidate produced from an over-generalized
 * reading of the observed traces. It has two independent seeded defects:
 *
 * 1. it applies the automatic-refund branch before VIP priority;
 * 2. it restores damaged refunds to sellable inventory.
 *
 * This is the candidate the differential verifier must reject.
 */
export function executeSeededReturnWorkflow(rawInput: unknown): WorkflowExecution {
  const input = validateWorkflowInput(rawInput);
  const initial = input.initialInventory ?? { sellable: 10, quarantine: 0 };
  const before = { sku: input.sku, sellable: initial.sellable, quarantine: initial.quarantine };
  const after = { ...before };
  const sideEffects: WorkflowResult["sideEffects"] = [];
  let selected: CandidateRule;
  let status: WorkflowResult["returnRecord"]["status"];
  let refundCents = 0;

  if (input.amountCents >= 50_000) {
    selected = {
      decision: "MANUAL_REVIEW",
      ruleId: "CANDIDATE-RULE-HIGH-VALUE-REVIEW",
      statement: "Returns worth at least 50,000 cents require manual review.",
    };
    status = "PENDING_REVIEW";
    sideEffects.push({
      type: "REVIEW_QUEUE",
      detail: { queue: "HIGH_VALUE", amountCents: input.amountCents },
    });
  } else {
    // Seeded defect 1: this broad branch shadows the VIP replacement policy.
    selected = {
      decision: "REFUND",
      ruleId: "CANDIDATE-RULE-AUTO-REFUND",
      statement: "Every return below the review threshold is refunded automatically.",
    };
    status = "REFUNDED";
    refundCents = input.amountCents;
    sideEffects.push({
      type: "REFUND_LEDGER",
      detail: { amountCents: input.amountCents },
    });

    // Seeded defect 2: condition is ignored; damaged stock becomes sellable.
    after.sellable += 1;
    sideEffects.push({
      type: "INVENTORY_MOVE",
      detail: { destination: "SELLABLE", quantity: 1 },
    });
  }

  const result: WorkflowResult = {
    decision: selected.decision,
    appliedRuleId: selected.ruleId,
    returnRecord: {
      returnId: input.returnId,
      status,
      decision: selected.decision,
      refundCents,
    },
    inventoryBefore: before,
    inventoryAfter: after,
    sideEffects,
  };

  return {
    implementationId: "replacement.return-workflow.seeded-candidate",
    result,
    events: candidateEvents(input, selected, result, "seeded"),
  };
}

/**
 * Complete generated candidate module.
 *
 * Unlike the previous one-field repair configuration, this function owns its
 * decision tree, state transitions, and side effects. It intentionally imports
 * no legacy behavior. A Codex build may replace this implementation as a whole
 * while the legacy oracle remains immutable.
 */
export function executeGeneratedReturnWorkflow(rawInput: unknown): WorkflowExecution {
  const input = validateWorkflowInput(rawInput);
  const initial = input.initialInventory ?? { sellable: 10, quarantine: 0 };
  const before = { sku: input.sku, sellable: initial.sellable, quarantine: initial.quarantine };
  const after = { ...before };
  const sideEffects: WorkflowResult["sideEffects"] = [];
  let selected: CandidateRule;
  let status: WorkflowResult["returnRecord"]["status"];
  let refundCents = 0;

  // Candidate 01 deliberately over-generalizes the observed VIP trace. The
  // hidden high-value counterexample will prove this priority is wrong.
  if (input.customerTier === "VIP") {
    selected = {
      decision: "REPLACEMENT",
      ruleId: "RULE-VIP-REPLACEMENT",
      statement: "Eligible VIP returns receive a replacement instead of a refund.",
    };
    if (after.sellable < 1) {
      throw new Error("replacement cannot be issued without sellable stock");
    }
    status = "REPLACEMENT_ISSUED";
    after.sellable -= 1;
    sideEffects.push({ type: "SHIPMENT", detail: { sku: input.sku, quantity: 1 } });
    if (input.itemCondition === "DAMAGED") {
      after.quarantine += 1;
      sideEffects.push({
        type: "INVENTORY_MOVE",
        detail: { destination: "QUARANTINE", quantity: 1 },
      });
    } else {
      after.sellable += 1;
      sideEffects.push({
        type: "INVENTORY_MOVE",
        detail: { destination: "SELLABLE", quantity: 1 },
      });
    }
  } else if (input.amountCents >= 50_000) {
    selected = {
      decision: "MANUAL_REVIEW",
      ruleId: "RULE-HIGH-VALUE-REVIEW",
      statement: "Returns worth at least 50,000 cents require manual review before side effects.",
    };
    status = "PENDING_REVIEW";
    sideEffects.push({
      type: "REVIEW_QUEUE",
      detail: { queue: "HIGH_VALUE", amountCents: input.amountCents },
    });
  } else {
    selected = {
      decision: "REFUND",
      ruleId: "RULE-STANDARD-REFUND",
      statement: "Eligible standard-customer returns are refunded.",
    };
    status = "REFUNDED";
    refundCents = input.amountCents;
    sideEffects.push({
      type: "REFUND_LEDGER",
      detail: { amountCents: input.amountCents },
    });

    // Candidate 01's second defect: damaged refunds are restored to sellable.
    after.sellable += 1;
    sideEffects.push({
      type: "INVENTORY_MOVE",
      detail: { destination: "SELLABLE", quantity: 1 },
    });
  }

  const result: WorkflowResult = {
    decision: selected.decision,
    appliedRuleId: selected.ruleId,
    returnRecord: {
      returnId: input.returnId,
      status,
      decision: selected.decision,
      refundCents,
    },
    inventoryBefore: before,
    inventoryAfter: after,
    sideEffects,
  };

  return {
    implementationId: "replacement.return-workflow.generated-candidate",
    result,
    events: candidateEvents(input, selected, result, "generated"),
  };
}

function candidateEvents(
  input: ReturnWorkflowInput,
  selected: CandidateRule,
  result: WorkflowResult,
  version: "seeded" | "generated",
): WorkflowEvent[] {
  return [
    {
      type: "candidate.module",
      title: `${version === "seeded" ? "Seeded" : "Generated"} candidate module loaded`,
      detail: `replacement.return-workflow.${version}-candidate`,
      payload: { version, independentLegacyImports: 0 },
    },
    {
      type: "input.captured",
      title: "Candidate workflow input captured",
      detail: `${input.returnId} · ${input.customerTier} · ${input.itemCondition} · ${input.amountCents} cents`,
      payload: input,
    },
    {
      type: "state.before",
      title: "Candidate inventory snapshot before",
      detail: `${result.inventoryBefore.sellable} sellable, ${result.inventoryBefore.quarantine} quarantined`,
      payload: result.inventoryBefore,
    },
    {
      type: "rule.applied",
      title: selected.ruleId,
      detail: selected.statement,
      payload: selected,
    },
    {
      type: "decision.recorded",
      title: `${selected.decision} decision recorded`,
      detail: `${result.returnRecord.status}; refund ${result.returnRecord.refundCents} cents`,
      payload: result.returnRecord,
    },
    {
      type: "state.after",
      title: "Candidate inventory snapshot after",
      detail: `${result.inventoryAfter.sellable} sellable, ${result.inventoryAfter.quarantine} quarantined`,
      payload: result.inventoryAfter,
    },
    {
      type: "side-effects.recorded",
      title: "Candidate business side effects captured",
      detail: result.sideEffects.map((effect) => effect.type).join(", "),
      payload: result.sideEffects,
    },
  ];
}
