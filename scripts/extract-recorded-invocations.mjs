#!/usr/bin/env node

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

const repositoryRoot = new URL("../", import.meta.url);
const outputDirectory = new URL("../docs/evidence/live-champion-run/invocations/", import.meta.url);
const runtimeEvidenceFile = new URL(
  "../apps/api/src/recorded-model-invocations.generated.json",
  import.meta.url,
);
const sessionRoot = process.env.TRACEFORGE_CODEX_SESSION_ROOT
  ?? join(homedir(), ".codex", "sessions");

const canonicalProof = JSON.parse(
  await readFile(new URL("../docs/evidence/live-champion-run/proof.json", import.meta.url), "utf8"),
);
const roleCounts = new Map();
const expectedInvocations = canonicalProof.modelInvocations.map((invocation, index) => {
  const count = (roleCounts.get(invocation.role) ?? 0) + 1;
  roleCounts.set(invocation.role, count);
  const slug = invocation.role === "counterexample-hunter"
    ? count === 1
      ? "counterexample-crossed-input"
      : count === 2
        ? "counterexample-high-value"
        : `counterexample-high-value-${count - 1}`
    : invocation.role === "contract-critic"
      ? count === 1 ? "contract-critic" : `contract-critic-${count}`
      : invocation.role;
  return {
    order: index + 1,
    slug,
    role: invocation.role,
    threadId: invocation.threadId,
  };
});

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

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function uniqueMatches(value, expression) {
  return [...new Set(value.match(expression) ?? [])];
}

async function findSessionFile(directory, threadId) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findSessionFile(path, threadId);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.endsWith(`${threadId}.jsonl`)) {
      return path;
    }
  }
  return undefined;
}

function parseSession(raw, expected) {
  const records = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const meta = records.find(({ type }) => type === "session_meta")?.payload;
  const turn = [...records].reverse().find(
    ({ type, payload }) => type === "turn_context" && payload?.model,
  )?.payload;
  const taskStarted = records.find(
    ({ type, payload }) => type === "event_msg" && payload?.type === "task_started",
  );
  const taskComplete = [...records].reverse().find(
    ({ type, payload }) => type === "event_msg" && payload?.type === "task_complete",
  );
  const tokenCount = [...records].reverse().find(
    ({ type, payload }) => type === "event_msg" && payload?.type === "token_count",
  )?.payload?.info?.total_token_usage;
  const userMessages = records.filter(
    ({ type, payload }) =>
      type === "response_item" && payload?.type === "message" && payload?.role === "user",
  );
  const prompt = userMessages
    .at(-1)?.payload?.content
    ?.filter(({ type }) => type === "input_text")
    .map(({ text }) => text)
    .join("\n");
  const finalResponse = taskComplete?.payload?.last_agent_message;

  if (meta?.id !== expected.threadId) {
    throw new Error(`Session id mismatch for ${expected.threadId}`);
  }
  if (!prompt?.startsWith("You are a read-only behavior analyst.")) {
    throw new Error(`Could not identify the bounded TraceForge prompt for ${expected.threadId}`);
  }
  if (!finalResponse) {
    throw new Error(`Missing final model response for ${expected.threadId}`);
  }

  let output;
  try {
    output = JSON.parse(finalResponse);
  } catch {
    throw new Error(`Final response is not structured JSON for ${expected.threadId}`);
  }

  const inputTraceIds = [...new Set(
    [...prompt.matchAll(/"traceId"\s*:\s*"(trace_[0-9a-f-]{36})"/g)].map((match) => match[1]),
  )];
  const inputEvidenceDigests = uniqueMatches(prompt, /sha256:[0-9a-f]{64}/g);
  return {
    prompt,
    output,
    metadata: {
      order: expected.order,
      role: expected.role,
      provider: "openai",
      model: turn?.model,
      authPath: "codex-chatgpt",
      threadId: expected.threadId,
      startedAt: taskStarted?.timestamp,
      completedAt: taskComplete?.timestamp,
      durationMs: taskComplete?.payload?.duration_ms,
      timeToFirstTokenMs: taskComplete?.payload?.time_to_first_token_ms,
      usage: tokenCount,
      inputTraceIds,
      inputEvidenceDigests,
      inputDigest: digest({ role: expected.role, prompt }),
      outputDigest: digest(output),
      schemaVersion: "traceforge.behavior-archaeology.v1",
      status: "succeeded",
      sourceSession: `${expected.threadId}.jsonl`,
    },
  };
}

await mkdir(outputDirectory, { recursive: true });
const manifest = {
  disclosure:
    `Extracted from ${expectedInvocations.length} recorded Codex SDK sessions. Files contain only the bounded application prompt, final structured output, and turn metadata; system and developer context is excluded.`,
  invocations: [],
};

for (const expected of expectedInvocations) {
  const sessionPath = await findSessionFile(sessionRoot, expected.threadId);
  if (!sessionPath) {
    throw new Error(`No Codex session found for ${expected.threadId} under ${sessionRoot}`);
  }
  const parsed = parseSession(await readFile(sessionPath, "utf8"), expected);
  const prefix = `${String(expected.order).padStart(2, "0")}-${expected.slug}`;
  const inputFile = `${prefix}.input.txt`;
  const outputFile = `${prefix}.output.json`;
  const metadataFile = `${prefix}.metadata.json`;
  await Promise.all([
    writeFile(new URL(inputFile, outputDirectory), `${parsed.prompt}\n`, "utf8"),
    writeFile(new URL(outputFile, outputDirectory), `${JSON.stringify(parsed.output, null, 2)}\n`, "utf8"),
    writeFile(new URL(metadataFile, outputDirectory), `${JSON.stringify(parsed.metadata, null, 2)}\n`, "utf8"),
  ]);
  manifest.invocations.push({
    ...parsed.metadata,
    inputFile,
    outputFile,
    metadataFile,
    sourceSession: relative(sessionRoot, sessionPath),
  });
}

await writeFile(
  new URL("manifest.json", outputDirectory),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

const runtimeEvidence = {
  generatedFrom: "docs/evidence/live-champion-run/invocations/manifest.json",
  invocations: manifest.invocations.map((invocation) => ({
    role: invocation.role,
    provider: invocation.provider,
    model: invocation.model,
    authPath: invocation.authPath,
    threadId: invocation.threadId,
    startedAt: invocation.startedAt,
    completedAt: invocation.completedAt,
    usage: {
      inputTokens: invocation.usage.input_tokens,
      cachedInputTokens: invocation.usage.cached_input_tokens,
      outputTokens: invocation.usage.output_tokens,
      reasoningOutputTokens: invocation.usage.reasoning_output_tokens,
      totalTokens: invocation.usage.total_tokens,
    },
    inputTraceIds: invocation.inputTraceIds,
    inputEvidenceDigests: invocation.inputEvidenceDigests,
    inputDigest: invocation.inputDigest,
    outputDigest: invocation.outputDigest,
    schemaVersion: invocation.schemaVersion,
    status: invocation.status,
  })),
};
await writeFile(runtimeEvidenceFile, `${JSON.stringify(runtimeEvidence, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      extracted: manifest.invocations.length,
      destination: relative(new URL(repositoryRoot).pathname, new URL(outputDirectory).pathname),
      totalTokens: manifest.invocations.reduce(
        (sum, invocation) => sum + (invocation.usage?.total_tokens ?? 0),
        0,
      ),
    },
    null,
    2,
  ),
);
