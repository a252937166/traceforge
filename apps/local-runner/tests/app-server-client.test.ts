import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  AppServerProcessError,
  AppServerTimeoutError,
  redactAndTruncate,
  spawnAppServer,
} from "../src/app-server-client.js";

const FAKE_SERVER = String.raw`
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
let waiting = null;
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
rl.on("line", line => {
  const msg = JSON.parse(line);
  if (msg.id === "server-request") {
    send({ id: waiting, result: { denied: msg.error && msg.error.code === -32601 } });
    waiting = null;
    return;
  }
  if (msg.method === "initialized") return;
  if (msg.method === "initialize") return send({ id: msg.id, result: { userAgent: "fake" } });
  if (msg.method === "account/read") return send({ id: msg.id, result: { account: { type: "chatgpt", planType: "plus", email: "private@example.com" }, requiresOpenaiAuth: true } });
  if (msg.method === "account/login/start") return send({ id: msg.id, result: msg.params.type === "chatgpt" ? { type: "chatgpt", authUrl: "https://auth.openai.com/test" } : { type: "chatgptDeviceCode", verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD" } });
  if (msg.method === "model/list") {
    if (!msg.params.cursor) return send({ id: msg.id, result: { data: [{ id: "gpt-5.6-sol", model: "gpt-5.6-sol" }], nextCursor: "next" } });
    return send({ id: msg.id, result: { data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }], nextCursor: null } });
  }
  if (msg.method === "thread/start") return send({ id: msg.id, result: { thread: { id: "thread-1" } } });
  if (msg.method === "turn/start") return send({ id: msg.id, result: { turn: { id: "turn-1" } } });
  if (msg.method === "turn/interrupt") return send({ id: msg.id, result: {} });
  if (msg.method === "command/exec") return send({ id: msg.id, result: { exitCode: 0, stdout: msg.params.command.join(" "), stderr: "" } });
  if (msg.method === "config/read") {
    if (msg.params.cwd.endsWith("/timeout")) return;
    if (msg.params.cwd.endsWith("/server-request")) {
      waiting = msg.id;
      return send({ id: "server-request", method: "danger/request", params: { token: "never echo" } });
    }
    if (msg.params.includeLayers) send({ method: "traceforge/test-notification", params: { ready: true } });
    return send({ id: msg.id, result: { config: { default_permissions: "traceforge-verify" } } });
  }
});
process.stdin.on("end", () => process.exit(0));
`;

const SENSITIVE_EXIT_SERVER = String.raw`
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
rl.on("line", line => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") return send({ id: msg.id, result: {} });
  if (msg.method === "initialized") return;
  process.stderr.write("Authorization: Bearer super-secret-token\napiKey=sk-testSECRET123456789\n" + "x".repeat(2000));
  process.exit(7);
});
`;

async function createClient(t: test.TestContext, script = FAKE_SERVER, maxStderrChars = 512) {
  const root = await mkdtemp(join(tmpdir(), "traceforge-app-server-test-"));
  await Promise.all([
    mkdir(join(root, "timeout")),
    mkdir(join(root, "server-request")),
  ]);
  const client = await spawnAppServer({
    executable: process.execPath,
    args: ["-e", script],
    cwd: root,
    workspaceRoot: root,
    env: { PATH: process.env.PATH ?? "" },
    expectedPermissionProfile: "traceforge-verify",
    verifyVersion: false,
    requestTimeoutMs: 250,
    maxStderrChars,
  });
  t.after(async () => {
    await client.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  return { client, root };
}

test("initializes JSONL and exposes safe account, model, thread, turn, and command helpers", async (t) => {
  const { client, root } = await createClient(t);
  assert.deepEqual(await client.readAccount(), {
    account: { type: "chatgpt", planType: "plus" },
    requiresOpenaiAuth: true,
  });
  assert.deepEqual((await client.listModels()).map(({ id }) => id), ["gpt-5.6-sol", "gpt-5.6-luna"]);
  assert.match(String((await client.startLogin({ type: "chatgpt" })).authUrl), /^https:\/\/auth\.openai\.com/);
  assert.equal((await client.startThread({
    cwd: root,
    model: "gpt-5.6-sol",
    developerInstructions: "Fixed test instruction",
  })).thread.id, "thread-1");
  assert.equal((await client.startTurn({ threadId: "thread-1", prompt: "Fixed prompt" })).turn.id, "turn-1");
  assert.equal((await client.execCommand({ command: ["pnpm", "test"], cwd: root })).stdout, "pnpm test");
});

test("streams notifications and rejects unexpected server requests by default", async (t) => {
  const { client, root } = await createClient(t);
  const notification = client.waitForNotification("traceforge/test-notification");
  await client.request("config/read", { cwd: root, includeLayers: true });
  assert.deepEqual((await notification).params, { ready: true });
  const response = await client.request<{ denied: boolean }>("config/read", {
    cwd: join(root, "server-request"),
    includeLayers: false,
  });
  assert.equal(response.denied, true);
});

test("times out requests and blocks privilege overrides or unsafe verifier env", async (t) => {
  const { client, root } = await createClient(t);
  await assert.rejects(
    client.request("config/read", { cwd: join(root, "timeout") }, { timeoutMs: 25 }),
    AppServerTimeoutError,
  );
  assert.throws(() => client.request("command/exec", {
    command: ["pnpm", "test"],
    cwd: root,
    sandboxPolicy: { type: "dangerFullAccess" },
  }), /COMMAND_FIELD_BLOCKED/);
  assert.throws(() => client.request("command/exec", {
    command: ["pnpm", "test"],
    cwd: root,
    env: { OPENAI_API_KEY: "sk-never" },
  }), /COMMAND_ENV_BLOCKED/);
  const allowed = await client.request<{ stdout: string }>("command/exec", {
    command: ["pnpm", "test"],
    cwd: root,
    env: {
      TRACEFORGE_ENABLE_CODEX: "0",
      TRACEFORGE_REPAIR_INPUT_DIGEST: `sha256:${"a".repeat(64)}`,
      TRACEFORGE_HOST_HIDDEN_SCENARIO_NONCE: "123e4567-e89b-42d3-a456-426614174000",
      TMPDIR: root,
      CI: "1",
      NO_COLOR: "1",
    },
  });
  assert.equal(allowed.stdout, "pnpm test");
});

test("redacts and truncates sensitive app-server stderr", async (t) => {
  const { client, root } = await createClient(t, SENSITIVE_EXIT_SERVER, 160);
  await assert.rejects(
    client.request("config/read", { cwd: root, includeLayers: false }),
    (error: unknown) => {
      assert.ok(error instanceof AppServerProcessError);
      assert.doesNotMatch(error.message, /super-secret-token|sk-testSECRET/);
      assert.match(error.message, /\[REDACTED\]/);
      assert.match(error.message, /\[TRUNCATED\]/);
      return true;
    },
  );
});

test("redaction is bounded even before a process error", () => {
  const value = redactAndTruncate(`password=hunter2\n${"x".repeat(1000)}`, 80);
  assert.doesNotMatch(value, /hunter2/);
  assert.match(value, /\[TRUNCATED\]/);
});
