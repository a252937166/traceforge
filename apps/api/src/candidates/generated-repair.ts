export type GeneratedRepairDestination = "SELLABLE" | "QUARANTINE";

export interface GeneratedRepairConfig {
  damagedRefundDestination: GeneratedRepairDestination;
  metadata: {
    status: "unconfigured" | "codex-generated";
    sourceProofDigest: string | null;
    summary: string;
  };
}

/** Immutable test oracle: Codex must never edit this baseline. */
export const GENERATED_REPAIR_BASELINE: GeneratedRepairConfig = Object.freeze({
  damagedRefundDestination: "SELLABLE",
  metadata: Object.freeze({
    status: "unconfigured",
    sourceProofDigest: null,
    summary: "No repair has been generated. The controlled inventory mutation remains active.",
  }),
});

/**
 * This is the only export a Codex repair thread is instructed to edit.
 * Its default deliberately preserves the failing candidate behavior.
 */
export const generatedRepair: GeneratedRepairConfig = {
  damagedRefundDestination: "SELLABLE",
  metadata: {
    status: "unconfigured",
    sourceProofDigest: null,
    summary: "No repair has been generated. The controlled inventory mutation remains active.",
  },
};
