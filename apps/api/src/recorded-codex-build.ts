/**
 * Release recording populated only after a real isolated Codex run changes the
 * complete candidate module and the host verifier accepts the fresh suite.
 * Keeping `verified` false makes an incomplete recording fail closed.
 */
export const recordedCodexBuild = {
  verified: false,
  recordedAt: "",
  threadId: "",
  model: "gpt-5.6-sol",
  baseCommit: "",
  changedFiles: [] as string[],
  diff: "",
  sourceDigest: "",
  commands: [] as Array<{ command: string; exitCode: number; summary: string }>,
} as const;
