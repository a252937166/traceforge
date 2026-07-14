#!/usr/bin/env node
"use strict";

const MINIMUM_NODE_VERSION = Object.freeze({ major: 22, minor: 13, patch: 0 });
const RECOMMENDED_NODE_VERSION = "22.23.1";
const EXIT_USAGE = 64;

function parseNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version).trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function isSupportedNodeVersion(version) {
  const parsed = parseNodeVersion(version);
  if (!parsed) return false;
  if (parsed.major !== MINIMUM_NODE_VERSION.major) {
    return parsed.major > MINIMUM_NODE_VERSION.major;
  }
  if (parsed.minor !== MINIMUM_NODE_VERSION.minor) {
    return parsed.minor > MINIMUM_NODE_VERSION.minor;
  }
  return parsed.patch >= MINIMUM_NODE_VERSION.patch;
}

function unsupportedNodeMessage(version) {
  return [
    `TraceForge Local Runner requires Node.js >=22.13.0; found ${version}.`,
    `Install Node.js ${RECOMMENDED_NODE_VERSION} (the CI-pinned version), then rerun this command.`,
    "No dependencies or Local Runner work were started.",
  ].join(" ");
}

function assertSupportedNodeVersion(version = process.versions.node) {
  if (isSupportedNodeVersion(version)) return;
  const error = new Error(unsupportedNodeMessage(version));
  error.code = "TRACEFORGE_NODE_VERSION_UNSUPPORTED";
  error.exitCode = EXIT_USAGE;
  throw error;
}

if (require.main === module) {
  try {
    assertSupportedNodeVersion();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error && typeof error.exitCode === "number" ? error.exitCode : EXIT_USAGE;
  }
}

module.exports = {
  EXIT_USAGE,
  MINIMUM_NODE_VERSION,
  RECOMMENDED_NODE_VERSION,
  assertSupportedNodeVersion,
  isSupportedNodeVersion,
  parseNodeVersion,
  unsupportedNodeMessage,
};
