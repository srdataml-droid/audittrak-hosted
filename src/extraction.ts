import { z } from "zod";

export const ExtractionRequestSchema = z.object({
  documentText: z.string().min(20).max(50_000),
  documentId: z.string().min(1),
  documentKind: z.enum(["agreement", "invoice"]),
});

export const ExtractedFieldSchema = z.object({
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  supportingText: z.string().min(1),
});

export const ExtractionResultSchema = z.object({
  documentId: z.string(),
  documentKind: z.enum(["agreement", "invoice"]),
  status: z.literal("proposed_for_review"),
  fields: z.record(z.string(), ExtractedFieldSchema),
  guardrails: z.object({
    deterministicReconciliationUnaffected: z.literal(true),
    reviewerConfirmationRequired: z.literal(true),
  }),
});

export type ExtractionRequest = z.infer<typeof ExtractionRequestSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

/** Provider boundary: extraction proposes fields with source spans; the caller must never treat these as verified evidence. */
export interface DocumentExtractor {
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}

/** Optional HTTP bridge to an organization's configured extraction service. It accepts/returns the typed contract above. */
export class HttpDocumentExtractor implements DocumentExtractor {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string,
  ) {}

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(request),
    });
    if (!response.ok)
      throw new Error(
        `Document extraction provider failed with HTTP ${response.status}`,
      );
    return ExtractionResultSchema.parse(await response.json());
  }
}
