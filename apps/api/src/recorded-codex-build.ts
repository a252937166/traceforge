import recordedCodexEvidence from "./recorded-codex-build.generated.json" with { type: "json" };
import type { MigrationProofBundle } from "./migration-types.js";

/** Exact, redacted metadata and artifacts from the canonical real Codex run. */
export const recordedCodexBuild = recordedCodexEvidence as typeof recordedCodexEvidence & {
  verified: true;
  model: "gpt-5.6-sol";
  hostVerification: NonNullable<MigrationProofBundle["hostVerification"]>;
};
