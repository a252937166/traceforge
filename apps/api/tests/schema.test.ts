import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { TraceForgeService } from "../src/service.js";
import { ArtifactStore } from "../src/store.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readSchema(name: string): object {
  return JSON.parse(readFileSync(resolve(repositoryRoot, "docs", name), "utf8")) as object;
}

test("runtime contracts and proof bundles validate against the published schemas", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateContract = ajv.compile(readSchema("behavior-contract.schema.json"));
  const validateProof = ajv.compile(readSchema("proof-bundle.schema.json"));
  const store = new ArtifactStore(":memory:");
  const service = new TraceForgeService(store);

  for (const candidateVersion of ["buggy", "fixed"] as const) {
    const run = service.runDemo({ scenarioId: "damaged-small-refund", candidateVersion });
    assert.equal(
      validateContract(run.contract),
      true,
      `contract schema errors: ${JSON.stringify(validateContract.errors)}`,
    );
    assert.equal(
      validateProof(run.proofBundle),
      true,
      `proof schema errors: ${JSON.stringify(validateProof.errors)}`,
    );
  }

  store.close();
});
