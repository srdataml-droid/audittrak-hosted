import { z } from "zod";

export const EvidenceSourceSchema = z.enum([
  "user",
  "mono",
  "document_extraction",
  "demo",
]);
export const MoneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).toUpperCase(),
});

const BaseEvidence = z.object({
  id: z.string().min(1),
  source: EvidenceSourceSchema,
  sourceRef: z.string().optional(),
  observedAt: z.string().datetime().optional(),
  confidence: z.number().min(0).max(1).default(1),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export const AgreementSchema = BaseEvidence.extend({
  kind: z.literal("agreement"),
  counterparty: z.string().min(1),
  service: z.string().min(1),
  amount: MoneySchema,
  effectiveDate: z.string().date().optional(),
  dueDate: z.string().date().optional(),
  reference: z.string().optional(),
});

export const InvoiceSchema = BaseEvidence.extend({
  kind: z.literal("invoice"),
  invoiceNumber: z.string().min(1),
  counterparty: z.string().min(1),
  service: z.string().optional(),
  amount: MoneySchema,
  issuedDate: z.string().date(),
  dueDate: z.string().date().optional(),
  reference: z.string().optional(),
});

export const PaymentSchema = BaseEvidence.extend({
  kind: z.literal("payment"),
  transactionId: z.string().min(1),
  direction: z.enum(["credit", "debit"]),
  counterparty: z.string().min(1),
  description: z.string().optional(),
  amount: MoneySchema,
  transactionDate: z.string().date(),
  reference: z.string().optional(),
});

export const EvidenceSchema = z.discriminatedUnion("kind", [
  AgreementSchema,
  InvoiceSchema,
  PaymentSchema,
]);
export const ReconcileRequestSchema = z.object({
  eventId: z.string().min(1).optional(),
  agreement: AgreementSchema,
  invoice: InvoiceSchema,
  payment: PaymentSchema,
  amountToleranceMinor: z.number().int().nonnegative().default(0),
  timingWindowDays: z.number().int().nonnegative().default(90),
});

export type Agreement = z.infer<typeof AgreementSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type ReconcileRequest = z.infer<typeof ReconcileRequestSchema>;
export type ReconcileInput = z.input<typeof ReconcileRequestSchema>;

export interface Signal {
  code: string;
  status: "match" | "mismatch" | "uncertain" | "missing";
  severity: "info" | "warning" | "conflict";
  message: string;
  evidenceIds: string[];
  details?: Record<string, unknown>;
}

export interface ReconciliationResult {
  eventId: string;
  status: "consistent" | "review_required" | "conflict";
  signals: Signal[];
  warnings: string[];
  conflicts: string[];
  evidenceConfidence: number;
  reviewerSummary: string;
  decisioning: { creditDecision: null; fraudLabel: null };
}
