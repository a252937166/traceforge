import type {
  CandidateVersion,
  Decision,
  ImplementationId,
  ReturnWorkflowInput,
  Scenario,
  SystemName,
  WorkflowEvent,
  WorkflowResult,
} from "./types.js";

export interface WorkflowExecution {
  implementationId: ImplementationId;
  result: WorkflowResult;
  events: WorkflowEvent[];
}

export const scenarios: Scenario[] = [
  {
    id: "damaged-small-refund",
    title: "Damaged low-value return",
    description: "A standard customer returns a damaged low-value item. It must be refunded and quarantined.",
    input: {
      returnId: "RET-1001",
      sku: "SKU-RED-01",
      amountCents: 4_500,
      customerTier: "STANDARD",
      itemCondition: "DAMAGED",
      initialInventory: { sellable: 10, quarantine: 0 },
    },
  },
  {
    id: "vip-damaged-replacement",
    title: "VIP damaged replacement",
    description: "A VIP receives a replacement while the damaged returned unit is quarantined.",
    input: {
      returnId: "RET-1002",
      sku: "SKU-RED-01",
      amountCents: 12_000,
      customerTier: "VIP",
      itemCondition: "DAMAGED",
      initialInventory: { sellable: 10, quarantine: 0 },
    },
  },
  {
    id: "sellable-standard-refund",
    title: "Sellable standard refund",
    description: "A sellable returned item is refunded and restored to sellable stock.",
    input: {
      returnId: "RET-1003",
      sku: "SKU-BLUE-02",
      amountCents: 8_900,
      customerTier: "STANDARD",
      itemCondition: "SELLABLE",
      initialInventory: { sellable: 4, quarantine: 1 },
    },
  },
  {
    id: "high-value-review",
    title: "High-value manual review",
    description: "Returns worth at least $500 require review before inventory or money moves.",
    input: {
      returnId: "RET-1004",
      sku: "SKU-GOLD-03",
      amountCents: 75_000,
      customerTier: "VIP",
      itemCondition: "SELLABLE",
      initialInventory: { sellable: 2, quarantine: 0 },
    },
  },
];

export function validateWorkflowInput(value: unknown): ReturnWorkflowInput {
  if (!value || typeof value !== "object") {
    throw new Error("input must be an object");
  }
  const input = value as Partial<ReturnWorkflowInput>;
  if (!input.returnId?.trim() || !input.sku?.trim()) {
    throw new Error("returnId and sku are required");
  }
  if (!Number.isInteger(input.amountCents) || (input.amountCents ?? 0) <= 0) {
    throw new Error("amountCents must be a positive integer");
  }
  if (input.customerTier !== "STANDARD" && input.customerTier !== "VIP") {
    throw new Error("customerTier must be STANDARD or VIP");
  }
  if (input.itemCondition !== "SELLABLE" && input.itemCondition !== "DAMAGED") {
    throw new Error("itemCondition must be SELLABLE or DAMAGED");
  }
  const initialInventory = input.initialInventory ?? { sellable: 10, quarantine: 0 };
  if (
    !Number.isInteger(initialInventory.sellable) ||
    !Number.isInteger(initialInventory.quarantine) ||
    initialInventory.sellable < 0 ||
    initialInventory.quarantine < 0
  ) {
    throw new Error("initialInventory quantities must be non-negative integers");
  }
  return {
    returnId: input.returnId,
    sku: input.sku,
    amountCents: input.amountCents as number,
    customerTier: input.customerTier,
    itemCondition: input.itemCondition,
    initialInventory,
  };
}

function decide(input: ReturnWorkflowInput): { decision: Decision; ruleId: string; statement: string } {
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

interface ExecutionContext {
  input: ReturnWorkflowInput;
  before: WorkflowResult["inventoryBefore"];
  selected: ReturnType<typeof decide>;
  events: WorkflowEvent[];
}

function prepareExecution(rawInput: unknown): ExecutionContext {
  const input = validateWorkflowInput(rawInput);
  const initial = input.initialInventory ?? { sellable: 10, quarantine: 0 };
  const before = { sku: input.sku, sellable: initial.sellable, quarantine: initial.quarantine };
  const selected = decide(input);
  const events: WorkflowEvent[] = [
    {
      type: "input.captured",
      title: "Workflow input captured",
      detail: `${input.returnId} · ${input.customerTier} · ${input.itemCondition} · ${input.amountCents} cents`,
      payload: input,
    },
    {
      type: "state.before",
      title: "Inventory snapshot before",
      detail: `${before.sellable} sellable, ${before.quarantine} quarantined`,
      payload: before,
    },
    {
      type: "rule.applied",
      title: selected.ruleId,
      detail: selected.statement,
      payload: selected,
    },
  ];
  return { input, before, selected, events };
}

function finishExecution(
  context: ExecutionContext,
  implementationId: ImplementationId,
  status: WorkflowResult["returnRecord"]["status"],
  refundCents: number,
  after: WorkflowResult["inventoryAfter"],
  sideEffects: WorkflowResult["sideEffects"],
): WorkflowExecution {
  const { input, before, selected, events } = context;
  const result: WorkflowResult = {
    decision: selected.decision,
    appliedRuleId: selected.ruleId,
    returnRecord: { returnId: input.returnId, status, decision: selected.decision, refundCents },
    inventoryBefore: before,
    inventoryAfter: after,
    sideEffects,
  };
  events.push(
    {
      type: "decision.recorded",
      title: `${selected.decision} decision recorded`,
      detail: `${status}; refund ${refundCents} cents`,
      payload: result.returnRecord,
    },
    {
      type: "state.after",
      title: "Inventory snapshot after",
      detail: `${after.sellable} sellable, ${after.quarantine} quarantined`,
      payload: after,
    },
    {
      type: "side-effects.recorded",
      title: "Business side effects captured",
      detail: sideEffects.map((effect) => effect.type).join(", "),
      payload: sideEffects,
    },
  );
  return { implementationId, result, events };
}

/**
 * The controlled legacy implementation. Inventory disposition is implemented
 * here rather than delegated to the candidate, so the oracle is independent.
 */
export function executeLegacyWorkflow(rawInput: unknown): WorkflowExecution {
  const context = prepareExecution(rawInput);
  const { input, before, selected } = context;
  const after = { ...before };

  const sideEffects: WorkflowResult["sideEffects"] = [];
  let status: WorkflowResult["returnRecord"]["status"];
  let refundCents = 0;

  if (selected.decision === "MANUAL_REVIEW") {
    status = "PENDING_REVIEW";
    sideEffects.push({ type: "REVIEW_QUEUE", detail: { queue: "HIGH_VALUE", amountCents: input.amountCents } });
  } else if (selected.decision === "REPLACEMENT") {
    if (after.sellable < 1) {
      throw new Error("replacement cannot be issued without sellable stock");
    }
    status = "REPLACEMENT_ISSUED";
    after.sellable -= 1;
    sideEffects.push({ type: "SHIPMENT", detail: { sku: input.sku, quantity: 1 } });
    if (input.itemCondition === "DAMAGED") {
      after.quarantine += 1;
      sideEffects.push({ type: "INVENTORY_MOVE", detail: { destination: "QUARANTINE", quantity: 1 } });
    } else {
      after.sellable += 1;
      sideEffects.push({ type: "INVENTORY_MOVE", detail: { destination: "SELLABLE", quantity: 1 } });
    }
  } else {
    status = "REFUNDED";
    refundCents = input.amountCents;
    sideEffects.push({ type: "REFUND_LEDGER", detail: { amountCents: input.amountCents } });
    if (input.itemCondition === "DAMAGED") {
      after.quarantine += 1;
      sideEffects.push({ type: "INVENTORY_MOVE", detail: { destination: "QUARANTINE", quantity: 1 } });
    } else {
      after.sellable += 1;
      sideEffects.push({ type: "INVENTORY_MOVE", detail: { destination: "SELLABLE", quantity: 1 } });
    }
  }

  return finishExecution(context, "legacy.return-workflow.v1", status, refundCents, after, sideEffects);
}

/**
 * The candidate replacement implementation. Its inventory disposition is
 * intentionally independent from the legacy path. Candidate v0 contains the
 * controlled damaged-refund mutation; the reference v1 contains the repair.
 */
export function executeReplacementWorkflow(
  rawInput: unknown,
  candidateVersion: CandidateVersion = "buggy",
): WorkflowExecution {
  const context = prepareExecution(rawInput);
  const { input, before, selected } = context;
  const after = { ...before };
  const sideEffects: WorkflowResult["sideEffects"] = [];
  let status: WorkflowResult["returnRecord"]["status"];
  let refundCents = 0;

  if (selected.decision === "MANUAL_REVIEW") {
    status = "PENDING_REVIEW";
    sideEffects.push({ type: "REVIEW_QUEUE", detail: { queue: "HIGH_VALUE", amountCents: input.amountCents } });
  } else if (selected.decision === "REPLACEMENT") {
    if (after.sellable < 1) {
      throw new Error("replacement cannot be issued without sellable stock");
    }
    status = "REPLACEMENT_ISSUED";
    after.sellable -= 1;
    sideEffects.push({ type: "SHIPMENT", detail: { sku: input.sku, quantity: 1 } });
    if (input.itemCondition === "DAMAGED") {
      after.quarantine += 1;
      sideEffects.push({ type: "INVENTORY_MOVE", detail: { destination: "QUARANTINE", quantity: 1 } });
    } else {
      after.sellable += 1;
      sideEffects.push({ type: "INVENTORY_MOVE", detail: { destination: "SELLABLE", quantity: 1 } });
    }
  } else {
    status = "REFUNDED";
    refundCents = input.amountCents;
    sideEffects.push({ type: "REFUND_LEDGER", detail: { amountCents: input.amountCents } });
    if (input.itemCondition === "DAMAGED" && candidateVersion === "fixed") {
      after.quarantine += 1;
      sideEffects.push({ type: "INVENTORY_MOVE", detail: { destination: "QUARANTINE", quantity: 1 } });
    } else {
      // Candidate v0's intentional mutation: damaged refunds are misclassified as sellable.
      after.sellable += 1;
      sideEffects.push({ type: "INVENTORY_MOVE", detail: { destination: "SELLABLE", quantity: 1 } });
    }
  }

  const implementationId: ImplementationId =
    candidateVersion === "buggy"
      ? "replacement.return-workflow.v0-mutated"
      : "replacement.return-workflow.v1-reference";
  return finishExecution(context, implementationId, status, refundCents, after, sideEffects);
}

/** Compatibility dispatcher; no business behavior lives in this function. */
export function executeWorkflow(
  rawInput: unknown,
  system: SystemName,
  candidateVersion: CandidateVersion = "buggy",
): WorkflowExecution {
  return system === "legacy"
    ? executeLegacyWorkflow(rawInput)
    : executeReplacementWorkflow(rawInput, candidateVersion);
}

export function findScenario(id: string): Scenario | undefined {
  return scenarios.find((scenario) => scenario.id === id);
}
