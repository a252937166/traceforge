export const REDACTED_WORKTREE_PATH = "<retained-worktree>";

function visit(value, visitor) {
  if (Array.isArray(value)) {
    for (const entry of value) visit(entry, visitor);
    return;
  }
  if (!value || typeof value !== "object") return;

  const worktree = value.worktree;
  if (worktree && typeof worktree === "object" && typeof worktree.path === "string") {
    visitor(worktree.path);
  }
  for (const entry of Object.values(value)) visit(entry, visitor);
}

export function collectWorktreePaths(...values) {
  const paths = new Set();
  for (const value of values) {
    visit(value, (path) => {
      if (path && path !== REDACTED_WORKTREE_PATH) paths.add(path);
    });
  }
  return [...paths].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

export function redactWorktreePathsInText(text, worktreePaths) {
  return worktreePaths.reduce(
    (redacted, worktreePath) => redacted.replaceAll(worktreePath, REDACTED_WORKTREE_PATH),
    text,
  );
}

export function redactWorktreePaths(value, worktreePaths) {
  if (typeof value === "string") return redactWorktreePathsInText(value, worktreePaths);
  if (Array.isArray(value)) return value.map((entry) => redactWorktreePaths(entry, worktreePaths));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redactWorktreePaths(entry, worktreePaths)]),
  );
}

export function isRedactedWorktreePath(value) {
  return value === REDACTED_WORKTREE_PATH;
}
