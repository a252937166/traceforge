import {
  executeGeneratedReturnWorkflow,
  executeSeededReturnWorkflow,
} from "./candidates/generated-return-workflow.js";
import { executeLegacyReturnWorkflow } from "./legacy/return-workflow.js";
import {
  assertWithinEvidenceBoundary,
  createHostHiddenScenario,
  findScenario,
  scenarios,
  validateWorkflowInput,
} from "./scenarios.js";
import type {
  CandidateVersion,
  SystemName,
  WorkflowExecution,
} from "./types.js";

export {
  assertWithinEvidenceBoundary,
  createHostHiddenScenario,
  EVIDENCE_BOUNDED_ITEM_CONDITION,
  findScenario,
  OutsideEvidenceBoundaryError,
  scenarios,
  validateWorkflowInput,
} from "./scenarios.js";

/** The legacy oracle is a standalone implementation module. */
export function executeLegacyWorkflow(rawInput: unknown): WorkflowExecution {
  return executeLegacyReturnWorkflow(rawInput);
}

/**
 * Candidate dispatcher only. No workflow rule or state transition lives here.
 *
 * Only the two public candidate identities exist. There is no reference
 * implementation or hidden passing fallback in the runtime path.
 */
export function executeReplacementWorkflow(
  rawInput: unknown,
  candidateVersion: CandidateVersion = "seeded",
  _deprecatedGeneratedConfig?: unknown,
): WorkflowExecution {
  const input = validateWorkflowInput(rawInput);
  assertWithinEvidenceBoundary(input);
  return candidateVersion === "generated"
    ? executeGeneratedReturnWorkflow(input)
    : executeSeededReturnWorkflow(input);
}

export function executeGeneratedReplacementWorkflow(
  rawInput: unknown,
  _deprecatedGeneratedConfig?: unknown,
): WorkflowExecution {
  const input = validateWorkflowInput(rawInput);
  assertWithinEvidenceBoundary(input);
  return executeGeneratedReturnWorkflow(input);
}

/** Compatibility dispatcher; business behavior remains isolated in modules. */
export function executeWorkflow(
  rawInput: unknown,
  system: SystemName,
  candidateVersion: CandidateVersion = "seeded",
): WorkflowExecution {
  const input = validateWorkflowInput(rawInput);
  assertWithinEvidenceBoundary(input);
  return system === "legacy"
    ? executeLegacyReturnWorkflow(input)
    : executeReplacementWorkflow(input, candidateVersion);
}

// Keep these imports live so package consumers can continue importing the
// historical domain facade while the implementation is physically separated.
void findScenario;
void scenarios;
void validateWorkflowInput;
void assertWithinEvidenceBoundary;
void createHostHiddenScenario;
