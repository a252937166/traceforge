import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateSourceRunEnvelope } from "../src/proof-verifier.js";

const filename = process.argv[2];
if (!filename) {
  process.stderr.write("Usage: pnpm proof:verify-envelope <source-run-envelope-v2.json>\n");
  process.exitCode = 2;
} else {
  const absolute = resolve(process.env.INIT_CWD ?? process.cwd(), filename);
  const envelope = JSON.parse(await readFile(absolute, "utf8")) as Record<string, unknown>;
  if (envelope.originalProofPath !== "proof.json") {
    process.stderr.write("Envelope originalProofPath must identify the adjacent historical proof.\n");
    process.exitCode = 1;
  } else if (envelope.recordedVerifierArtifactPath !== "../../../apps/api/src/recorded-codex-build.generated.json") {
    process.stderr.write("Envelope recordedVerifierArtifactPath must identify the checked-in recorded verifier artifact.\n");
    process.exitCode = 1;
  } else {
    const originalProofFile = resolve(dirname(absolute), envelope.originalProofPath);
    const recordedVerifierArtifactFile = resolve(dirname(absolute), envelope.recordedVerifierArtifactPath);
    const originalProofBytes = await readFile(originalProofFile);
    const recordedVerifierArtifactBytes = await readFile(recordedVerifierArtifactFile);
    const result = validateSourceRunEnvelope(
      envelope,
      originalProofBytes,
      recordedVerifierArtifactBytes,
    );
    process.stdout.write(
      `${JSON.stringify(
        { kind: "source-run-envelope-v2", file: absolute, originalProofFile, recordedVerifierArtifactFile, ...result },
        null,
        2,
      )}\n`,
    );
    if (!result.valid) process.exitCode = 1;
  }
}
