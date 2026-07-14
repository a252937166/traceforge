import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Usage } from "@openai/codex-sdk";
import { buildChildEnvironment, isCodexSdkInstalled } from "./codex-adapter.js";
import { sha256Digest } from "./digest.js";
import type { ModelInvocationEvidence } from "./migration-types.js";

export const GPT56_MODEL = "gpt-5.6-sol" as const;

export type ArchaeologyRole =
  | "trace-archaeologist"
  | "counterexample-hunter"
  | "contract-critic";

export interface ArchaeologyAdapterStatus {
  installed: boolean;
  enabled: boolean;
  configured: boolean;
  model: typeof GPT56_MODEL;
  truthfulBoundary: string;
}

export interface ArchaeologyResult<T> {
  output: T;
  invocation: ModelInvocationEvidence;
}

const predicateSchema = {
  type: "object",
  properties: {
    field: { type: "string", enum: ["amountCents", "customerTier", "itemCondition"] },
    op: { type: "string", enum: ["eq", "gte", "lt"] },
    value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] },
  },
  required: ["field", "op", "value"],
  additionalProperties: false,
} as const;

export const archaeologySchemas = {
  "trace-archaeologist": {
    type: "object",
    properties: {
      role: { type: "string", const: "trace_archaeologist" },
      hypotheses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ruleId: { type: "string" },
            statement: { type: "string" },
            preconditions: { type: "array", items: predicateSchema },
            predicted: {
              type: "object",
              properties: {
                decision: { type: "string", enum: ["REFUND", "REPLACEMENT", "MANUAL_REVIEW"] },
                inventoryEffect: {
                  type: "string",
                  enum: ["SELLABLE_PLUS_ONE", "QUARANTINE_PLUS_ONE", "UNCHANGED"],
                },
              },
              required: ["decision", "inventoryEffect"],
              additionalProperties: false,
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            evidenceIds: { type: "array", items: { type: "string" } },
            competingRuleIds: { type: "array", items: { type: "string" } },
          },
          required: [
            "ruleId",
            "statement",
            "preconditions",
            "predicted",
            "confidence",
            "evidenceIds",
            "competingRuleIds",
          ],
          additionalProperties: false,
        },
      },
      invariants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            invariantId: { type: "string" },
            statement: { type: "string" },
            evidenceIds: { type: "array", items: { type: "string" } },
          },
          required: ["invariantId", "statement", "evidenceIds"],
          additionalProperties: false,
        },
      },
      unknowns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            unknownId: { type: "string" },
            question: { type: "string" },
            blocking: { type: "boolean" },
            relatedRuleIds: { type: "array", items: { type: "string" } },
          },
          required: ["unknownId", "question", "blocking", "relatedRuleIds"],
          additionalProperties: false,
        },
      },
    },
    required: ["role", "hypotheses", "invariants", "unknowns"],
    additionalProperties: false,
  },
  "counterexample-hunter": {
    type: "object",
    properties: {
      role: { type: "string", const: "counterexample_hunter" },
      scenario: {
        type: "object",
        properties: {
          scenarioId: { type: "string" },
          input: {
            type: "object",
            properties: {
              returnId: { type: "string" },
              sku: { type: "string" },
              amountCents: { type: "integer", minimum: 1, maximum: 100_000 },
              customerTier: { type: "string", enum: ["STANDARD", "VIP"] },
              itemCondition: { type: "string", const: "DAMAGED" },
              initialInventory: {
                type: "object",
                properties: {
                  sellable: { type: "integer", minimum: 0 },
                  quarantine: { type: "integer", minimum: 0 },
                },
                required: ["sellable", "quarantine"],
                additionalProperties: false,
              },
            },
            required: [
              "returnId",
              "sku",
              "amountCents",
              "customerTier",
              "itemCondition",
              "initialInventory",
            ],
            additionalProperties: false,
          },
        },
        required: ["scenarioId", "input"],
        additionalProperties: false,
      },
      distinguishes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ruleId: { type: "string" },
            fromRuleId: { type: "string" },
            reason: { type: "string" },
          },
          required: ["ruleId", "fromRuleId", "reason"],
          additionalProperties: false,
        },
      },
      expectedInformationGain: { type: "string" },
      basedOnEvidenceIds: { type: "array", items: { type: "string" } },
    },
    required: ["role", "scenario", "distinguishes", "expectedInformationGain", "basedOnEvidenceIds"],
    additionalProperties: false,
  },
  "contract-critic": {
    type: "object",
    properties: {
      role: { type: "string", const: "contract_critic" },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            findingId: { type: "string" },
            type: {
              type: "string",
              enum: ["UNSUPPORTED_ASSUMPTION", "COVERAGE_GAP", "CONFLICTING_EVIDENCE", "UNKNOWN"],
            },
            severity: { type: "string", enum: ["BLOCKING", "WARNING"] },
            claim: { type: "string" },
            ruleIds: { type: "array", items: { type: "string" } },
            evidenceIds: { type: "array", items: { type: "string" } },
            requiredAction: { type: "string" },
          },
          required: ["findingId", "type", "severity", "claim", "ruleIds", "evidenceIds", "requiredAction"],
          additionalProperties: false,
        },
      },
      revisedRules: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ruleId: { type: "string" },
            statement: { type: "string" },
            priority: { type: "integer", minimum: 1 },
            evidenceIds: { type: "array", items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["ruleId", "statement", "priority", "evidenceIds", "confidence"],
          additionalProperties: false,
        },
      },
      resolvedUnknowns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            unknownId: { type: "string", minLength: 1 },
            resolution: { type: "string", minLength: 1 },
            evidenceIds: { type: "array", minItems: 1, items: { type: "string" } },
          },
          required: ["unknownId", "resolution", "evidenceIds"],
          additionalProperties: false,
        },
      },
      remainingUnknowns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            unknownId: { type: "string", minLength: 1 },
            inScope: { type: "boolean" },
            reason: { type: "string", minLength: 1 },
          },
          required: ["unknownId", "inScope", "reason"],
          additionalProperties: false,
        },
      },
      disposition: {
        type: "string",
        enum: ["NEEDS_COUNTEREXAMPLE", "READY_FOR_BUILD", "STOP_UNSUPPORTED"],
      },
    },
    required: [
      "role",
      "findings",
      "revisedRules",
      "resolvedUnknowns",
      "remainingUnknowns",
      "disposition",
    ],
    additionalProperties: false,
  },
} as const;

function usageEvidence(usage: Usage | null): ModelInvocationEvidence["usage"] {
  if (!usage) return {};
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
  };
}

function collectEvidenceIds(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectEvidenceIds(entry, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "evidenceIds" || key === "basedOnEvidenceIds") && Array.isArray(child)) {
      for (const id of child) if (typeof id === "string") found.push(id);
    } else {
      collectEvidenceIds(child, found);
    }
  }
  return found;
}

export function validateArchaeologyEvidence(output: unknown, allowedEvidenceIds: Iterable<string>): void {
  const allowed = new Set(allowedEvidenceIds);
  const unknown = [...new Set(collectEvidenceIds(output))].filter((id) => !allowed.has(id));
  if (unknown.length > 0) {
    throw new Error(`GPT-5.6 output referenced unknown evidence IDs: ${unknown.join(", ")}`);
  }
}

export class BehaviorArchaeologyAdapter {
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  status(): ArchaeologyAdapterStatus {
    const installed = isCodexSdkInstalled();
    const enabled = this.env.TRACEFORGE_ENABLE_GPT56 === "1";
    return {
      installed,
      enabled,
      configured: installed && enabled,
      model: GPT56_MODEL,
      truthfulBoundary: !installed
        ? "The Codex SDK is unavailable; GPT-5.6 behavior archaeology cannot run."
        : !enabled
          ? "GPT-5.6 behavior archaeology is disabled. Set TRACEFORGE_ENABLE_GPT56=1 explicitly."
          : "GPT-5.6 Sol is enabled for read-only, schema-constrained behavior archaeology. The host validates evidence references and executes every proposed scenario.",
    };
  }

  async run<T>(options: {
    role: ArchaeologyRole;
    prompt: string;
    inputTraceIds: string[];
    inputEvidenceDigests: string[];
    allowedEvidenceIds: string[];
    signal?: AbortSignal;
  }): Promise<ArchaeologyResult<T>> {
    const status = this.status();
    if (!status.configured) throw new Error("GPT56_ADAPTER_NOT_CONFIGURED");

    const startedAt = new Date().toISOString();
    const inputDigest = sha256Digest({ role: options.role, prompt: options.prompt });
    const workingDirectory = await mkdtemp(join(tmpdir(), "traceforge-archaeology-"));
    try {
      const sdk = await import("@openai/codex-sdk");
      const explicitApiKey = this.env.TRACEFORGE_CODEX_API_KEY;
      const codex = new sdk.Codex({
        env: buildChildEnvironment(this.env),
        ...(explicitApiKey ? { apiKey: explicitApiKey } : {}),
      });
      const thread = codex.startThread({
        model: GPT56_MODEL,
        workingDirectory,
        skipGitRepoCheck: true,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        modelReasoningEffort: "high",
      });
      const turn = await thread.run(options.prompt, {
        outputSchema: archaeologySchemas[options.role],
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (!thread.id) throw new Error("GPT-5.6 completed without a thread id");
      const output = JSON.parse(turn.finalResponse) as T;
      validateArchaeologyEvidence(output, options.allowedEvidenceIds);
      const completedAt = new Date().toISOString();
      return {
        output,
        invocation: {
          role: options.role,
          provider: "openai",
          model: GPT56_MODEL,
          authPath: explicitApiKey ? "responses-api" : "codex-chatgpt",
          threadId: thread.id,
          startedAt,
          completedAt,
          usage: usageEvidence(turn.usage),
          inputTraceIds: options.inputTraceIds,
          inputEvidenceDigests: options.inputEvidenceDigests,
          inputDigest,
          outputDigest: sha256Digest(output),
          schemaVersion: "traceforge.behavior-archaeology.v1",
          status: "succeeded",
        },
      };
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }
}
