#!/usr/bin/env node

const [baseUrl, migrationId, outputDirectory] = process.argv.slice(2);
if (!baseUrl || !migrationId || !outputDirectory) {
  throw new Error("Usage: node scripts/export-migration.mjs <baseUrl> <migrationId> <outputDirectory>");
}

process.env.TRACEFORGE_API_URL = baseUrl;
process.argv = [process.argv[0], "scripts/export-migration-run.mjs", migrationId, outputDirectory];
await import("./export-migration-run.mjs");
