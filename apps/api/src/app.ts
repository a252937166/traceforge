import cors, { type CorsOptions } from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { CodexRepairAdapter, CodexRepairFailure } from "./codex-adapter.js";
import { ArtifactStore } from "./store.js";
import { TraceForgeService } from "./service.js";
import type { CandidateVersion, ReturnWorkflowInput, SystemName } from "./types.js";

function isCandidateVersion(value: unknown): value is CandidateVersion {
  return value === "buggy" || value === "fixed" || value === "generated";
}

export interface AppDependencies {
  store?: ArtifactStore;
  service?: TraceForgeService;
  codexAdapter?: CodexRepairAdapter;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:4173",
  "http://127.0.0.1",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:4173",
];

export class CorsOriginDeniedError extends Error {
  readonly code = "CORS_ORIGIN_DENIED";

  constructor(readonly origin: string) {
    super(`browser origin is not allowed: ${origin}`);
    this.name = "CorsOriginDeniedError";
  }
}

export function buildAllowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const configured = (env.TRACEFORGE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

export function createApp(dependencies: AppDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const store = dependencies.store ?? new ArtifactStore();
  const service = dependencies.service ?? new TraceForgeService(store);
  const codex = dependencies.codexAdapter ?? new CodexRepairAdapter({ env });
  const allowedOrigins = buildAllowedOrigins(env);
  const app = express();

  app.disable("x-powered-by");
  const corsOptions: CorsOptions = {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new CorsOriginDeniedError(origin));
    },
  };
  app.use(cors(corsOptions));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    const codexStatus = codex.status();
    response.json({
      status: "ok",
      service: "traceforge-api",
      sqlite: "ready",
      codexInstalled: codexStatus.installed,
      codexEnabled: codexStatus.enabled,
      codexConfigured: codexStatus.configured,
      codexStatus,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/scenarios", (_request, response) => {
    response.json({ data: service.listScenarios() });
  });

  app.get("/api/replacement/versions", (_request, response) => {
    response.json({
      data: [
        { id: "buggy", label: "Candidate v0 (known mutation)", purpose: "Demonstrates verifier sensitivity" },
        { id: "fixed", label: "Reference fixed candidate", purpose: "Demonstrates a passing rerun without claiming Codex produced it" },
        { id: "generated", label: "Generated candidate", purpose: "Reads the isolated Codex-editable repair configuration" },
      ],
    });
  });

  app.post("/api/traces/capture", (request, response, next) => {
    try {
      const body = request.body as {
        system?: SystemName;
        candidateVersion?: CandidateVersion;
        scenarioId?: string;
        input?: ReturnWorkflowInput;
      };
      if (body.system !== "legacy" && body.system !== "replacement") {
        throw new Error("system must be legacy or replacement");
      }
      if (body.candidateVersion && !isCandidateVersion(body.candidateVersion)) {
        throw new Error("candidateVersion must be buggy, fixed, or generated");
      }
      if (!body.input) throw new Error("input is required");
      const trace = service.capture(body.system, body.input, body.candidateVersion, body.scenarioId);
      const contract = body.system === "legacy" ? service.extractContract(trace) : undefined;
      response.status(201).json({ data: { trace, ...(contract ? { contract } : {}) } });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/demo/run", (request, response, next) => {
    try {
      const body = (request.body ?? {}) as {
        scenarioId?: string;
        input?: ReturnWorkflowInput;
        candidateVersion?: CandidateVersion;
      };
      if (body.candidateVersion && !isCandidateVersion(body.candidateVersion)) {
        throw new Error("candidateVersion must be buggy, fixed, or generated");
      }
      response.status(201).json(service.runDemo(body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/verifications", (request, response, next) => {
    try {
      const body = (request.body ?? {}) as {
        scenarioId?: string;
        input?: ReturnWorkflowInput;
        candidateVersion?: CandidateVersion;
      };
      if (body.candidateVersion && !isCandidateVersion(body.candidateVersion)) {
        throw new Error("candidateVersion must be buggy, fixed, or generated");
      }
      response.status(201).json({ data: service.runDemo(body) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/verifications/suite", (request, response, next) => {
    try {
      const version = ((request.body ?? {}) as { candidateVersion?: CandidateVersion }).candidateVersion ?? "buggy";
      if (!isCandidateVersion(version)) throw new Error("candidateVersion must be buggy, fixed, or generated");
      response.status(201).json({ data: service.runSuite(version) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/traces/:id", (request, response) => {
    const trace = store.getTrace(request.params.id);
    if (!trace) return response.status(404).json({ error: { code: "NOT_FOUND", message: "trace not found" } });
    return response.json({ data: trace });
  });

  app.get("/api/contracts/:id", (request, response) => {
    const contract = store.getContract(request.params.id);
    if (!contract) return response.status(404).json({ error: { code: "NOT_FOUND", message: "contract not found" } });
    return response.json({ data: contract });
  });

  app.get("/api/proofs/:id", (request, response) => {
    const proof = store.getProof(request.params.id);
    if (!proof) return response.status(404).json({ error: { code: "NOT_FOUND", message: "proof not found" } });
    return response.json({ data: proof });
  });

  app.get("/api/adapters/codex", (_request, response) => {
    response.json({ data: codex.status() });
  });

  app.post("/api/adapters/codex/repair", async (request, response, next) => {
    try {
      if (!request.is("application/json")) {
        return response.status(415).json({
          error: {
            code: "JSON_CONTENT_TYPE_REQUIRED",
            message: "Codex repair requests must use Content-Type: application/json",
          },
        });
      }
      const adapterStatus = codex.status();
      if (!adapterStatus.configured) {
        return response.status(501).json({
          error: {
            code: "CODEX_ADAPTER_NOT_CONFIGURED",
            message: adapterStatus.truthfulBoundary,
            status: adapterStatus,
          },
        });
      }
      const proofId = (request.body as { proofId?: unknown } | undefined)?.proofId;
      if (typeof proofId !== "string" || !proofId.trim()) {
        return response.status(400).json({
          error: { code: "INVALID_REQUEST", message: "proofId is required" },
        });
      }
      const proof = store.getProof(proofId);
      if (!proof) {
        return response.status(404).json({
          error: { code: "NOT_FOUND", message: "proof not found" },
        });
      }
      if (proof.status !== "FAILED") {
        return response.status(409).json({
          error: { code: "PROOF_NOT_FAILED", message: "Codex repair requires a FAILED proof" },
        });
      }
      const result = await codex.repair(proof);
      return response.status(result.verification.status === "PASSED" ? 200 : 422).json({ data: result });
    } catch (error) {
      return next(error);
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: { code: "NOT_FOUND", message: "route not found" } });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof CorsOriginDeniedError) {
      return response.status(403).json({
        error: {
          code: error.code,
          message: error.message,
          origin: error.origin,
        },
      });
    }
    if (error instanceof CodexRepairFailure) {
      return response.status(502).json({
        error: {
          code: error.code,
          message: error.message,
          evidence: error.evidence,
        },
      });
    }
    const message = error instanceof Error ? error.message : "unexpected error";
    const isConfigurationError = message === "CODEX_ADAPTER_NOT_CONFIGURED";
    response.status(isConfigurationError ? 501 : 400).json({
      error: {
        code: isConfigurationError ? message : "INVALID_REQUEST",
        message,
      },
    });
  });

  return { app, store, service };
}
