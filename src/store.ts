import type { Evidence, ReconciliationResult } from "./model.js";

export interface CommercialEvent {
  id: string;
  evidence: Evidence[];
  reconciliation?: ReconciliationResult;
  createdAt: string;
}

export class InMemoryEvidenceStore {
  private readonly events = new Map<string, CommercialEvent>();

  save(event: CommercialEvent): CommercialEvent {
    this.events.set(event.id, structuredClone(event));
    return structuredClone(event);
  }

  get(id: string): CommercialEvent | undefined {
    const event = this.events.get(id);
    return event ? structuredClone(event) : undefined;
  }
}
