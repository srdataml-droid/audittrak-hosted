import { describe, expect, it } from "vitest";
import { reconcile } from "../src/reconcile.js";
import { conflictDemoEvidence, demoEvidence } from "../src/demo-data.js";

describe("deterministic reconciliation", () => {
  it("returns consistent signals for matching evidence", () => {
    const result = reconcile({ ...demoEvidence, eventId: "evt_test" });
    expect(result.status).toBe("consistent");
    expect(result.conflicts).toEqual([]);
    expect(
      result.signals.find(
        (signal) => signal.code === "invoice_payment_counterparty",
      )?.status,
    ).toBe("match");
    expect(result.decisioning).toEqual({
      creditDecision: null,
      fraudLabel: null,
    });
  });

  it("surfaces amount disagreements as conflicts", () => {
    const result = reconcile({
      ...conflictDemoEvidence,
      eventId: "evt_conflict",
    });
    expect(result.status).toBe("conflict");
    expect(result.conflicts.some((message) => message.includes("amount"))).toBe(
      true,
    );
  });

  it("does not compare values in different currencies", () => {
    const result = reconcile({
      ...demoEvidence,
      invoice: {
        ...demoEvidence.invoice,
        amount: { amountMinor: 25000000, currency: "USD" },
      },
    });
    expect(
      result.signals.find((signal) => signal.code === "currency_consistency")
        ?.status,
    ).toBe("mismatch");
    expect(
      result.signals.some((signal) => signal.code === "invoice_payment_amount"),
    ).toBe(false);
  });

  it("treats partial name overlap as uncertain instead of a confirmed match", () => {
    const result = reconcile({
      ...demoEvidence,
      payment: { ...demoEvidence.payment, counterparty: "Amina Limited" },
    });
    expect(result.status).toBe("review_required");
    expect(
      result.signals.find(
        (signal) => signal.code === "invoice_payment_counterparty",
      )?.status,
    ).toBe("uncertain");
  });

  it("flags outgoing payments and out-of-window timing", () => {
    const result = reconcile({
      ...demoEvidence,
      payment: {
        ...demoEvidence.payment,
        direction: "debit",
        transactionDate: "2027-02-01",
      },
    });
    expect(result.status).toBe("conflict");
    expect(
      result.signals.find((signal) => signal.code === "payment_direction")
        ?.status,
    ).toBe("mismatch");
    expect(
      result.signals.find((signal) => signal.code === "invoice_payment_timing")
        ?.status,
    ).toBe("uncertain");
  });
});
