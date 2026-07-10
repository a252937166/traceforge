import type { ReturnWorkflowInput, Scenario } from "./types.js";

const inventory = { sellable: 10, quarantine: 0 } as const;

/**
 * The experiment corpus is deliberately ordered by disclosure:
 *
 * 1. two operator-observed traces;
 * 2. the GPT-5.6-selected discriminating counterexample;
 * 3. exact deterministic boundary checks;
 * 4. one held-out combination that is only revealed during final verification.
 */
export const scenarios: Scenario[] = [
  {
    id: "observed-standard-damaged-4500",
    title: "Observed · standard damaged return",
    description: "The operator refunds a $45 damaged return and quarantines the unit.",
    stage: "observed",
    visibility: "visible",
    input: {
      returnId: "RET-OBS-001",
      sku: "SKU-COPPER-01",
      amountCents: 4_500,
      customerTier: "STANDARD",
      itemCondition: "DAMAGED",
      initialInventory: { ...inventory },
    },
  },
  {
    id: "observed-vip-damaged-12000",
    title: "Observed · VIP damaged return",
    description: "The operator replaces a $120 VIP return and quarantines the damaged unit.",
    stage: "observed",
    visibility: "visible",
    input: {
      returnId: "RET-OBS-002",
      sku: "SKU-COPPER-01",
      amountCents: 12_000,
      customerTier: "VIP",
      itemCondition: "DAMAGED",
      initialInventory: { ...inventory },
    },
  },
  {
    id: "counterexample-standard-damaged-100000",
    title: "GPT counterexample · high-value damaged return",
    description: "GPT-5.6 selected an unobserved $1,000 return to distinguish a universal damaged-item rule from a high-value exception.",
    stage: "counterexample",
    visibility: "visible",
    input: {
      returnId: "RET-CHALLENGE-001",
      sku: "SKU-COPPER-01",
      amountCents: 100_000,
      customerTier: "STANDARD",
      itemCondition: "DAMAGED",
      initialInventory: { ...inventory },
    },
  },
  {
    id: "boundary-standard-damaged-49999",
    title: "Boundary · one cent below review",
    description: "$499.99 remains eligible for automatic refund and quarantine.",
    stage: "boundary",
    visibility: "visible",
    input: {
      returnId: "RET-BOUNDARY-LOW",
      sku: "SKU-COPPER-01",
      amountCents: 49_999,
      customerTier: "STANDARD",
      itemCondition: "DAMAGED",
      initialInventory: { ...inventory },
    },
  },
  {
    id: "boundary-standard-damaged-50000",
    title: "Boundary · exact review threshold",
    description: "$500.00 is the first value that requires review with no inventory or payment side effects.",
    stage: "boundary",
    visibility: "visible",
    input: {
      returnId: "RET-BOUNDARY-EXACT",
      sku: "SKU-COPPER-01",
      amountCents: 50_000,
      customerTier: "STANDARD",
      itemCondition: "DAMAGED",
      initialInventory: { ...inventory },
    },
  },
  {
    id: "heldout-vip-damaged-50000",
    title: "Held out · VIP at exact threshold",
    description: "The final hidden check proves the review threshold outranks VIP replacement priority.",
    stage: "held-out",
    visibility: "hidden",
    input: {
      returnId: "RET-HELDOUT-001",
      sku: "SKU-COPPER-01",
      amountCents: 50_000,
      customerTier: "VIP",
      itemCondition: "DAMAGED",
      initialInventory: { ...inventory },
    },
  },
];

const legacyScenarioAliases: Readonly<Record<string, string>> = {
  "damaged-small-refund": "observed-standard-damaged-4500",
  "vip-damaged-replacement": "observed-vip-damaged-12000",
  "high-value-review": "counterexample-standard-damaged-100000",
};

export function findScenario(id: string): Scenario | undefined {
  const canonicalId = legacyScenarioAliases[id] ?? id;
  return scenarios.find((scenario) => scenario.id === canonicalId);
}

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
    initialInventory: { ...initialInventory },
  };
}
