import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyProofIntegrity } from "../src/proof-verifier.js";

const filename = process.argv[2];
if (!filename) {
  process.stderr.write("Usage: pnpm proof:verify-integrity <historical-proof.json>\n");
  process.exitCode = 2;
} else {
  const absolute = resolve(process.env.INIT_CWD ?? process.cwd(), filename);
  const proof = JSON.parse(await readFile(absolute, "utf8")) as unknown;
  const result = verifyProofIntegrity(proof);
  process.stdout.write(`${JSON.stringify({ kind: "historical-object-integrity", file: absolute, ...result }, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
