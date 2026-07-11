export const LOCAL_RUNNER_VERSION = "0.1.1" as const;
export const LOCAL_RUNNER_RELEASE_TAG = "local-runner-v0.1.1" as const;
export const LOCAL_RUNNER_FIXTURE_TAG = "local-runner-fixture-v0.1.1" as const;

export interface LocalRunnerManifest {
  version: "traceforge.local-demo.v1";
  runnerVersion: typeof LOCAL_RUNNER_VERSION;
  releaseTag: typeof LOCAL_RUNNER_RELEASE_TAG;
  fixtureTag: typeof LOCAL_RUNNER_FIXTURE_TAG;
  demoId: "damaged-returns-v1";
  sourceRunId: string;
  baseCommit: string;
  model: "gpt-5.6-sol";
  repairInputDigest: string;
  contractFileDigest: string;
  failedProofsFileDigest: string;
  visibleScenariosFileDigest: string;
  baseCandidateDigest: string;
  allowedWrites: readonly ["apps/api/src/candidates/generated-return-workflow.ts"];
  agentCommandNetwork: false;
}

export const LOCAL_RUNNER_MANIFEST: LocalRunnerManifest = Object.freeze({
  version: "traceforge.local-demo.v1",
  runnerVersion: LOCAL_RUNNER_VERSION,
  releaseTag: LOCAL_RUNNER_RELEASE_TAG,
  fixtureTag: LOCAL_RUNNER_FIXTURE_TAG,
  demoId: "damaged-returns-v1",
  sourceRunId: "migration_77f7a45d-a07f-43c6-a0bd-cf4555ed7996",
  baseCommit: "7c1dceeaee7f375beb8d2895fda502f2ad74e039",
  model: "gpt-5.6-sol",
  repairInputDigest: "sha256:aea099f69b03e2a1905443eb4ff7044813c11d50248d8e31eadb6b8fa80c3542",
  contractFileDigest: "sha256:65de86684c52ac71f329d73e1cb34ec87472dc90dcabb859064d90db6a72f592",
  failedProofsFileDigest: "sha256:29ed01684dd9c9f1fc00790c240433ccd1499c886fafed3d593aa471e29d938d",
  visibleScenariosFileDigest: "sha256:c71cc5dfb885d395ffe581139a8c944b728acde9533cc60f583baf3d5bd79b5e",
  baseCandidateDigest: "sha256:200eb9a9aa0ec63f39908d63debb5e3ee59dbf4e03dc35488d770548c6a0a613",
  allowedWrites: ["apps/api/src/candidates/generated-return-workflow.ts"] as const,
  agentCommandNetwork: false,
});

export function validateLocalRunnerManifest(value: unknown): asserts value is LocalRunnerManifest {
  if (!value || typeof value !== "object") throw new Error("LOCAL_MANIFEST_INVALID");
  const manifest = value as Record<string, unknown>;
  const expected = LOCAL_RUNNER_MANIFEST as unknown as Record<string, unknown>;
  const keys = Object.keys(expected).sort();
  if (Object.keys(manifest).sort().join("\n") !== keys.join("\n")) {
    throw new Error("LOCAL_MANIFEST_FIELDS_INVALID");
  }
  for (const key of keys) {
    const actualValue = manifest[key];
    const expectedValue = expected[key];
    if (Array.isArray(expectedValue)) {
      if (!Array.isArray(actualValue) || actualValue.join("\n") !== expectedValue.join("\n")) {
        throw new Error(`LOCAL_MANIFEST_${key.toUpperCase()}_INVALID`);
      }
    } else if (actualValue !== expectedValue) {
      throw new Error(`LOCAL_MANIFEST_${key.toUpperCase()}_INVALID`);
    }
  }
}
