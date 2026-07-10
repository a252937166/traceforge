import {
  executeGeneratedReturnWorkflow,
  executeSeededReturnWorkflow,
} from "./candidates/generated-return-workflow.js";
import { executeLegacyReturnWorkflow } from "./legacy/return-workflow.js";
import { findScenario, scenarios, validateWorkflowInput } from "./scenarios.js";
import type {
  CandidateVersion,
  SystemName,
  WorkflowExecution,
} from "./types.js";

export { findScenario, scenarios, validateWorkflowInput } from "./scenarios.js";

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
  return candidateVersion === "generated"
    ? executeGeneratedReturnWorkflow(rawInput)
    : executeSeededReturnWorkflow(rawInput);
}

export function executeGeneratedReplacementWorkflow(
  rawInput: unknown,
  _deprecatedGeneratedConfig?: unknown,
): WorkflowExecution {
  return executeGeneratedReturnWorkflow(rawInput);
}

/** Compatibility dispatcher; business behavior remains isolated in modules. */
export function executeWorkflow(
  rawInput: unknown,
  system: SystemName,
  candidateVersion: CandidateVersion = "seeded",
): WorkflowExecution {
  return system === "legacy"
    ? executeLegacyReturnWorkflow(rawInput)
    : executeReplacementWorkflow(rawInput, candidateVersion);
}

// Keep these imports live so package consumers can continue importing the
// historical domain facade while the implementation is physically separated.
void findScenario;
void scenarios;
void validateWorkflowInput;
