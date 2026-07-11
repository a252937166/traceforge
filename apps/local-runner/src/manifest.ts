export const LOCAL_RUNNER_VERSION = "0.1.7" as const;
export const LOCAL_RUNNER_RELEASE_TAG = "local-runner-v0.1.7" as const;
export const LOCAL_RUNNER_FIXTURE_TAG = "local-runner-fixture-v0.1.7" as const;

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
  sourceRunId: "migration_efaa0383-628a-4fba-94df-96bfe344bcbe",
  baseCommit: "eb0e6169974b96bd3bff3b536b38ef5f665127c2",
  model: "gpt-5.6-sol",
  repairInputDigest: "sha256:afe5ac02691e8929f1600f00bf57247b1915da88b759892087deb3b6e81755b8",
  contractFileDigest: "sha256:06d540c79f9527226ba3a4833d87828a9ebfec1598fcceeedbcef1cfaf2c824a",
  failedProofsFileDigest: "sha256:7713ceb157151e8f8a32ed2365db2a827f94418b93853041958a85208c88292b",
  visibleScenariosFileDigest: "sha256:32bb2700b2d4fa659a01059b9cb928bd889d25e33b5c7208af2eb8fe7c4aec97",
  baseCandidateDigest: "sha256:05844477fc80904aebf51825c10f20611c8f6a1dc2af117079a17dc60bf2503f",
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
