import cors, { type CorsOptions } from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { CodexRepairAdapter, CodexRepairFailure } from "./codex-adapter.js";
import { sha256Digest } from "./digest.js";
import { MigrationRunner } from "./migration-runner.js";
import { MigrationStore } from "./migration-store.js";
import { recordedCodexBuild } from "./recorded-codex-build.js";
import { ArtifactStore } from "./store.js";
import { TraceForgeService } from "./service.js";
import type { MigrationExecutionMode, MigrationProofBundle } from "./migration-types.js";
import type { CandidateVersion, ReturnWorkflowInput, SystemName } from "./types.js";

function isCandidateVersion(value: unknown): value is CandidateVersion {
  return value === "seeded" || value === "generated";
}

function isMigrationMode(value: unknown): value is MigrationExecutionMode {
  return value === "live-ai" || value === "recorded-replay" || value === "deterministic-only";
}

export interface AppDependencies {
  store?: ArtifactStore;
  service?: TraceForgeService;
  codexAdapter?: CodexRepairAdapter;
  migrationStore?: MigrationStore;
  migrationRunner?: MigrationRunner;
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
  const codexEnv = {
    ...env,
    TRACEFORGE_CODEX_BASE_COMMIT:
      env.TRACEFORGE_CODEX_BASE_COMMIT ?? recordedCodexBuild.baseCommit,
  };
  const codex = dependencies.codexAdapter ?? new CodexRepairAdapter({ env: codexEnv });
  const migrationStore = dependencies.migrationStore
    ?? new MigrationStore(dependencies.store ? ":memory:" : env.TRACEFORGE_DB);
  const migrationRunner = dependencies.migrationRunner ?? new MigrationRunner(service, migrationStore, env, codex);
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
      gpt56Status: migrationRunner.archaeology.status(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/scenarios", (_request, response) => {
    response.json({ data: service.listScenarios() });
  });

  app.get("/api/replacement/versions", (_request, response) => {
    response.json({
      data: [
        { id: "seeded", label: "Candidate 01 (observed-only)", purpose: "Contains two seeded rule and side-effect defects the verifier must reject" },
        { id: "generated", label: "Candidate 02 (complete module)", purpose: "The isolated Codex-editable replacement workflow" },
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
        throw new Error("candidateVersion must be seeded or generated");
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
        throw new Error("candidateVersion must be seeded or generated");
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
        throw new Error("candidateVersion must be seeded or generated");
      }
      response.status(201).json({ data: service.runDemo(body) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/verifications/suite", (request, response, next) => {
    try {
      const version = ((request.body ?? {}) as { candidateVersion?: CandidateVersion }).candidateVersion ?? "buggy";
      if (!isCandidateVersion(version)) throw new Error("candidateVersion must be seeded or generated");
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

  app.post("/api/migrations", (request, response, next) => {
    try {
      const body = (request.body ?? {}) as { executionMode?: unknown; scenarioIds?: unknown };
      if (!isMigrationMode(body.executionMode)) {
        return response.status(400).json({
          error: {
            code: "INVALID_EXECUTION_MODE",
            message: "executionMode must be live-ai, recorded-replay, or deterministic-only",
          },
        });
      }
      const scenarioIds = Array.isArray(body.scenarioIds)
        ? body.scenarioIds.filter((value): value is string => typeof value === "string")
        : undefined;
      const job = migrationRunner.start({ executionMode: body.executionMode, ...(scenarioIds ? { scenarioIds } : {}) });
      return response.status(202).json({ data: job });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/migrations/:id", (request, response) => {
    const job = migrationStore.getJob(request.params.id);
    if (!job) return response.status(404).json({ error: { code: "NOT_FOUND", message: "migration not found" } });
    return response.json({ data: job });
  });

  app.get("/api/migrations/:id/events", (request, response) => {
    const job = migrationStore.getJob(request.params.id);
    if (!job) return response.status(404).json({ error: { code: "NOT_FOUND", message: "migration not found" } });
    const afterQuery = Number(request.query.after ?? 0);
    const lastEventId = Number(request.header("last-event-id") ?? 0);
    const after = Number.isFinite(afterQuery) ? Math.max(0, afterQuery, lastEventId) : Math.max(0, lastEventId);
    const wantsJson = request.query.format === "json" || request.accepts(["text/event-stream", "json"]) === "json";
    if (wantsJson) {
      return response.json({ data: { events: migrationStore.listEvents(job.id, after) } });
    }

    response.status(200);
    response.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    const writeEvent = (event: ReturnType<MigrationStore["listEvents"]>[number]) => {
      response.write(`id: ${event.sequence}\n`);
      response.write(`event: ${event.type}\n`);
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    migrationStore.listEvents(job.id, after).forEach(writeEvent);
    const latest = migrationStore.getJob(job.id);
    if (latest?.status === "passed" || latest?.status === "failed") {
      response.end();
      return;
    }
    const unsubscribe = migrationStore.subscribe(job.id, (event) => {
      writeEvent(event);
      if (event.type === "job.completed" || event.type === "job.failed") {
        unsubscribe();
        clearInterval(heartbeat);
        response.end();
      }
    });
    const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 15_000);
    request.once("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.get("/api/migrations/:id/proof", (request, response) => {
    const artifact = migrationStore.getArtifactByFilename(request.params.id, "proof.json");
    if (!artifact) return response.status(404).json({ error: { code: "NOT_FOUND", message: "proof not found" } });
    return response.json({ data: JSON.parse(artifact.body) as MigrationProofBundle });
  });

  app.get("/api/migrations/:id/artifacts", (request, response) => {
    const job = migrationStore.getJob(request.params.id);
    if (!job) return response.status(404).json({ error: { code: "NOT_FOUND", message: "migration not found" } });
    return response.json({ data: { artifacts: migrationStore.listArtifacts(job.id) } });
  });

  app.get("/api/migrations/:id/downloads/:filename", (request, response) => {
    const artifact = migrationStore.getArtifactByFilename(request.params.id, request.params.filename);
    if (!artifact) return response.status(404).json({ error: { code: "NOT_FOUND", message: "artifact not found" } });
    response.set({
      "Content-Type": artifact.mimeType,
      "Content-Disposition": `attachment; filename="${artifact.filename.replaceAll('"', '')}"`,
      "X-Content-SHA256": artifact.digest,
    });
    return response.send(artifact.body);
  });

  app.post("/api/proofs/verify-digest", (request, response) => {
    const proof = ((request.body ?? {}) as { proofBundle?: unknown }).proofBundle;
    if (!proof || typeof proof !== "object") {
      return response.status(400).json({ error: { code: "INVALID_PROOF", message: "proofBundle is required" } });
    }
    const { digest: claimedDigest, ...body } = proof as Record<string, unknown>;
    const computedDigest = sha256Digest(body);
    return response.json({
      data: {
        valid: typeof claimedDigest === "string" && claimedDigest === computedDigest,
        claimedDigest,
        computedDigest,
      },
    });
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

  return { app, store, service, migrationStore, migrationRunner };
}
