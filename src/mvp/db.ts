import { sharingSchema } from "./sharing-schema.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function passwordMatches(password: string, stored: string) {
  const [salt, value] = stored.split(":");
  const bytes = Buffer.from(value, "hex");
  return (
    bytes.length === 64 &&
    timingSafeEqual(scryptSync(password, salt, 64), bytes)
  );
}
export class MvpDatabase {
  db: DatabaseSync;
  private transactionTail: Promise<void> = Promise.resolve();
  constructor(
    path = process.env.AUDITTRAK_DATABASE ?? "data/audittrak.sqlite",
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('business','reviewer')),created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS businesses(id TEXT PRIMARY KEY,user_id TEXT UNIQUE NOT NULL REFERENCES users(id),name TEXT NOT NULL,sector TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS counterparties(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),name TEXT NOT NULL,email TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS commercial_events(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),counterparty_id TEXT NOT NULL REFERENCES counterparties(id),title TEXT NOT NULL,service TEXT NOT NULL,currency TEXT NOT NULL DEFAULT 'NGN',channel TEXT NOT NULL DEFAULT 'direct',revision INTEGER NOT NULL DEFAULT 1,submitted INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agreements(id TEXT PRIMARY KEY,event_id TEXT UNIQUE NOT NULL REFERENCES commercial_events(id) ON DELETE CASCADE,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY,event_id TEXT UNIQUE NOT NULL REFERENCES commercial_events(id) ON DELETE CASCADE,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transactions(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES commercial_events(id) ON DELETE CASCADE,business_id TEXT NOT NULL REFERENCES businesses(id),transaction_id TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(business_id,transaction_id));
      CREATE TABLE IF NOT EXISTS fulfillments(id TEXT PRIMARY KEY,event_id TEXT UNIQUE NOT NULL REFERENCES commercial_events(id) ON DELETE CASCADE,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attestations(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES commercial_events(id) ON DELETE CASCADE,token_hash TEXT UNIQUE NOT NULL,status TEXT NOT NULL DEFAULT 'pending',revision INTEGER NOT NULL,name TEXT,comment TEXT,created_at TEXT NOT NULL,responded_at TEXT);
      CREATE TABLE IF NOT EXISTS evidence_items(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES commercial_events(id) ON DELETE CASCADE,kind TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence_assessments(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES commercial_events(id) ON DELETE CASCADE,revision INTEGER NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS consistency_flags(id TEXT PRIMARY KEY,assessment_id TEXT NOT NULL REFERENCES evidence_assessments(id) ON DELETE CASCADE,code TEXT NOT NULL,status TEXT NOT NULL,message TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commercial_activity_profiles(business_id TEXT PRIMARY KEY REFERENCES businesses(id),data TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS institutional_reviews(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES commercial_events(id) ON DELETE CASCADE,reviewer_id TEXT NOT NULL REFERENCES users(id),revision INTEGER NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),actor_id TEXT NOT NULL,event_id TEXT,action TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS demo_stories(event_id TEXT PRIMARY KEY REFERENCES commercial_events(id) ON DELETE CASCADE,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS extraction_proposals(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES commercial_events(id) ON DELETE CASCADE,data TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_business ON commercial_events(business_id);
      CREATE INDEX IF NOT EXISTS audit_business ON audit_logs(business_id);
    `);
    this.db.exec(sharingSchema);
  }
  one(sql: string, ...params: any[]): any {
    return this.db.prepare(sql).get(...params);
  }
  all(sql: string, ...params: any[]): any[] {
    return this.db.prepare(sql).all(...params);
  }
  run(sql: string, ...params: any[]) {
    return this.db.prepare(sql).run(...params);
  }
  async atomic<T>(fn: () => T | Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }
  audit(
    businessId: string,
    actorId: string,
    eventId: string | null,
    action: string,
  ) {
    this.run(
      "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
      id(),
      businessId,
      actorId,
      eventId,
      action,
      now(),
    );
  }
  touch(eventId: string) {
    this.run(
      "UPDATE commercial_events SET revision=revision+1,submitted=0,updated_at=? WHERE id=?",
      now(),
      eventId,
    );
  }
  event(eventId: string) {
    const event = this.one(
      "SELECT e.*,c.name AS counterparty,c.email AS counterparty_email,b.name AS business_name FROM commercial_events e JOIN counterparties c ON c.id=e.counterparty_id JOIN businesses b ON b.id=e.business_id WHERE e.id=?",
      eventId,
    );
    if (!event) return null;
    for (const [table, key] of [
      ["agreements", "agreement"],
      ["invoices", "invoice"],
      ["fulfillments", "fulfillment"],
    ] as const) {
      const record = this.one(
        `SELECT data FROM ${table} WHERE event_id=?`,
        eventId,
      );
      event[key] = record ? JSON.parse(record.data) : null;
    }
    event.transactions = this.all(
      "SELECT data FROM transactions WHERE event_id=? ORDER BY rowid",
      eventId,
    ).map((x) => JSON.parse(x.data));
    event.attestations = this.all(
      "SELECT a.id,a.status,a.revision,a.name,a.comment,a.created_at,a.responded_at,d.email,d.phone,d.review_consent,n.status AS notification_status FROM attestations a LEFT JOIN confirmation_details d ON d.attestation_id=a.id LEFT JOIN notification_outbox n ON n.attestation_id=a.id WHERE a.event_id=? ORDER BY a.rowid DESC",
      eventId,
    );
    event.evidence = this.all(
      "SELECT id,kind,name,mime,length(bytes) AS size,created_at FROM evidence_items WHERE event_id=?",
      eventId,
    );
    const assessment = this.one(
      "SELECT data,revision,created_at FROM evidence_assessments WHERE event_id=? ORDER BY rowid DESC LIMIT 1",
      eventId,
    );
    event.assessment = assessment
      ? {
          ...JSON.parse(assessment.data),
          stale: assessment.revision !== event.revision,
        }
      : null;
    event.reviews = this.all(
      "SELECT r.*,u.name AS reviewer_name FROM institutional_reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.event_id=? ORDER BY r.rowid DESC",
      eventId,
    );
    event.proposals = this.all(
      "SELECT id,data,created_at FROM extraction_proposals WHERE event_id=?",
      eventId,
    ).map((x) => ({ ...x, data: JSON.parse(x.data) }));
    const story = this.one(
      "SELECT data FROM demo_stories WHERE event_id=?",
      eventId,
    );
    event.demoStory = story ? JSON.parse(story.data) : null;
    const nodes = [
      { id: event.id, type: "commercial_event", label: event.title },
      ...[event.agreement, event.invoice, ...event.transactions]
        .filter(Boolean)
        .map((x) => ({
          id: x.id,
          type: x.kind,
          label: x.invoiceNumber ?? x.transactionId ?? x.service,
        })),
      ...event.evidence.map((x: any) => ({
        id: x.id,
        type: "file",
        label: x.name,
      })),
      ...(event.fulfillment
        ? [
            {
              id: "fulfillment-" + event.id,
              type: "fulfillment",
              label: event.fulfillment.status,
            },
          ]
        : []),
      ...event.attestations.map((x: any) => ({
        id: x.id,
        type: "attestation",
        label: x.status,
        revision: x.revision,
      })),
    ];
    event.evidenceGraph = {
      nodes,
      edges: nodes.slice(1).map((x) => ({
        from: x.id,
        to: event.id,
        relationship: "supports_event",
      })),
    };
    return event;
  }
}
