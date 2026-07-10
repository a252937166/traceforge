export interface CodexRepairAdapterStatus {
  configured: boolean;
  mode: "not-configured";
  truthfulBoundary: string;
  integrationContract: {
    input: string;
    output: string;
  };
}

export class CodexRepairAdapter {
  status(): CodexRepairAdapterStatus {
    return {
      configured: false,
      mode: "not-configured",
      truthfulBoundary:
        "This MVP does not invoke Codex. Wire an authenticated Codex SDK/MCP worker here before presenting automated repair as real.",
      integrationContract: {
        input: "ProofBundle + isolated repository worktree + explicit allowed file paths",
        output: "Patch metadata + test command output + new candidate version identifier",
      },
    };
  }

  repair(): never {
    throw new Error("CODEX_ADAPTER_NOT_CONFIGURED");
  }
}
