import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const app = buildServer();
afterAll(async () => app.close());

describe("HTTP API", () => {
  it("serves a demo reconciliation and stores its evidence event", async () => {
    const demo = await app.inject({
      method: "POST",
      url: "/api/demo/reconcile",
    });
    expect(demo.statusCode).toBe(200);
    const body = demo.json();
    expect(body.result.status).toBe("consistent");
    const event = await app.inject({
      method: "GET",
      url: `/api/events/${body.event.id}`,
    });
    expect(event.statusCode).toBe(200);
    expect(event.json().event.evidence).toHaveLength(3);
  });

  it("shows an explained form for entering agreement, invoice, and payment details", async () => {
    const page = await app.inject({ method: "GET", url: "/prototype" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Try your own example");
    expect(page.body).toContain("What did you agree?");
    expect(page.body).toContain("What did the invoice say?");
    expect(page.body).toContain("What payment arrived?");
    expect(page.body).toContain("Compare my records");
  });

  it("accepts form-submitted evidence and returns a plain reconciliation result", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/reconcile",
      payload: {
        eventId: "manual_form_test",
        agreement: {
          id: "agr_form",
          kind: "agreement",
          source: "user",
          counterparty: "Chidi Eze",
          service: "Website",
          amount: { amountMinor: 30000000, currency: "NGN" },
        },
        invoice: {
          id: "inv_form",
          kind: "invoice",
          source: "user",
          invoiceNumber: "INV-FORM",
          counterparty: "Chidi Eze",
          service: "Website",
          amount: { amountMinor: 35000000, currency: "NGN" },
          issuedDate: "2026-10-01",
        },
        payment: {
          id: "pay_form",
          kind: "payment",
          source: "user",
          transactionId: "txn_form",
          direction: "credit",
          counterparty: "CHIDI EZE",
          amount: { amountMinor: 35000000, currency: "NGN" },
          transactionDate: "2026-10-03",
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.status).toBe("conflict");
    expect(response.json().result.conflicts.length).toBeGreaterThan(0);
  });

  it("serves the five fake scenarios and generated storyboard", async () => {
    const scenarios = await app.inject({
      method: "GET",
      url: "/api/demo/scenarios",
    });
    expect(scenarios.statusCode).toBe(200);
    expect(scenarios.json()).toHaveLength(5);
    const image = await app.inject({
      method: "GET",
      url: "/assets/audittrak-five-apps.png",
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toContain("image/png");
  });

  it("rejects malformed evidence instead of silently accepting it", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/evidence/validate",
      payload: { kind: "invoice", amount: "250" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("keeps AI extraction separate and reports when no provider is configured", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/documents/extract",
      payload: {
        documentId: "doc_1",
        documentKind: "invoice",
        documentText:
          "This is a sufficiently long invoice sample text for extraction.",
      },
    });
    expect(response.statusCode).toBe(503);
  });
});
