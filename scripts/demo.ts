import { reconcile } from "../src/reconcile.js";
import { conflictDemoEvidence, demoEvidence } from "../src/demo-data.js";

for (const [name, evidence] of [
  ["matching", demoEvidence],
  ["conflict", conflictDemoEvidence],
] as const) {
  const result = reconcile({ ...evidence, eventId: `evt_${name}` });
  console.log(JSON.stringify({ scenario: name, ...result }, null, 2));
}
