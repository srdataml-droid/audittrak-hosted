import { sharingSchema } from "./sharing-schema.js";
import { Pool, type PoolClient } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { id, now } from "./db.js";
import { postgresSchema, tableColumns } from "./postgres-schema.js";

export function isDatabaseConnectionError(error: unknown) {
  const value = error as { code?: string; message?: string };
  return (
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENOTFOUND",
      "57P01",
      "57P02",
      "57P03",
    ].includes(value?.code ?? "") ||
    /connection.*(?:timeout|timed out|terminated|closed)|timeout.*connect/i.test(
      value?.message ?? "",
    )
  );
}

/** A pooled PostgreSQL backend. Every transaction stays on one connection. */
export class PostgresDatabase {
  private pool: Pool;
  private context = new AsyncLocalStorage<PoolClient>();
  private ready?: Promise<void>;
  db: { close: () => Promise<void> };
  constructor(connectionString: string, pool?: Pool) {
    this.pool =
      pool ??
      new Pool({
        connectionString,
        max: 3,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 30000,
      });
    this.pool.on("error", (error) =>
      console.error("AuditTrak database pool error", error.message),
    );
    this.db = { close: () => this.pool.end() };
  }
  private async ensureReady() {
    // Share initialization between requests, but never cache a failed connection.
    const pending = (this.ready ??= this.initialize());
    try {
      await pending;
    } catch (error) {
      if (this.ready === pending) this.ready = undefined;
      throw error;
    }
  }
  private async initialize() {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      // An idle compute may take longer to wake. Retry connection acquisition,
      // before any SQL or application writes have been sent.
      if (!isDatabaseConnectionError(error)) throw error;
      client = await this.pool.connect();
    }
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1791529)");
      await client.query(postgresSchema + sharingSchema);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private sql(sql: string) {
    // Existing queries use SQLite positional placeholders. Identifiers are all application-controlled.
    let n = 0;
    return sql
      .replace(/INSERT INTO (\w+) VALUES/g, (_match, table) => {
        const columns = tableColumns[table];
        if (!columns) throw new Error("Unknown table: " + table);
        return `INSERT INTO ${table}(${columns.join(",")}) VALUES`;
      })
      .replace(/length\(bytes\)/g, "octet_length(bytes)")
      .replace(/\?/g, () => "$" + ++n);
  }
  private async query(sql: string, params: any[]) {
    await this.ensureReady();
    return (this.context.getStore() ?? this.pool).query(this.sql(sql), params);
  }
  async one(sql: string, ...params: any[]): Promise<any> {
    return (await this.query(sql, params)).rows[0];
  }
  async all(sql: string, ...params: any[]): Promise<any[]> {
    return (await this.query(sql, params)).rows;
  }
  async run(sql: string, ...params: any[]) {
    return { changes: (await this.query(sql, params)).rowCount ?? 0 };
  }
  async atomic<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.ensureReady();
    if (this.context.getStore()) return await fn();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.context.run(client, fn);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async audit(
    businessId: string,
    actorId: string,
    eventId: string | null,
    action: string,
  ) {
    await this.run(
      "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
      id(),
      businessId,
      actorId,
      eventId,
      action,
      now(),
    );
  }
  async touch(eventId: string) {
    await this.run(
      "UPDATE commercial_events SET revision=revision+1,submitted=0,updated_at=? WHERE id=?",
      now(),
      eventId,
    );
  }
  async event(eventId: string): Promise<any> {
    const event = await this.one(
      "SELECT e.*,c.name AS counterparty,c.email AS counterparty_email,b.name AS business_name FROM commercial_events e JOIN counterparties c ON c.id=e.counterparty_id JOIN businesses b ON b.id=e.business_id WHERE e.id=?",
      eventId,
    );
    if (!event) return null;
    for (const [table, key] of [
      ["agreements", "agreement"],
      ["invoices", "invoice"],
      ["fulfillments", "fulfillment"],
    ] as const) {
      const record = await this.one(
        `SELECT data FROM ${table} WHERE event_id=?`,
        eventId,
      );
      event[key] = record ? JSON.parse(record.data) : null;
    }
    event.transactions = (
      await this.all(
        "SELECT data FROM transactions WHERE event_id=? ORDER BY rowid",
        eventId,
      )
    ).map((x) => JSON.parse(x.data));
    event.attestations = await this.all(
      "SELECT a.id,a.status,a.revision,a.name,a.comment,a.created_at,a.responded_at,d.email,d.phone,d.review_consent,n.status AS notification_status FROM attestations a LEFT JOIN confirmation_details d ON d.attestation_id=a.id LEFT JOIN notification_outbox n ON n.attestation_id=a.id WHERE a.event_id=? ORDER BY a.rowid DESC",
      eventId,
    );
    event.evidence = await this.all(
      "SELECT id,kind,name,mime,length(bytes) AS size,created_at FROM evidence_items WHERE event_id=?",
      eventId,
    );
    const assessment = await this.one(
      "SELECT data,revision,created_at FROM evidence_assessments WHERE event_id=? ORDER BY rowid DESC LIMIT 1",
      eventId,
    );
    event.assessment = assessment
      ? {
          ...JSON.parse(assessment.data),
          stale: assessment.revision !== event.revision,
        }
      : null;
    event.reviews = await this.all(
      "SELECT r.*,u.name AS reviewer_name FROM institutional_reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.event_id=? ORDER BY r.rowid DESC",
      eventId,
    );
    event.proposals = (
      await this.all(
        "SELECT id,data,created_at FROM extraction_proposals WHERE event_id=?",
        eventId,
      )
    ).map((x) => ({ ...x, data: JSON.parse(x.data) }));
    const story = await this.one(
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
