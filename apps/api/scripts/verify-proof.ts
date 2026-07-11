import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256Digest } from "../src/digest.js";

const filename = process.argv[2];
if (!filename) {
  process.stderr.write("Usage: pnpm proof:verify <proof.json>\n");
  process.exitCode = 2;
} else {
  const absolute = resolve(process.env.INIT_CWD ?? process.cwd(), filename);
  const proof = JSON.parse(await readFile(absolute, "utf8")) as Record<string, unknown>;
  const { digest: claimedDigest, ...body } = proof;
  const computedDigest = sha256Digest(body);
  const valid = typeof claimedDigest === "string" && claimedDigest === computedDigest;
  process.stdout.write(`${JSON.stringify({ valid, claimedDigest, computedDigest, file: absolute }, null, 2)}\n`);
  if (!valid) process.exitCode = 1;
}
