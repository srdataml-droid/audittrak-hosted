import type { Agreement, Invoice, Payment } from "./model.js";

export const demoEvidence: {
  agreement: Agreement;
  invoice: Invoice;
  payment: Payment;
} = {
  agreement: {
    id: "agr_demo_001",
    kind: "agreement",
    source: "demo",
    confidence: 0.98,
    counterparty: "Amina Okafor",
    service: "Brand identity design",
    amount: { amountMinor: 25000000, currency: "NGN" },
    effectiveDate: "2026-10-01",
    dueDate: "2026-10-31",
    reference: "BRAND-2026-014",
  },
  invoice: {
    id: "inv_demo_001",
    kind: "invoice",
    source: "demo",
    confidence: 0.99,
    invoiceNumber: "INV-2026-014",
    counterparty: "Amina Okafor",
    service: "Brand identity design",
    amount: { amountMinor: 25000000, currency: "NGN" },
    issuedDate: "2026-10-02",
    dueDate: "2026-10-31",
    reference: "BRAND-2026-014",
  },
  payment: {
    id: "pay_demo_001",
    kind: "payment",
    source: "demo",
    confidence: 1,
    transactionId: "txn_demo_001",
    direction: "credit",
    counterparty: "AMINA OKAFOR",
    description: "Payment BRAND-2026-014",
    amount: { amountMinor: 25000000, currency: "NGN" },
    transactionDate: "2026-10-06",
    reference: "BRAND-2026-014",
  },
};

export const conflictDemoEvidence = {
  ...demoEvidence,
  invoice: {
    ...demoEvidence.invoice,
    id: "inv_demo_002",
    invoiceNumber: "INV-2026-015",
    amount: { amountMinor: 27500000, currency: "NGN" },
  },
};
