import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sha256Digest } from "./digest.js";
import type {
  MigrationArtifact,
  MigrationArtifactKind,
  MigrationArtifactMetadata,
  MigrationEvent,
  MigrationJob,
} from "./migration-types.js";

type EventDraft = Omit<MigrationEvent, "id" | "sequence" | "digest">;

export class MigrationStore {
  private readonly db: DatabaseSync;
  private readonly emitter = new EventEmitter();

  constructor(filename = process.env.TRACEFORGE_DB ?? "data/traceforge.sqlite") {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS migration_jobs (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS migration_events (
        migration_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        id TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (migration_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS migration_artifacts (
        id TEXT PRIMARY KEY,
        migration_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        digest TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_migration_events_job ON migration_events(migration_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_migration_artifacts_job ON migration_artifacts(migration_id, kind);
    `);
  }

  createJob(job: MigrationJob): void {
    this.db
      .prepare("INSERT INTO migration_jobs(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(job.id, JSON.stringify(job), job.createdAt, job.createdAt);
  }

  updateJob(job: MigrationJob): void {
    const updated = this.db
      .prepare("UPDATE migration_jobs SET payload_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(job), new Date().toISOString(), job.id);
    if (Number(updated.changes) !== 1) throw new Error(`migration job not found: ${job.id}`);
  }

  getJob(id: string): MigrationJob | undefined {
    const row = this.db
      .prepare("SELECT payload_json FROM migration_jobs WHERE id = ?")
      .get(id) as { payload_json: string } | undefined;
    return row ? (JSON.parse(row.payload_json) as MigrationJob) : undefined;
  }

  appendEvent(draft: EventDraft): MigrationEvent {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT COALESCE(MAX(sequence), 0) AS last_sequence FROM migration_events WHERE migration_id = ?")
        .get(draft.migrationId) as { last_sequence: number };
      const sequence = Number(row.last_sequence) + 1;
      const id = `evt_${randomUUID()}`;
      const digestBody = { ...draft, id, sequence };
      const event: MigrationEvent = { ...draft, id, sequence, digest: sha256Digest(digestBody) };
      this.db
        .prepare(
          `INSERT INTO migration_events(migration_id, sequence, id, payload_json, digest, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(event.migrationId, event.sequence, event.id, JSON.stringify(event), event.digest, event.occurredAt);
      this.db.exec("COMMIT");
      this.emitter.emit(event.migrationId, event);
      return event;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listEvents(migrationId: string, after = 0): MigrationEvent[] {
    const rows = this.db
      .prepare(
        "SELECT payload_json FROM migration_events WHERE migration_id = ? AND sequence > ? ORDER BY sequence ASC",
      )
      .all(migrationId, Math.max(0, Math.trunc(after))) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as MigrationEvent);
  }

  subscribe(migrationId: string, listener: (event: MigrationEvent) => void): () => void {
    this.emitter.on(migrationId, listener);
    return () => this.emitter.off(migrationId, listener);
  }

  putArtifact(input: Omit<MigrationArtifact, "id" | "digest" | "byteLength" | "href">): MigrationArtifact {
    const id = `artifact_${randomUUID()}`;
    const digest = sha256Digest(input.body);
    const artifact: MigrationArtifact = {
      ...input,
      id,
      digest,
      byteLength: Buffer.byteLength(input.body, "utf8"),
      href: `/api/migrations/${input.migrationId}/downloads/${encodeURIComponent(input.filename)}`,
    };
    this.db
      .prepare(
        `INSERT INTO migration_artifacts(id, migration_id, kind, filename, mime_type, digest, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.migrationId,
        artifact.kind,
        artifact.filename,
        artifact.mimeType,
        artifact.digest,
        artifact.body,
        artifact.createdAt,
      );
    return artifact;
  }

  listArtifacts(migrationId: string): MigrationArtifactMetadata[] {
    const rows = this.db
      .prepare(
        `SELECT id, migration_id, kind, filename, mime_type, digest, length(CAST(body AS BLOB)) AS byte_length, created_at
         FROM migration_artifacts WHERE migration_id = ? ORDER BY created_at, id`,
      )
      .all(migrationId) as Array<{
      id: string;
      migration_id: string;
      kind: MigrationArtifactKind;
      filename: string;
      mime_type: string;
      digest: string;
      byte_length: number;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      migrationId: row.migration_id,
      label: row.filename,
      filename: row.filename,
      kind: row.kind,
      mimeType: row.mime_type,
      digest: row.digest,
      byteLength: Number(row.byte_length),
      href: `/api/migrations/${migrationId}/downloads/${encodeURIComponent(row.filename)}`,
      createdAt: row.created_at,
    }));
  }

  getArtifactByFilename(migrationId: string, filename: string): MigrationArtifact | undefined {
    const row = this.db
      .prepare(
        `SELECT id, migration_id, kind, filename, mime_type, digest, body, created_at
         FROM migration_artifacts WHERE migration_id = ? AND filename = ?`,
      )
      .get(migrationId, filename) as
      | {
          id: string;
          migration_id: string;
          kind: MigrationArtifactKind;
          filename: string;
          mime_type: string;
          digest: string;
          body: string;
          created_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      migrationId: row.migration_id,
      label: row.filename,
      filename: row.filename,
      kind: row.kind,
      mimeType: row.mime_type,
      digest: row.digest,
      body: row.body,
      byteLength: Buffer.byteLength(row.body, "utf8"),
      href: `/api/migrations/${migrationId}/downloads/${encodeURIComponent(row.filename)}`,
      createdAt: row.created_at,
    };
  }

  close(): void {
    this.emitter.removeAllListeners();
    this.db.close();
  }
}
