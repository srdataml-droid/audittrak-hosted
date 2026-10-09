import { describe, expect, it } from "vitest";
import { ReconcileRequestSchema } from "../src/model.js";
import { reconcile } from "../src/reconcile.js";
import scenarios from "../data/five-scenarios.json" with { type: "json" };

describe("five fictional app-source scenarios", () => {
  it("contains five complete scenarios with five app records each", () => {
    expect(scenarios).toHaveLength(5);
    expect(new Set(scenarios.map((scenario) => scenario.customer)).size).toBe(
      5,
    );
    expect(
      scenarios.filter(
        (scenario) => scenario.channel === "Freelance marketplace",
      ),
    ).toHaveLength(3);
    expect(
      scenarios.filter((scenario) => scenario.channel === "Direct client"),
    ).toHaveLength(2);
    for (const scenario of scenarios) {
      expect(Object.keys(scenario.appRecords)).toHaveLength(5);
      expect(scenario.appRecords.chat.messages).toHaveLength(4);
      expect(
        ReconcileRequestSchema.safeParse(scenario.reconciliationRequest)
          .success,
      ).toBe(true);
    }
  });

  it.each(scenarios.map((scenario) => [scenario.title, scenario] as const))(
    "runs expected comparison rules for %s",
    (_title, scenario) => {
      const request = ReconcileRequestSchema.parse(
        scenario.reconciliationRequest,
      );
      const result = reconcile(request);
      expect(result.status).toBe(scenario.expectedStatus);
      if (scenario.id === "job-1-match")
        expect(result.status).toBe("consistent");
      if (scenario.id === "job-2-scope-change")
        expect(
          result.signals.find(
            (signal) => signal.code === "agreement_invoice_amount",
          )?.status,
        ).toBe("mismatch");
      if (scenario.id === "job-3-part-payment")
        expect(
          result.signals.find(
            (signal) => signal.code === "invoice_payment_amount",
          )?.status,
        ).toBe("mismatch");
      if (scenario.id === "job-4-third-party-payer")
        expect(
          result.signals.find(
            (signal) => signal.code === "invoice_payment_counterparty",
          )?.status,
        ).toBe("mismatch");
      if (scenario.id === "job-5-reversal")
        expect(
          result.signals.find((signal) => signal.code === "payment_direction")
            ?.status,
        ).toBe("mismatch");
    },
  );

  it.each(scenarios.map((scenario) => [scenario.customer, scenario] as const))(
    "serves a reconciliation for %s",
    async (_customer, scenario) => {
      const { buildServer } = await import("../src/server.js");
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: `/api/demo/scenarios/${scenario.id}/reconcile`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().scenario.customer).toBe(scenario.customer);
      expect(response.json().result.status).toBe(scenario.expectedStatus);
      await app.close();
    },
  );
});
