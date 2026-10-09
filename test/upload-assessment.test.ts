import { expect, it } from "vitest";
import { assess } from "../src/mvp/assessment.js";

it("counts uploaded agreement and receipt without inventing their amounts or requiring an invoice to save them", () => {
  const result = assess({
    id: "upload-only",
    title: "Direct freelance job",
    currency: "NGN",
    revision: 1,
    agreement: null,
    invoice: null,
    transactions: [],
    fulfillment: null,
    attestations: [],
    evidence: [{ kind: "agreement" }, { kind: "payment" }],
  });
  expect(result.coverage.present).toBe(2);
  expect(result.netPaymentMinor).toBeNull();
  expect(result.status).toBe("review_required");
  expect(result.reasons.find((x) => x.code === "agreement").status).toBe(
    "uncertain",
  );
  expect(result.reasons.find((x) => x.code === "payment").message).toContain(
    "not been read",
  );
  expect(result.summary).not.toContain("0.00");
  expect(result.reasons.find((x) => x.code === "invoice").message).toContain(
    "do not issue invoices",
  );
});
