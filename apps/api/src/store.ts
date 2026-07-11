import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  BehaviorContract,
  BusinessStateSnapshot,
  ProofBundle,
  ReturnWorkflowInput,
  SystemName,
  StoredWorkflowTrace,
  WorkflowResult,
} from "./types.js";

type ArtifactKind = "trace" | "contract" | "proof";

export class ArtifactStore {
  private readonly db: DatabaseSync;

  constructor(filename = process.env.TRACEFORGE_DB ?? "data/traceforge.sqlite") {
    if (filename !== ":memory:") {
      mkdirSync(dirname(filename), { recursive: true });
    }
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind);
      CREATE TABLE IF NOT EXISTS inventory_state (
        system TEXT NOT NULL,
        sku TEXT NOT NULL,
        sellable INTEGER NOT NULL CHECK (sellable >= 0),
        quarantine INTEGER NOT NULL CHECK (quarantine >= 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(system, sku)
      );
      CREATE TABLE IF NOT EXISTS return_state (
        system TEXT NOT NULL,
        return_id TEXT NOT NULL,
        status TEXT NOT NULL,
        decision TEXT NOT NULL,
        refund_cents INTEGER NOT NULL CHECK (refund_cents >= 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(system, return_id)
      );
    `);
  }

  resetBusinessState(system: SystemName, input: ReturnWorkflowInput): BusinessStateSnapshot {
    const inventory = input.initialInventory ?? { sellable: 10, quarantine: 0 };
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM return_state WHERE system = ? AND return_id = ?").run(system, input.returnId);
      this.db
        .prepare(
          `INSERT INTO inventory_state(system, sku, sellable, quarantine, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(system, sku) DO UPDATE SET
             sellable = excluded.sellable,
             quarantine = excluded.quarantine,
             updated_at = excluded.updated_at`,
        )
        .run(system, input.sku, inventory.sellable, inventory.quarantine, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.snapshotBusinessState(system, input.sku, input.returnId);
  }

  applyBusinessResult(system: SystemName, result: WorkflowResult): BusinessStateSnapshot {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const inventoryWrite = this.db
        .prepare(
          `UPDATE inventory_state
           SET sellable = ?, quarantine = ?, updated_at = ?
           WHERE system = ? AND sku = ?`,
        )
        .run(
          result.inventoryAfter.sellable,
          result.inventoryAfter.quarantine,
          now,
          system,
          result.inventoryAfter.sku,
        );
      if (Number(inventoryWrite.changes) !== 1) {
        throw new Error(`inventory state was not initialized for ${system}/${result.inventoryAfter.sku}`);
      }
      this.db
        .prepare(
          `INSERT INTO return_state(system, return_id, status, decision, refund_cents, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(system, return_id) DO UPDATE SET
             status = excluded.status,
             decision = excluded.decision,
             refund_cents = excluded.refund_cents,
             updated_at = excluded.updated_at`,
        )
        .run(
          system,
          result.returnRecord.returnId,
          result.returnRecord.status,
          result.returnRecord.decision,
          result.returnRecord.refundCents,
          now,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.snapshotBusinessState(system, result.inventoryAfter.sku, result.returnRecord.returnId);
  }

  snapshotBusinessState(system: SystemName, sku: string, returnId: string): BusinessStateSnapshot {
    const inventory = this.db
      .prepare(
        "SELECT sku, sellable, quarantine FROM inventory_state WHERE system = ? AND sku = ?",
      )
      .get(system, sku) as { sku: string; sellable: number; quarantine: number } | undefined;
    if (!inventory) throw new Error(`inventory state not found for ${system}/${sku}`);
    const returnRecord = this.db
      .prepare(
        `SELECT return_id, status, decision, refund_cents
         FROM return_state WHERE system = ? AND return_id = ?`,
      )
      .get(system, returnId) as
      | { return_id: string; status: WorkflowResult["returnRecord"]["status"]; decision: WorkflowResult["decision"]; refund_cents: number }
      | undefined;
    return {
      system,
      inventory: { sku: inventory.sku, sellable: inventory.sellable, quarantine: inventory.quarantine },
      ...(returnRecord
        ? {
            returnRecord: {
              returnId: returnRecord.return_id,
              status: returnRecord.status,
              decision: returnRecord.decision,
              refundCents: returnRecord.refund_cents,
            },
          }
        : {}),
      readAt: new Date().toISOString(),
    };
  }

  putTrace(trace: StoredWorkflowTrace): void {
    this.put("trace", trace.traceId, trace, trace.capturedAt);
  }

  putContract(contract: BehaviorContract): void {
    this.put("contract", contract.contractId, contract, contract.createdAt);
  }

  putProof(proof: ProofBundle): void {
    this.put("proof", proof.proofId, proof, proof.generatedAt);
  }

  getTrace(id: string): StoredWorkflowTrace | undefined {
    return this.get<StoredWorkflowTrace>("trace", id);
  }

  getContract(id: string): BehaviorContract | undefined {
    return this.get<BehaviorContract>("contract", id);
  }

  getProof(id: string): ProofBundle | undefined {
    return this.get<ProofBundle>("proof", id);
  }

  close(): void {
    this.db.close();
  }

  private put(kind: ArtifactKind, id: string, payload: unknown, createdAt: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO artifacts(id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, kind, JSON.stringify(payload), createdAt);
  }

  private get<T>(kind: ArtifactKind, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT payload_json FROM artifacts WHERE id = ? AND kind = ?")
      .get(id, kind) as { payload_json: string } | undefined;
    return row ? (JSON.parse(row.payload_json) as T) : undefined;
  }
}
