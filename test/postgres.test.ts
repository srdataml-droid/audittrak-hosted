import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PostgresDatabase } from "../src/mvp/postgres.js";
import { buildServer } from "../src/server.js";

// PGlite runs PostgreSQL itself, so this exercises real SQL and transaction semantics.
function postgres(path: string, connectionFailures = 0) {
  const engine = new PGlite(path);
  const query = async (sql: string, values?: any[]) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
    if (sql.includes("CREATE TABLE")) {
      await engine.exec(sql);
      return { rows: [], rowCount: 0 };
    }
    const result = await engine.query(sql, values);
    return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
  };
  const pool = {
    query,
    on: () => {},
    connect: async () => {
      if (connectionFailures-- > 0)
        throw new Error("Connection terminated due to connection timeout");
      return { query, release: () => {} };
    },
    end: () => engine.close(),
  } as unknown as Pool;
  return new PostgresDatabase("postgresql://test", pool);
}

describe("hosted PostgreSQL workspace", () => {
  it("persists public sharing, optional client contacts and queued emails in PostgreSQL", async () => {
    const db = postgres("memory://");
    const app = buildServer({ database: db });
    try {
      const signup = await app.inject({
        method: "POST",
        url: "/api/v1/auth/signup",
        payload: {
          name: "Sharing Owner",
          email: "pg-share@example.invalid",
          password: "TwelveCharacters!",
          businessName: "PG Studio",
        },
      });
      const cookie = String(signup.headers["set-cookie"]).split(";")[0];
      const headers = { cookie };
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers,
        payload: {
          title: "PG shared work",
          service: "Design",
          counterparty: "Client",
          currency: "NGN",
          channel: "direct",
        },
      });
      expect(created.statusCode, created.body).toBe(200);
      const event = created.json();
      const uploaded = await app.inject({
        method: "POST",
        url: `/api/v1/events/${event.id}/evidence`,
        headers,
        payload: {
          kind: "agreement",
          name: "contract.txt",
          mime: "text/plain",
          base64: Buffer.from("PG contract original").toString("base64"),
        },
      });
      expect(uploaded.statusCode, uploaded.body).toBe(200);
      const file = uploaded.json().evidence[0];
      const invite = await app.inject({
        method: "POST",
        url: `/api/v1/events/${event.id}/attestations`,
        headers,
        payload: {},
      });
      expect(invite.statusCode, invite.body).toBe(200);
      const token = invite.json().path.split("/").pop();
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/attest/${token}`,
        payload: {
          status: "confirmed",
          name: "Client",
          email: "private@example.invalid",
          comment: "On time",
          reviewConsent: true,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      const saved = await db.event(event.id);
      expect(saved.attestations[0].email).toBe("private@example.invalid");
      expect(saved.attestations[0].notification_status).toBe("not_configured");
      const share = await app.inject({
        method: "POST",
        url: "/api/v1/shares",
        headers,
        payload: { title: "PG Pack", eventIds: [event.id] },
      });
      expect(share.statusCode, share.body).toBe(200);
      const sharedToken = share.json().path.split("/").pop();
      const publicView = await app.inject({
        url: `/api/v1/shared/${sharedToken}`,
      });
      expect(publicView.statusCode, publicView.body).toBe(200);
      expect(publicView.json().events[0].confirmations[0].review).toBe(
        "On time",
      );
      expect(publicView.body).not.toContain("private@example.invalid");
      const download = await app.inject({
        url: `/api/v1/shared/${sharedToken}/files/${file.id}`,
      });
      expect(download.body).toBe("PG contract original");
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/shares/${share.json().id}/revoke`,
            headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ url: `/api/v1/shared/${sharedToken}` })).statusCode,
      ).toBe(410);
    } finally {
      await app.close();
    }
  });

  it("recovers signup after a database wake timeout without caching the failure", async () => {
    const db = postgres("memory://", 2);
    const app = buildServer({ database: db });
    const account = {
      name: "Recovery Test",
      email: "recovery@example.invalid",
      password: "TwelveCharacters!",
      businessName: "Recovery Studio",
    };
    try {
      const failed = await app.inject({
        method: "POST",
        url: "/api/v1/auth/signup",
        payload: account,
      });
      expect(failed.statusCode).toBe(503);
      expect(failed.json().error).toContain("temporarily unavailable");
      const recovered = await app.inject({
        method: "POST",
        url: "/api/v1/auth/signup",
        payload: account,
      });
      expect(recovered.statusCode, recovered.body).toBe(200);
      const cookie = String(recovered.headers["set-cookie"]).split(";")[0];
      const me = await app.inject({
        url: "/api/v1/auth/me",
        headers: { cookie },
      });
      expect(me.json().user.email).toBe(account.email);
      expect((await db.one("SELECT count(*) AS count FROM users")).count).toBe(
        1,
      );
    } finally {
      await app.close();
    }
  });
  it("persists sessions and evidence across restarts, isolates businesses and rolls back writes", async () => {
    const folder = mkdtempSync(join(tmpdir(), "audittrak-pg-"));
    let db = postgres(join(folder, "db"));
    let app = buildServer({ database: db });
    try {
      const account = {
        name: "Test Owner",
        email: "owner@example.com",
        password: "TwelveCharacters!",
        businessName: "Test Studio",
      };
      const signup = await app.inject({
        method: "POST",
        url: "/api/v1/auth/signup",
        payload: account,
      });
      expect(signup.statusCode, signup.body).toBe(200);
      const user = signup.json().user;
      const cookie = String(signup.headers["set-cookie"]).split(";")[0];
      const duplicate = await app.inject({
        method: "POST",
        url: "/api/v1/auth/signup",
        payload: account,
      });
      expect(duplicate.statusCode).toBe(409);
      const seed = await app.inject({
        method: "POST",
        url: "/api/v1/demo/seed",
        headers: { cookie },
      });
      expect(seed.statusCode, seed.body).toBe(200);
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/events",
        headers: { cookie },
      });
      expect(list.statusCode, list.body).toBe(200);
      const events = list.json();
      expect(events).toHaveLength(5);
      for (const event of events) {
        const result = await app.inject({
          method: "POST",
          url: `/api/v1/events/${event.id}/assessment`,
          headers: { cookie },
        });
        expect(result.statusCode, result.body).toBe(200);
        expect(result.json().assessment.stale).toBe(false);
      }
      const profile = await app.inject({
        method: "GET",
        url: "/api/v1/profile",
        headers: { cookie },
      });
      expect(profile.statusCode, profile.body).toBe(200);
      expect(profile.json().events).toBe(5);
      const other = await app.inject({
        method: "POST",
        url: "/api/v1/auth/signup",
        payload: { ...account, email: "other@example.com" },
      });
      const otherCookie = String(other.headers["set-cookie"]).split(";")[0];
      const hidden = await app.inject({
        method: "GET",
        url: `/api/v1/events/${events[0].id}`,
        headers: { cookie: otherCookie },
      });
      expect(hidden.statusCode).toBe(404);
      const event = await db.event(events[0].id);
      const download = await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/evidence/${event.evidence[0].id}`,
        headers: { cookie },
      });
      expect(download.statusCode, download.body).toBe(200);
      expect(download.rawPayload.includes(Buffer.from("FICTIONAL DEMO"))).toBe(
        true,
      );
      const before = await db.all(
        "SELECT id FROM counterparties WHERE business_id=?",
        user.businessId,
      );
      await expect(
        db.atomic(async () => {
          await db.run(
            "INSERT INTO counterparties VALUES (?,?,?,?)",
            randomUUID(),
            user.businessId,
            "Rollback test",
            "",
          );
          throw new Error("Intentional rollback");
        }),
      ).rejects.toThrow("Intentional rollback");
      expect(
        await db.all(
          "SELECT id FROM counterparties WHERE business_id=?",
          user.businessId,
        ),
      ).toHaveLength(before.length);
      await app.close();
      db = postgres(join(folder, "db"));
      app = buildServer({ database: db });
      const saved = await app.inject({
        method: "GET",
        url: "/api/v1/events",
        headers: { cookie },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json()).toHaveLength(5);
      expect(
        saved.json().every((x: any) => x.assessment && !x.assessment.stale),
      ).toBe(true);
    } finally {
      await app.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }, 30000);
});
