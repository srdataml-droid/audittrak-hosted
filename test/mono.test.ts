import { describe, expect, it } from "vitest";
import { normalizeMonoTransaction } from "../src/mono.js";

describe("Mono transaction normalization", () => {
  it("maps transaction records into minor-unit payment evidence", () => {
    const payment = normalizeMonoTransaction({
      id: "tx_123",
      type: "credit",
      amount: 25000000,
      currency: "NGN",
      narration: "AMINA OKAFOR BRAND-014",
      date: "2026-10-06T10:00:00Z",
      reference: "BRAND-014",
    });
    expect(payment).toMatchObject({
      id: "mono_tx_123",
      source: "mono",
      transactionId: "tx_123",
      direction: "credit",
      counterparty: "Unknown counterparty",
      confidence: 0.55,
      amount: { amountMinor: 25000000, currency: "NGN" },
      transactionDate: "2026-10-06",
    });
  });
});

it("rejects unknown directions rather than guessing a debit", () => {
  expect(() =>
    normalizeMonoTransaction({
      id: "bad",
      type: "pending",
      amount: 100,
      date: "2026-10-03",
    }),
  ).toThrow("direction");
});
