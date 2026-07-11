import assert from "node:assert/strict";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { archaeologySchemas } from "../src/behavior-archaeology.js";
import {
  commandTestCounts,
  hasEvidenceBoundStockSufficiencyRule,
  reconcileCriticUnknownLifecycle,
  type ContractUnknown,
  type CriticOutput,
} from "../src/migration-runner.js";

const initialUnknowns: ContractUnknown[] = [
  {
    unknownId: "UNK-IN-SCOPE",
    question: "What is the in-scope threshold?",
    blocking: true,
    relatedRuleIds: ["RULE-1"],
  },
  {
    unknownId: "UNK-OUTSIDE-SCOPE",
    question: "What happens in an unsupported channel?",
    blocking: true,
    relatedRuleIds: ["RULE-2"],
  },
];

function criticLifecycle(
  overrides: Partial<Pick<CriticOutput, "resolvedUnknowns" | "remainingUnknowns" | "disposition">> = {},
): Pick<CriticOutput, "resolvedUnknowns" | "remainingUnknowns" | "disposition"> {
  return {
    resolvedUnknowns: [
      {
        unknownId: "UNK-IN-SCOPE",
        resolution: "Host evidence establishes the exact threshold.",
        evidenceIds: ["ev-threshold"],
      },
    ],
    remainingUnknowns: [
      {
        unknownId: "UNK-OUTSIDE-SCOPE",
        inScope: false,
        reason: "The contract explicitly excludes this channel.",
      },
    ],
    disposition: "READY_FOR_BUILD",
    ...overrides,
  };
}

test("critic schema requires an explicit resolved and remaining unknown lifecycle", () => {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    archaeologySchemas["contract-critic"],
  );
  const valid = {
    role: "contract_critic",
    findings: [],
    revisedRules: [],
    ...criticLifecycle(),
  };
  assert.equal(validate(valid), true, JSON.stringify(validate.errors));

  const missingLifecycle = { ...valid } as Record<string, unknown>;
  delete missingLifecycle.remainingUnknowns;
  assert.equal(validate(missingLifecycle), false);
});

test("host test-count parser accepts current and legacy Node TAP summaries", () => {
  assert.deepEqual(
    commandTestCounts({
      exitCode: 0,
      stdout: "ℹ tests 59\nℹ pass 55\nℹ skipped 4\n",
      stderr: "",
    }),
    {
      testsPassed: 55,
      testsTotal: 55,
      testsSkipped: 4,
      scope: "candidate-safe",
      source: "live-command-output",
    },
  );
  assert.deepEqual(
    commandTestCounts({
      exitCode: 0,
      stdout: "# tests 46\n# pass 42\n# skipped 4\n",
      stderr: "",
    }),
    {
      testsPassed: 42,
      testsTotal: 42,
      testsSkipped: 4,
      scope: "candidate-safe",
      source: "live-command-output",
    },
  );
});

test("host preserves initial blocking metadata while partitioning resolved and out-of-scope unknowns", () => {
  const lifecycle = reconcileCriticUnknownLifecycle(initialUnknowns, criticLifecycle());
  assert.deepEqual(lifecycle.resolvedUnknowns.map(({ unknownId }) => unknownId), ["UNK-IN-SCOPE"]);
  assert.deepEqual(lifecycle.remainingUnknowns, [
    {
      ...initialUnknowns[1],
      inScope: false,
      reason: "The contract explicitly excludes this channel.",
    },
  ]);
});

test("READY_FOR_BUILD fails closed when an initially blocking unknown remains in scope", () => {
  assert.throws(
    () => reconcileCriticUnknownLifecycle(initialUnknowns, criticLifecycle({
      resolvedUnknowns: [],
      remainingUnknowns: [
        {
          unknownId: "UNK-IN-SCOPE",
          inScope: true,
          reason: "The available traces do not establish the threshold.",
        },
        {
          unknownId: "UNK-OUTSIDE-SCOPE",
          inScope: false,
          reason: "The contract explicitly excludes this channel.",
        },
      ],
    })),
    /GPT56_CONTRACT_BLOCKING_UNKNOWNS:UNK-IN-SCOPE/,
  );
});

test("host rejects an incomplete or contradictory unknown partition", () => {
  assert.throws(
    () => reconcileCriticUnknownLifecycle(initialUnknowns, criticLifecycle({ remainingUnknowns: [] })),
    /GPT56_CONTRACT_UNKNOWN_LIFECYCLE_MISSING:UNK-OUTSIDE-SCOPE/,
  );
  assert.throws(
    () => reconcileCriticUnknownLifecycle(initialUnknowns, criticLifecycle({
      remainingUnknowns: [
        {
          unknownId: "UNK-IN-SCOPE",
          inScope: false,
          reason: "Contradicts the resolved classification.",
        },
        {
          unknownId: "UNK-OUTSIDE-SCOPE",
          inScope: false,
          reason: "The contract explicitly excludes this channel.",
        },
      ],
    })),
    /GPT56_CONTRACT_UNKNOWN_LIFECYCLE_DUPLICATE:UNK-IN-SCOPE/,
  );
});

test("host accepts semantically equivalent stock rules only when bound to failure evidence", () => {
  const rule = {
    ruleId: "R-STOCK",
    statement: "Replacement is denied when sellable inventory is zero.",
    priority: 20,
    evidenceIds: ["ev-stock-failure"],
    confidence: 0.99,
  };
  assert.equal(
    hasEvidenceBoundStockSufficiencyRule([rule], ["ev-stock-failure"]),
    true,
  );
  assert.equal(
    hasEvidenceBoundStockSufficiencyRule([rule], ["ev-other"]),
    false,
  );
  assert.equal(
    hasEvidenceBoundStockSufficiencyRule(
      [{ ...rule, statement: "Replacement inventory behavior is observed." }],
      ["ev-stock-failure"],
    ),
    false,
  );
});
