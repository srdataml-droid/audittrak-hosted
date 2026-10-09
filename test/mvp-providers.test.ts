import { it, expect } from "vitest";
import { buildServer } from "../src/server.js";
import { MvpDatabase } from "../src/mvp/db.js";
import type { MonoTransactionsAdapter } from "../src/mono.js";
it("imports only transactions fetched from the business-bound account", async () => {
  const old = process.env.MONO_ACCOUNT_BINDINGS;
  let requested = "";
  const mono = {
    listTransactions: async (account: string) => {
      requested = account;
      return [
        {
          id: "mono-tx1",
          kind: "payment",
          source: "mono",
          transactionId: "tx1",
          direction: "credit",
          counterparty: "Amina",
          amount: { amountMinor: 10000, currency: "NGN" },
          transactionDate: "2026-10-03",
          confidence: 0.9,
        },
      ];
    },
  } as unknown as MonoTransactionsAdapter;
  const app = buildServer({ database: new MvpDatabase(":memory:"), mono });
  try {
    const signup = await app.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: {
        name: "Owner",
        email: "owner@example.com",
        password: "PasswordForDemo!",
        businessName: "Studio",
      },
    });
    const cookie = String(signup.headers["set-cookie"]).split(";")[0],
      bid = signup.json().user.businessId;
    const call = (method: any, path: string, payload?: any) =>
      app.inject({
        method,
        url: "/api/v1" + path,
        headers: { cookie },
        payload,
      });
    const job = (
        await call("POST", "/events", {
          title: "Logo",
          service: "Design",
          counterparty: "Amina",
        })
      ).json(),
      path = "/events/" + job.id + "/mono-import";
    process.env.MONO_ACCOUNT_BINDINGS = "{}";
    expect(
      (await call("POST", path, { transactionIds: ["tx1"] })).statusCode,
    ).toBe(403);
    process.env.MONO_ACCOUNT_BINDINGS = JSON.stringify({
      [bid]: "consented-sandbox-account",
    });
    expect(
      (await call("POST", path, { transactionIds: ["not-returned"] }))
        .statusCode,
    ).toBe(400);
    const imported = await call("POST", path, { transactionIds: ["tx1"] });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().transactions[0].source).toBe("mono");
    expect(requested).toBe("consented-sandbox-account");
    expect(
      (await call("POST", path, { transactionIds: ["tx1"] })).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/providers/mono/accounts/arbitrary/transactions",
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
    if (old === undefined) delete process.env.MONO_ACCOUNT_BINDINGS;
    else process.env.MONO_ACCOUNT_BINDINGS = old;
  }
});
it("stores supported extraction as a proposal and rejects invented excerpts", async () => {
  let invent = false;
  const app = buildServer({
    database: new MvpDatabase(":memory:"),
    extractor: {
      extract: async (req) => ({
        documentId: req.documentId,
        documentKind: req.documentKind,
        status: "proposed_for_review",
        fields: {
          counterparty: {
            value: "Amina",
            confidence: 0.8,
            supportingText: invent
              ? "Never present in the supplied text"
              : "Amina logo design",
          },
        },
        guardrails: {
          deterministicReconciliationUnaffected: true,
          reviewerConfirmationRequired: true,
        },
      }),
    },
  });
  try {
    const signup = await app.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: {
        name: "Owner",
        email: "owner@example.com",
        password: "PasswordForDemo!",
        businessName: "Studio",
      },
    });
    const cookie = String(signup.headers["set-cookie"]).split(";")[0];
    const call = (method: any, path: string, payload?: any) =>
      app.inject({
        method,
        url: "/api/v1" + path,
        headers: { cookie },
        payload,
      });
    const job = (
        await call("POST", "/events", {
          title: "Logo",
          service: "Design",
          counterparty: "Amina",
        })
      ).json(),
      path = "/events/" + job.id;
    let e = (
      await call("POST", path + "/evidence", {
        kind: "agreement",
        name: "agreement.txt",
        mime: "text/plain",
        base64: Buffer.from("Amina logo design for NGN 100").toString("base64"),
      })
    ).json();
    const req = {
      documentId: e.evidence[0].id,
      documentKind: "agreement",
      documentText: "Amina logo design for NGN 100",
    };
    expect(
      (
        await call("POST", path + "/extraction", {
          ...req,
          documentId: "unattached",
        })
      ).statusCode,
    ).toBe(400);
    expect((await call("POST", path + "/extraction", req)).statusCode).toBe(
      200,
    );
    e = (await call("GET", path)).json();
    expect(e.agreement).toBeNull();
    expect(e.assessment).toBeNull();
    expect(e.proposals).toHaveLength(1);
    invent = true;
    expect((await call("POST", path + "/extraction", req)).statusCode).toBe(
      502,
    );
    e = (await call("GET", path)).json();
    expect(e.proposals).toHaveLength(1);
  } finally {
    await app.close();
  }
});
