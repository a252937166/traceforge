import { validateWorkflowInput } from "../scenarios.js";
import type {
  Decision,
  ReturnWorkflowInput,
  WorkflowEvent,
  WorkflowExecution,
  WorkflowResult,
} from "../types.js";

type SelectedRule = {
  decision: Decision;
  ruleId: string;
  statement: string;
};

/**
 * Controlled legacy oracle.
 *
 * Keep the decision order and all side effects in this module. The candidate
 * implementation deliberately does not import anything from here, so a shared
 * helper cannot accidentally make differential verification self-confirming.
 */
export function executeLegacyReturnWorkflow(rawInput: unknown): WorkflowExecution {
  // The legacy oracle remains inspectable outside the migrated domain so its
  // historical behavior is not rewritten. Every supported TraceForge host and
  // candidate path uses the default fail-closed validator instead.
  const input = validateWorkflowInput(rawInput, { allowOutsideEvidenceBoundary: true });
  const initial = input.initialInventory ?? { sellable: 10, quarantine: 0 };
  const before = { sku: input.sku, sellable: initial.sellable, quarantine: initial.quarantine };
  const after = { ...before };
  const selected = selectLegacyRule(input);
  const sideEffects: WorkflowResult["sideEffects"] = [];
  let status: WorkflowResult["returnRecord"]["status"];
  let refundCents = 0;

  if (selected.decision === "MANUAL_REVIEW") {
    status = "PENDING_REVIEW";
    sideEffects.push({
      type: "REVIEW_QUEUE",
      detail: { queue: "HIGH_VALUE", amountCents: input.amountCents },
    });
  } else if (selected.decision === "REPLACEMENT") {
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
  } else {
    status = "REFUNDED";
    refundCents = input.amountCents;
    sideEffects.push({
      type: "REFUND_LEDGER",
      detail: { amountCents: input.amountCents },
    });

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
    implementationId: "legacy.return-workflow.v1",
    result,
    events: legacyEvents(input, selected, result),
  };
}

function selectLegacyRule(input: ReturnWorkflowInput): SelectedRule {
  // The exact threshold outranks every customer-tier policy.
  if (input.amountCents >= 50_000) {
    return {
      decision: "MANUAL_REVIEW",
      ruleId: "RULE-HIGH-VALUE-REVIEW",
      statement: "Returns worth at least 50,000 cents require manual review before side effects.",
    };
  }
  if (input.customerTier === "VIP") {
    return {
      decision: "REPLACEMENT",
      ruleId: "RULE-VIP-REPLACEMENT",
      statement: "Eligible VIP returns receive a replacement instead of a refund.",
    };
  }
  return {
    decision: "REFUND",
    ruleId: "RULE-STANDARD-REFUND",
    statement: "Eligible standard-customer returns are refunded.",
  };
}

function legacyEvents(
  input: ReturnWorkflowInput,
  selected: SelectedRule,
  result: WorkflowResult,
): WorkflowEvent[] {
  return [
    {
      type: "input.captured",
      title: "Legacy workflow input captured",
      detail: `${input.returnId} · ${input.customerTier} · ${input.itemCondition} · ${input.amountCents} cents`,
      payload: input,
    },
    {
      type: "state.before",
      title: "Legacy inventory snapshot before",
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
      title: "Legacy inventory snapshot after",
      detail: `${result.inventoryAfter.sellable} sellable, ${result.inventoryAfter.quarantine} quarantined`,
      payload: result.inventoryAfter,
    },
    {
      type: "side-effects.recorded",
      title: "Legacy business side effects captured",
      detail: result.sideEffects.map((effect) => effect.type).join(", "),
      payload: result.sideEffects,
    },
  ];
}
