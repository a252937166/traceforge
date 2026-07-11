/**
 * Evidence from a real Codex SDK repair recorded on 2026-07-10. The thread
 * started from the committed defective complete-module candidate at
 * `899ff7a...`; the host, outside the writing turn, accepted only the one-file
 * diff below and produced six unique fresh passing proofs.
 */
export const recordedCodexBuild = {
  verified: true,
  recordedAt: "2026-07-10T17:30:31.000Z",
  threadId: "019f4d12-9228-78c1-95fc-3a13d8e1919f",
  model: "gpt-5.6-sol",
  baseCommit: "899ff7ac5f6151b58129559a1d760177a1243136",
  changedFiles: ["apps/api/src/candidates/generated-return-workflow.ts"],
  usage: {
    inputTokens: 125_688,
    cachedInputTokens: 93_184,
    outputTokens: 2_817,
    reasoningOutputTokens: 591,
  },
  sourceProofDigest: "sha256:e844b5edc3ee4ed9dfb2666df91a6ac4033b27b0d8ed543ec228a851fc61fe6a",
  sourceDigest: "sha256:33dae444638bf3e7015aa743711358a19e330ca98d1fec8b98d044a106132773",
  executableSourceDigests: {
    typescript: "sha256:33dae444638bf3e7015aa743711358a19e330ca98d1fec8b98d044a106132773",
    javascript: "sha256:0c18f0279f4f8e76f8235f67f015374ddc3b52d715c3f637a0c46780676e80e9",
  },
  freshProofIds: [
    "proof_79ca3d45-e008-469e-9695-ce63acb47ea7",
    "proof_bbe9f812-3d71-4a3f-b501-474593c372bd",
    "proof_0b5603f9-d22a-498e-90dd-dbcae0bc0233",
    "proof_bd930858-f771-4858-9771-04ef60b5f876",
    "proof_515622af-726a-40c8-95f0-a32b14a6b016",
    "proof_fe6a7e83-a769-46e9-ad7d-52b49c94046f"
  ],
  diff: `diff --git a/apps/api/src/candidates/generated-return-workflow.ts b/apps/api/src/candidates/generated-return-workflow.ts
index ddedcdf..b5e1aa3 100644
--- a/apps/api/src/candidates/generated-return-workflow.ts
+++ b/apps/api/src/candidates/generated-return-workflow.ts
@@ -104,9 +104,20 @@ export function executeGeneratedReturnWorkflow(rawInput: unknown): WorkflowExecu
   let status: WorkflowResult["returnRecord"]["status"];
   let refundCents = 0;
-  // Candidate 01 deliberately over-generalizes the observed VIP trace. The
-  // hidden high-value counterexample will prove this priority is wrong.
-  if (input.customerTier === "VIP") {
+  // The high-value threshold outranks every customer-tier policy so review is
+  // recorded before any inventory or payment side effect can occur.
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
