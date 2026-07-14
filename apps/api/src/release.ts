import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ReleaseIdentity {
  sha: string;
  version: string;
  builtAt: string;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeRelease(value: unknown): ReleaseIdentity | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const sha = nonEmptyString(candidate.sha);
  const version = nonEmptyString(candidate.version);
  const builtAt = nonEmptyString(candidate.builtAt);
  if (!sha || !version || !builtAt) return undefined;
  if (!/^[a-f0-9]{40}$/.test(sha)) return undefined;
  if (!/^traceforge-v\d+\.\d+\.\d+$/.test(version)) return undefined;
  if (Number.isNaN(Date.parse(builtAt))) return undefined;
  return { sha, version, builtAt };
}

export function readReleaseIdentity(
  env: NodeJS.ProcessEnv = process.env,
  moduleDirectory: string = import.meta.dirname,
): ReleaseIdentity | undefined {
  const environmentRelease = normalizeRelease({
    sha: env.TRACEFORGE_RELEASE_SHA,
    version: env.TRACEFORGE_RELEASE_VERSION,
    builtAt: env.TRACEFORGE_RELEASE_BUILT_AT,
  });
  if (environmentRelease) return environmentRelease;

  try {
    const packagedRelease = normalizeRelease(
      JSON.parse(readFileSync(resolve(moduleDirectory, "..", "release.json"), "utf8")),
    );
    if (packagedRelease) return packagedRelease;
  } catch {
    // Local development and source tests intentionally run without a package manifest.
  }

  if (env.NODE_ENV === "production") {
    throw new Error("TRACEFORGE_RELEASE_IDENTITY_MISSING");
  }
  return undefined;
}
