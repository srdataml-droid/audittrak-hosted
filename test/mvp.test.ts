import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";
import { MvpDatabase, id, now, passwordHash } from "../src/mvp/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const signup = {
  name: "Test Owner",
  email: "test@example.com",
  password: "TwelveCharacters!",
  businessName: "Test Studio",
};
const job = {
  title: "Logo job",
  service: "Logo design",
  counterparty: "Amina",
  currency: "NGN",
  channel: "direct",
};
const agreement = {
  id: "a1",
  kind: "agreement",
  source: "user",
  counterparty: "Amina",
  service: "Logo design",
  amount: { amountMinor: 25000000, currency: "NGN" },
  effectiveDate: "2026-10-01",
};
const invoice = {
  id: "i1",
  kind: "invoice",
  source: "user",
  counterparty: "Amina",
  service: "Logo design",
  invoiceNumber: "INV-1",
  amount: { amountMinor: 25000000, currency: "NGN" },
  issuedDate: "2026-10-02",
};
const payment = {
  id: "p1",
  kind: "payment",
  source: "user",
  counterparty: "Amina",
  transactionId: "TX1",
  direction: "credit",
  amount: { amountMinor: 25000000, currency: "NGN" },
  transactionDate: "2026-10-03",
};
async function fixture() {
  const db = new MvpDatabase(":memory:"),
    app = buildServer({ database: db });
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/signup",
    payload: signup,
  });
  expect(r.statusCode).toBe(200);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const call = (method: any, path: string, payload?: any, c = cookie) =>
    app.inject({
      method,
      url: "/api/v1" + path,
      headers: { cookie: c },
      payload,
    });
  return { db, app, call, cookie };
}
describe("MVP business workflow", () => {
  it("saves five evidence stages, invalidates old assessments and limits reviewer access", async () => {
    const { db, app, call } = await fixture();
    try {
      const uid = id();
      db.run(
        "INSERT INTO users VALUES (?,?,?,?,?,?)",
        uid,
        "reviewer@example.com",
        "Reviewer",
        passwordHash("ReviewerPassword!"),
        "reviewer",
        now(),
      );
      const r = await call("POST", "/auth/login", {
        email: "reviewer@example.com",
        password: "ReviewerPassword!",
      });
      const rc = String(r.headers["set-cookie"]).split(";")[0];
      let event = (await call("POST", "/events", job)).json();
      const path = "/events/" + event.id;
      expect((await call("GET", path, undefined, rc)).statusCode).toBe(404);
      for (const [k, v] of [
        ["agreement", agreement],
        ["invoice", invoice],
      ] as const)
        expect((await call("PUT", path + "/" + k, v)).statusCode).toBe(200);
      expect(
        (await call("POST", path + "/transactions", payment)).statusCode,
      ).toBe(200);
      expect(
        (await call("POST", path + "/transactions", payment)).statusCode,
      ).toBe(409);
      await call("PUT", path + "/fulfillment", {
        status: "completed",
        description: "Logo files delivered",
        completedDate: "2026-10-03",
      });
      await call("POST", path + "/evidence", {
        kind: "fulfillment",
        name: "delivery.txt",
        mime: "text/plain",
        base64: Buffer.from("Fictional logo delivery record").toString(
          "base64",
        ),
      });
      const invite = (await call("POST", path + "/attestations")).json();
      const tp = "/attest/" + invite.path.split("/").pop();
      event = (await call("POST", path + "/assessment")).json();
      expect(event.assessment.status).toBe("review_required");
      expect(
        (
          await call(
            "POST",
            tp,
            {
              name: "Amina",
              status: "confirmed",
              comment: "Received the files.",
            },
            "",
          )
        ).statusCode,
      ).toBe(200);
      expect((await call("POST", path + "/submit")).statusCode).toBe(400);
      event = (await call("POST", path + "/assessment")).json();
      expect(event.assessment.status).toBe("consistent");
      expect(event.assessment.coverage.present).toBe(5);
      expect(event.assessment.decisioning.creditDecision).toBeNull();
      expect((await call("POST", path + "/submit")).statusCode).toBe(200);
      expect((await call("GET", path, undefined, rc)).statusCode).toBe(200);
      expect(
        (
          await call(
            "POST",
            path + "/reviews",
            { note: "Supporting records reviewed." },
            rc,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (await call("POST", tp, { name: "Amina", status: "disputed" }, ""))
          .statusCode,
      ).toBe(409);
      await call("PUT", path + "/agreement", agreement);
      expect((await call("GET", tp, undefined, "")).statusCode).toBe(409);
      expect((await call("GET", path, undefined, rc)).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
  it("isolates businesses and rejects cross-origin writes", async () => {
    const { app, call } = await fixture();
    try {
      const event = (await call("POST", "/events", job)).json();
      const other = await call("POST", "/auth/signup", {
        ...signup,
        email: "other@example.com",
      });
      const c = String(other.headers["set-cookie"]).split(";")[0];
      expect(
        (await call("GET", "/events/" + event.id, undefined, c)).statusCode,
      ).toBe(404);
      expect(
        (await call("DELETE", "/events/" + event.id, undefined, c)).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/events",
            headers: { origin: "https://evil.example", host: "localhost" },
            payload: job,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/events" })).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
  it("handles reversal and mixed currencies without inventing authenticity", async () => {
    const { app, call } = await fixture();
    try {
      const event = (await call("POST", "/events", job)).json(),
        p = "/events/" + event.id;
      await call("PUT", p + "/agreement", agreement);
      await call("PUT", p + "/invoice", invoice);
      await call("POST", p + "/transactions", payment);
      await call("POST", p + "/transactions", {
        ...payment,
        id: "p2",
        transactionId: "TX2",
        direction: "debit",
      });
      let e = (await call("POST", p + "/assessment")).json();
      expect(e.assessment.netPaymentMinor).toBe(0);
      expect(e.assessment.status).toBe("conflict");
      await call("POST", p + "/transactions", {
        ...payment,
        id: "p3",
        transactionId: "TX3",
        amount: { amountMinor: 100, currency: "USD" },
      });
      e = (await call("POST", p + "/assessment")).json();
      expect(e.assessment.netPaymentMinor).toBeNull();
      expect(
        e.assessment.conflicts.some((x: any) => x.code === "payment_currency"),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });
  it("loads five separate fictional customers and keeps confirmation missing", async () => {
    const { app, call } = await fixture();
    try {
      expect((await call("POST", "/demo/seed")).statusCode).toBe(200);
      const events = (await call("GET", "/events")).json();
      expect(events).toHaveLength(5);
      expect(new Set(events.map((x: any) => x.counterparty)).size).toBe(5);
      for (const e of events) {
        const assessed = (
          await call("POST", "/events/" + e.id + "/assessment")
        ).json();
        expect(assessed.assessment.coverage.present).toBe(3);
      }
      expect((await call("POST", "/demo/seed")).statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
  it("retains accounts and events after reopening the database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audittrak-")),
      path = join(dir, "test.sqlite");
    try {
      let db = new MvpDatabase(path),
        app = buildServer({ database: db });
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/auth/signup",
        payload: signup,
      });
      const cookie = String(r.headers["set-cookie"]).split(";")[0];
      await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { cookie },
        payload: job,
      });
      await app.close();
      db = new MvpDatabase(path);
      app = buildServer({ database: db });
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/events",
        headers: { cookie },
      });
      expect(response.json()).toHaveLength(1);
      await app.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("serves the built interface and its local assets", async () => {
    const { app } = await fixture();
    try {
      const html = await app.inject("/");
      expect(html.statusCode).toBe(200);
      const asset = html.body.match(/src="([^"]+\.js)"/)?.[1];
      expect(asset).toBeTruthy();
      expect((await app.inject(asset!)).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
