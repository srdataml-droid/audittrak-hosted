import { z } from "zod";
import type { Payment } from "./model.js";

const RawTransactionSchema = z
  .object({
    id: z.string().optional(),
    transaction_id: z.string().optional(),
    type: z.string().optional(),
    amount: z.number().int().nonnegative(),
    currency: z.string().optional(),
    narration: z.string().optional(),
    description: z.string().optional(),
    date: z.string().optional(),
    created_at: z.string().optional(),
    reference: z.string().optional(),
    counterparty: z.string().optional(),
    balance: z.number().optional(),
  })
  .passthrough();

function dateOnly(value: string | undefined): string {
  if (!value) throw new Error("Mono transaction omitted its transaction date");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()))
    throw new Error("Mono transaction returned an invalid date");
  return parsed.toISOString().slice(0, 10);
}

/** Mono returns NGN transaction amounts in kobo; this adapter preserves that minor-unit representation. */
export function normalizeMonoTransaction(value: unknown): Payment {
  const tx = RawTransactionSchema.parse(value);
  const transactionId = tx.id ?? tx.transaction_id;
  if (!transactionId) throw new Error("Mono transaction omitted its id");
  const direction = (tx.type ?? "").toLowerCase();
  if (!["credit", "debit"].includes(direction))
    throw new Error("Mono transaction direction is unknown");
  const credit = direction === "credit";
  const description = tx.narration ?? tx.description ?? "";
  return {
    id: `mono_${transactionId}`,
    kind: "payment",
    source: "mono",
    sourceRef: transactionId,
    confidence: tx.counterparty ? 0.9 : 0.55,
    transactionId,
    direction: credit ? "credit" : "debit",
    counterparty: tx.counterparty ?? "Unknown counterparty",
    description,
    amount: {
      amountMinor: tx.amount,
      currency: (tx.currency ?? "NGN").toUpperCase(),
    },
    transactionDate: dateOnly(tx.date ?? tx.created_at),
    reference: tx.reference,
    raw: value as Record<string, unknown>,
  };
}

export class MonoTransactionsAdapter {
  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = "https://api.withmono.com",
  ) {
    if (!secretKey) throw new Error("Mono secret key is required");
  }

  async listTransactions(
    accountId: string,
    options: { start?: string; end?: string } = {},
  ): Promise<Payment[]> {
    if (!accountId.trim()) throw new Error("Mono account id is required");
    const url = new URL(
      `/v2/accounts/${encodeURIComponent(accountId)}/transactions`,
      this.baseUrl,
    );
    url.searchParams.set("paginate", "false");
    if (options.start) url.searchParams.set("start", options.start);
    if (options.end) url.searchParams.set("end", options.end);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { accept: "application/json", "mono-sec-key": this.secretKey },
    });
    if (!response.ok)
      throw new Error(
        `Mono transactions request failed with HTTP ${response.status}`,
      );
    const body: unknown = await response.json();
    const parsed = z
      .object({ data: z.array(z.unknown()) })
      .passthrough()
      .parse(body);
    return parsed.data.map(normalizeMonoTransaction);
  }
}
