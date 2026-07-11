import assert from "node:assert/strict";
import test from "node:test";

import {
  REDACTED_WORKTREE_PATH,
  collectWorktreePaths,
  isRedactedWorktreePath,
  redactWorktreePaths,
  redactWorktreePathsInText,
} from "./export-redaction.mjs";

test("redacts a retained worktree path everywhere in an exported event", () => {
  const localPath = "/Users/example/project/.traceforge/worktrees/repair-123";
  const event = {
    type: "candidate.updated",
    payload: {
      worktree: { path: localPath, retained: true },
      message: `Candidate retained at ${localPath}`,
    },
  };
  const paths = collectWorktreePaths(event);
  const redacted = redactWorktreePaths(event, paths);

  assert.deepEqual(paths, [localPath]);
  assert.equal(redacted.payload.worktree.path, REDACTED_WORKTREE_PATH);
  assert.equal(redacted.payload.message, `Candidate retained at ${REDACTED_WORKTREE_PATH}`);
  assert.equal(JSON.stringify(redacted).includes(localPath), false);
});

test("redacts the same path from downloaded JSONL without changing public paths", () => {
  const localPath = "/tmp/traceforge-repair";
  const exported = redactWorktreePathsInText(
    `${JSON.stringify({ worktree: { path: localPath }, href: "/api/migrations/1" })}\n`,
    [localPath],
  );

  assert.equal(exported.includes(localPath), false);
  assert.equal(exported.includes(`"path":"${REDACTED_WORKTREE_PATH}"`), true);
  assert.equal(exported.includes('"href":"/api/migrations/1"'), true);
  assert.equal(isRedactedWorktreePath(REDACTED_WORKTREE_PATH), true);
});
