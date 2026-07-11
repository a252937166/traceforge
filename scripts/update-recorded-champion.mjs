#!/usr/bin/env node

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import { isRedactedWorktreePath } from "./export-redaction.mjs";

const root = new URL("../", import.meta.url);
const evidence = new URL("../docs/evidence/live-champion-run/", import.meta.url);
const invocationDirectory = new URL("invocations/", evidence);
const codexDirectory = new URL("codex/", evidence);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

async function findSession(directory, threadId) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findSession(path, threadId);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.endsWith(`${threadId}.jsonl`)) {
      return path;
    }
  }
  return undefined;
}

function parseCodexSession(raw, threadId) {
  const records = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const meta = records.find(({ type }) => type === "session_meta")?.payload;
  const started = records.find(({ type, payload }) => type === "event_msg" && payload?.type === "task_started");
  const completed = [...records].reverse().find(
    ({ type, payload }) => type === "event_msg" && payload?.type === "task_complete",
  );
  const tokenCount = [...records].reverse().find(
    ({ type, payload }) => type === "event_msg" && payload?.type === "token_count",
  )?.payload?.info?.total_token_usage;
  const prompt = records
    .filter(({ type, payload }) => type === "response_item" && payload?.type === "message" && payload?.role === "user")
    .at(-1)?.payload?.content
    ?.filter(({ type }) => type === "input_text")
    .map(({ text }) => text)
    .join("\n");
  const response = completed?.payload?.last_agent_message;
  if (meta?.id !== threadId || !prompt || !response) {
    throw new Error(`Incomplete Codex session evidence for ${threadId}`);
  }
  return {
    prompt,
    output: JSON.parse(response),
    startedAt: started?.timestamp,
    completedAt: completed?.timestamp,
    durationMs: completed?.payload?.duration_ms,
    timeToFirstTokenMs: completed?.payload?.time_to_first_token_ms,
    usage: tokenCount,
  };
}

const [job, proof, contract, commands, diff, eventsText, archaeologyOutput, firstHunter, secondHunter] = await Promise.all([
  readFile(new URL("job.json", evidence), "utf8").then(JSON.parse),
  readFile(new URL("proof.json", evidence), "utf8").then(JSON.parse),
  readFile(new URL("contract.json", evidence), "utf8").then(JSON.parse),
  readFile(new URL("commands.json", evidence), "utf8").then(JSON.parse),
  readFile(new URL("candidate.diff", evidence), "utf8"),
  readFile(new URL("events.jsonl", evidence), "utf8"),
  readFile(new URL("01-trace-archaeologist.output.json", invocationDirectory), "utf8").then(JSON.parse),
  readFile(new URL("02-counterexample-crossed-input.output.json", invocationDirectory), "utf8").then(JSON.parse),
  readFile(new URL("03-counterexample-high-value.output.json", invocationDirectory), "utf8").then(JSON.parse),
]);

if (job.status !== "passed" || proof.status !== "PASSED") {
  throw new Error("Canonical champion evidence is not a passing run");
}
const events = eventsText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const acceptedCandidateEvent = events.find(
  ({ type, status, payload }) => type === "candidate.updated" && status === "passed" && payload?.candidate,
);
if (!acceptedCandidateEvent) throw new Error("Accepted candidate event is missing");
const exportedWorktree = acceptedCandidateEvent.payload.worktree?.path;
const worktree = process.env.TRACEFORGE_RETAINED_WORKTREE
  ?? (isRedactedWorktreePath(exportedWorktree) ? undefined : exportedWorktree);
if (!worktree) {
  throw new Error(
    "Canonical evidence redacts the retained worktree path; set TRACEFORGE_RETAINED_WORKTREE to the local retained worktree before updating the recorded replay.",
  );
}

const modelCounterexamples = events
  .filter(({ type, payload }) => type === "counterexample.updated" && ["LIVE-CX-01", "LIVE-CX-02"].includes(payload?.counterexample?.id))
  .map(({ payload }) => payload.counterexample);
const archaeology = {
  sourceRunId: job.id,
  disclosure: "Recorded real GPT-5.6 Sol and Codex run — replay only; no model call is running now.",
  initialHypotheses: archaeologyOutput.hypotheses.map((hypothesis) => ({
    id: hypothesis.ruleId,
    revision: 1,
    statement: hypothesis.statement,
    status: "challenged",
    confidence: hypothesis.confidence,
    evidenceIds: hypothesis.evidenceIds,
  })),
  counterexamples: modelCounterexamples,
  refinedHypotheses: contract.rules.map((rule) => ({
    id: rule.ruleId,
    revision: 2,
    statement: rule.statement,
    status: "accepted",
    confidence: rule.confidence,
    evidenceIds: rule.evidenceIds,
  })),
  contract,
  modelProposals: [firstHunter.scenario, secondHunter.scenario],
};
await writeFile(
  new URL("apps/api/src/recorded-archaeology.generated.json", root),
  `${JSON.stringify({ recordedAt: job.completedAt, archaeology }, null, 2)}\n`,
  "utf8",
);

const candidateEvent = acceptedCandidateEvent.payload;
const generatedCommand = commands.find(({ command }) => command.includes("verify:generated"));
const generatedJson = generatedCommand?.stdout
  ?.split(/\r?\n/)
  .map((line) => line.trim())
  .find((line) => line.startsWith('{"suite"'));
if (!generatedJson) throw new Error("Generated suite JSON is missing from commands.json");
const generatedSuite = JSON.parse(generatedJson).suite;
const javascriptSource = await readFile(new URL("apps/api/dist/candidates/generated-return-workflow.js", root), "utf8");
const codexBuild = {
  verified: true,
  recordedAt: job.completedAt,
  sourceRunId: job.id,
  threadId: proof.candidate.codexThreadId,
  model: "gpt-5.6-sol",
  baseCommit: proof.candidate.baseCommit,
  changedFiles: proof.candidate.changedFiles,
  usage: {
    inputTokens: candidateEvent.usage.input_tokens,
    cachedInputTokens: candidateEvent.usage.cached_input_tokens,
    outputTokens: candidateEvent.usage.output_tokens,
    reasoningOutputTokens: candidateEvent.usage.reasoning_output_tokens,
  },
  repairInput: candidateEvent.repairInput,
  sourceDigest: proof.candidate.sourceDigest,
  diffDigest: proof.candidate.diffDigest,
  executableSourceDigests: {
    typescript: proof.candidate.sourceDigest,
    javascript: digest(javascriptSource),
  },
  freshProofIds: generatedSuite.runs.map(({ proofId }) => proofId),
  diff,
  commands,
};
await writeFile(
  new URL("apps/api/src/recorded-codex-build.generated.json", root),
  `${JSON.stringify(codexBuild, null, 2)}\n`,
  "utf8",
);

const threadId = proof.candidate.codexThreadId;
const sessionPath = await findSession(
  process.env.TRACEFORGE_CODEX_SESSION_ROOT ?? join(homedir(), ".codex", "sessions"),
  threadId,
);
if (!sessionPath) throw new Error(`Codex session ${threadId} was not found`);
const codexSession = parseCodexSession(await readFile(sessionPath, "utf8"), threadId);
await mkdir(codexDirectory, { recursive: true });
const [behaviorContract, failedProofs, visibleScenarios, candidateSource] = await Promise.all([
  readFile(join(worktree, ".traceforge", "behavior-contract.json"), "utf8"),
  readFile(join(worktree, ".traceforge", "failed-proofs.json"), "utf8"),
  readFile(join(worktree, ".traceforge", "visible-scenarios.json"), "utf8"),
  readFile(join(worktree, "apps/api/src/candidates/generated-return-workflow.ts"), "utf8"),
]);
await Promise.all([
  writeFile(new URL("input.txt", codexDirectory), `${codexSession.prompt}\n`, "utf8"),
  writeFile(new URL("output.json", codexDirectory), `${JSON.stringify(codexSession.output, null, 2)}\n`, "utf8"),
  writeFile(new URL("behavior-contract.json", codexDirectory), behaviorContract, "utf8"),
  writeFile(new URL("failed-proofs.json", codexDirectory), failedProofs, "utf8"),
  writeFile(new URL("visible-scenarios.json", codexDirectory), visibleScenarios, "utf8"),
  writeFile(new URL("candidate-source.ts", codexDirectory), candidateSource, "utf8"),
  writeFile(
    new URL("metadata.json", codexDirectory),
    `${JSON.stringify({
      threadId,
      model: "gpt-5.6-sol",
      startedAt: codexSession.startedAt,
      completedAt: codexSession.completedAt,
      durationMs: codexSession.durationMs,
      timeToFirstTokenMs: codexSession.timeToFirstTokenMs,
      usage: codexSession.usage,
      promptDigest: digest(codexSession.prompt),
      outputDigest: digest(codexSession.output),
      baseCommit: proof.candidate.baseCommit,
      changedFiles: proof.candidate.changedFiles,
      repairInput: candidateEvent.repairInput,
      sourceDigest: proof.candidate.sourceDigest,
      diffDigest: proof.candidate.diffDigest,
    }, null, 2)}\n`,
    "utf8",
  ),
]);

console.log(JSON.stringify({ sourceRunId: job.id, modelTurns: proof.modelInvocations.length, codexThreadId: threadId, proof: proof.digest }, null, 2));
