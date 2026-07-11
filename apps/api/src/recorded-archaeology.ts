import recordedArchaeologyEvidence from "./recorded-archaeology.generated.json" with { type: "json" };
import recordedInvocationEvidence from "./recorded-model-invocations.generated.json" with { type: "json" };
import type { ModelInvocationEvidence } from "./migration-types.js";

/**
 * Deployment-safe replay data generated from the canonical champion evidence.
 * Raw prompts and responses remain downloadable under docs/evidence and are
 * not loaded by the public API.
 */
export const RECORDED_AT = recordedArchaeologyEvidence.recordedAt;
export const recordedArchaeology = recordedArchaeologyEvidence.archaeology;
export const recordedModelInvocations =
  recordedInvocationEvidence.invocations as ModelInvocationEvidence[];
