import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { CodexRepairAdapter } from "./codex-adapter.js";
import { ArtifactStore } from "./store.js";
import { TraceForgeService } from "./service.js";
import type { CandidateVersion, ReturnWorkflowInput, SystemName } from "./types.js";

export interface AppDependencies {
  store?: ArtifactStore;
  service?: TraceForgeService;
}

export function createApp(dependencies: AppDependencies = {}) {
  const store = dependencies.store ?? new ArtifactStore();
  const service = dependencies.service ?? new TraceForgeService(store);
  const codex = new CodexRepairAdapter();
  const app = express();

  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "traceforge-api",
      sqlite: "ready",
      codexConfigured: false,
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
      if (body.candidateVersion && body.candidateVersion !== "buggy" && body.candidateVersion !== "fixed") {
        throw new Error("candidateVersion must be buggy or fixed");
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
      response.status(201).json({ data: service.runDemo(body) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/verifications/suite", (request, response, next) => {
    try {
      const version = ((request.body ?? {}) as { candidateVersion?: CandidateVersion }).candidateVersion ?? "buggy";
      if (version !== "buggy" && version !== "fixed") throw new Error("candidateVersion must be buggy or fixed");
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

  app.post("/api/adapters/codex/repair", (_request, response) => {
    response.status(501).json({
      error: {
        code: "CODEX_ADAPTER_NOT_CONFIGURED",
        message: codex.status().truthfulBoundary,
        status: codex.status(),
      },
    });
  });

  app.use((_request, response) => {
    response.status(404).json({ error: { code: "NOT_FOUND", message: "route not found" } });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
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
