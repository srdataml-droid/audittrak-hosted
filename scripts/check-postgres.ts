import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgresDatabase } from "../src/mvp/postgres.js";
import { buildServer } from "../src/server.js";

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL first.");
process.env.AUDITTRAK_SERVERLESS = "true";
const runId = randomUUID();
const accounts: { id: string; businessId: string }[] = [];
let db = new PostgresDatabase(process.env.DATABASE_URL);
let app = buildServer({ database: db });
const signup = async (suffix: string) => {
  const result = await app.inject({
    method: "POST",
    url: "/api/v1/auth/signup",
    payload: {
      name: "Deployment Test",
      email: `deployment-${runId}-${suffix}@example.com`,
      password: randomUUID(),
      businessName: "Synthetic Test Workspace",
    },
  });
  assert.equal(result.statusCode, 200, result.body);
  accounts.push(result.json().user);
  return String(result.headers["set-cookie"]).split(";")[0];
};
try {
  const cookie = await signup("owner");
  const seeded = await app.inject({
    method: "POST",
    url: "/api/v1/demo/seed",
    headers: { cookie },
  });
  assert.equal(seeded.statusCode, 200, seeded.body);
  const list = await app.inject({
    method: "GET",
    url: "/api/v1/events",
    headers: { cookie },
  });
  assert.equal(list.statusCode, 200, list.body);
  const events = list.json();
  assert.equal(events.length, 5);
  for (const event of events) {
    const assessment = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/assessment`,
      headers: { cookie },
    });
    assert.equal(assessment.statusCode, 200, assessment.body);
    assert.ok(assessment.json().assessment);
  }
  const profile = await app.inject({
    method: "GET",
    url: "/api/v1/profile",
    headers: { cookie },
  });
  assert.equal(profile.statusCode, 200, profile.body);
  assert.equal(profile.json().events, 5);
  const otherCookie = await signup("other");
  const forbidden = await app.inject({
    method: "GET",
    url: `/api/v1/events/${events[0].id}`,
    headers: { cookie: otherCookie },
  });
  assert.equal(forbidden.statusCode, 404);
  const event = await db.event(events[0].id);
  const file = await app.inject({
    method: "GET",
    url: `/api/v1/events/${event.id}/evidence/${event.evidence[0].id}`,
    headers: { cookie },
  });
  assert.equal(file.statusCode, 200, file.body);
  assert.ok(file.rawPayload.includes(Buffer.from("FICTIONAL DEMO")));
  const before = (
    await db.all(
      "SELECT id FROM counterparties WHERE business_id=?",
      accounts[0].businessId,
    )
  ).length;
  await assert.rejects(
    db.atomic(async () => {
      await db.run(
        "INSERT INTO counterparties VALUES (?,?,?,?)",
        randomUUID(),
        accounts[0].businessId,
        "Rollback test",
        "",
      );
      throw new Error("Intentional rollback");
    }),
  );
  assert.equal(
    (
      await db.all(
        "SELECT id FROM counterparties WHERE business_id=?",
        accounts[0].businessId,
      )
    ).length,
    before,
  );
  await app.close();
  db = new PostgresDatabase(process.env.DATABASE_URL);
  app = buildServer({ database: db });
  const persisted = await app.inject({
    method: "GET",
    url: "/api/v1/events",
    headers: { cookie },
  });
  assert.equal(persisted.statusCode, 200, persisted.body);
  assert.equal(persisted.json().length, 5);
  console.log(
    "PostgreSQL check passed: saved sessions, five scenarios, assessments, profile, private evidence, isolation, rollback and restart persistence.",
  );
} finally {
  for (const account of accounts) {
    await db.atomic(async () => {
      await db.run(
        "DELETE FROM commercial_events WHERE business_id=?",
        account.businessId,
      );
      await db.run(
        "DELETE FROM audit_logs WHERE business_id=?",
        account.businessId,
      );
      await db.run(
        "DELETE FROM commercial_activity_profiles WHERE business_id=?",
        account.businessId,
      );
      await db.run(
        "DELETE FROM counterparties WHERE business_id=?",
        account.businessId,
      );
      await db.run("DELETE FROM sessions WHERE user_id=?", account.id);
      await db.run("DELETE FROM businesses WHERE id=?", account.businessId);
      await db.run("DELETE FROM users WHERE id=?", account.id);
    });
  }
  await app.close();
}
