/**
 * Evidence from a real Codex SDK repair recorded on 2026-07-10. The thread
 * started from the committed defective complete-module candidate at
 * `c3594fa...`; the host, outside the writing turn, accepted only the one-file
 * diff below and produced six unique fresh passing proofs.
 */
export const recordedCodexBuild = {
  verified: true,
  recordedAt: "2026-07-10T16:52:37.000Z",
  threadId: "019f4cf0-07d2-71b0-9608-7d66aa611e1f",
  model: "gpt-5.6-sol",
  baseCommit: "c3594fa242f0878a4bb9b9f140e7eeb6a59e4ef8",
  changedFiles: ["apps/api/src/candidates/generated-return-workflow.ts"],
  usage: {
    inputTokens: 170_959,
    cachedInputTokens: 137_728,
    outputTokens: 2_131,
    reasoningOutputTokens: 410,
  },
  sourceProofDigest: "sha256:bf04dd6c18f94358940fa242dbc19c925b94a3f64ebe1a4d69dcd454c6c2f2ef",
  sourceDigest: "sha256:7957319c0592bb556ac121ac88f2dc1a8fe3f918239c98caf9522119d8794a19",
  freshProofIds: [
    "proof_9c172e0a-3fe5-435d-becf-c8252d6eee5b",
    "proof_644e2f92-7712-4aac-9318-b684f0301be0",
    "proof_f35e5ef5-2696-4e21-8ab3-022fd306c57d",
    "proof_ea61ab6b-a90e-4f8d-8cec-6f6ba65f497a",
    "proof_81969c5e-a9c1-4ec2-814e-eeab80235f05",
    "proof_4e4cbd09-fc4c-4bfa-96d6-d3c94e44d518"
  ],
  diff: `diff --git a/apps/api/src/candidates/generated-return-workflow.ts b/apps/api/src/candidates/generated-return-workflow.ts
index ddedcdf..71a433f 100644
--- a/apps/api/src/candidates/generated-return-workflow.ts
+++ b/apps/api/src/candidates/generated-return-workflow.ts
@@ -104,9 +104,20 @@ export function executeGeneratedReturnWorkflow(rawInput: unknown): WorkflowExecu
   let status: WorkflowResult["returnRecord"]["status"];
   let refundCents = 0;
-  // Candidate 01 deliberately over-generalizes the observed VIP trace. The
-  // hidden high-value counterexample will prove this priority is wrong.
-  if (input.customerTier === "VIP") {
+  // The review threshold has priority over every automatic disposition,
+  // including the VIP replacement policy.
+  if (input.amountCents >= 50_000) {
+    selected = {
+      decision: "MANUAL_REVIEW",
+      ruleId: "RULE-HIGH-VALUE-REVIEW",
+      statement: "Returns worth at least 50,000 cents require manual review before side effects.",
+    };
+    status = "PENDING_REVIEW";
+    sideEffects.push({
+      type: "REVIEW_QUEUE",
+      detail: { queue: "HIGH_VALUE", amountCents: input.amountCents },
+    });
+  } else if (input.customerTier === "VIP") {
@@ -131,17 +142,6 @@ export function executeGeneratedReturnWorkflow(rawInput: unknown): WorkflowExecu
-  } else if (input.amountCents >= 50_000) {
-    selected = {
-      decision: "MANUAL_REVIEW",
-      ruleId: "RULE-HIGH-VALUE-REVIEW",
-      statement: "Returns worth at least 50,000 cents require manual review before side effects.",
-    };
-    status = "PENDING_REVIEW";
-    sideEffects.push({
-      type: "REVIEW_QUEUE",
-      detail: { queue: "HIGH_VALUE", amountCents: input.amountCents },
-    });
   } else {
@@ -155,12 +155,19 @@ export function executeGeneratedReturnWorkflow(rawInput: unknown): WorkflowExecu
-    // Candidate 01's second defect: damaged refunds are restored to sellable.
-    after.sellable += 1;
-    sideEffects.push({
-      type: "INVENTORY_MOVE",
-      detail: { destination: "SELLABLE", quantity: 1 },
-    });
+    if (input.itemCondition === "DAMAGED") {
+      after.quarantine += 1;
+      sideEffects.push({
+        type: "INVENTORY_MOVE",
+        detail: { destination: "QUARANTINE", quantity: 1 },
+      });
+    } else {
+      after.sellable += 1;
+      sideEffects.push({
+        type: "INVENTORY_MOVE",
+        detail: { destination: "SELLABLE", quantity: 1 },
+      });
+    }
   }
`,
  commands: [
    {
      command: "pnpm install --offline --frozen-lockfile",
      exitCode: 0,
      summary: "278 packages reused from the offline store; no network downloads."
    },
    {
      command: "pnpm --filter @traceforge/api test",
      exitCode: 0,
      summary: "37/37 host API tests passed outside the Codex writing turn."
    },
    {
      command: "pnpm --filter @traceforge/api verify:generated",
      exitCode: 0,
      summary: "6/6 scenarios passed with unique persisted proof IDs and zero mismatches."
    }
  ]
} as const;
