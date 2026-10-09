import type { ReconciliationResult, ReconcileInput, Signal } from "./model.js";

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
const daysBetween = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
  86_400_000;

function entitySignal(
  code: string,
  label: string,
  a: string,
  b: string,
  ids: string[],
): Signal {
  const na = normalize(a),
    nb = normalize(b);
  if (
    !na ||
    !nb ||
    na === "unknown counterparty" ||
    nb === "unknown counterparty"
  ) {
    return {
      code,
      status: "uncertain",
      severity: "warning",
      message: `${label} could not be established from the supplied evidence; reviewer confirmation is needed.`,
      evidenceIds: ids,
      details: { left: a, right: b },
    };
  }
  const exact = na === nb;
  const tokenOverlap = new Set(
    na
      .split(" ")
      .filter(Boolean)
      .filter((token) => nb.split(" ").includes(token)),
  ).size;
  const denominator =
    new Set([...na.split(" "), ...nb.split(" ")].filter(Boolean)).size || 1;
  const similarity = tokenOverlap / denominator;
  const status = exact ? "match" : similarity >= 0.3 ? "uncertain" : "mismatch";
  return {
    code,
    status,
    severity:
      status === "mismatch"
        ? "conflict"
        : status === "uncertain"
          ? "warning"
          : "info",
    message: exact
      ? `${label} match after normalization.`
      : status === "uncertain"
        ? `${label} partially overlaps; reviewer confirmation is needed.`
        : `${label} differs across evidence.`,
    evidenceIds: ids,
    details: {
      left: a,
      right: b,
      normalizedLeft: na,
      normalizedRight: nb,
      tokenOverlap: similarity,
    },
  };
}

export function reconcile(input: ReconcileInput): ReconciliationResult {
  const { agreement: a, invoice: i, payment: p } = input;
  const amountToleranceMinor = input.amountToleranceMinor ?? 0;
  const timingWindowDays = input.timingWindowDays ?? 90;
  const signals: Signal[] = [];
  const ids = [a.id, i.id, p.id];
  const allCurrencyMatch =
    a.amount.currency === i.amount.currency &&
    i.amount.currency === p.amount.currency;
  signals.push({
    code: "currency_consistency",
    status: allCurrencyMatch ? "match" : "mismatch",
    severity: allCurrencyMatch ? "info" : "conflict",
    message: allCurrencyMatch
      ? `All evidence uses ${a.amount.currency}.`
      : "Currency differs across evidence; amounts were not compared across currencies.",
    evidenceIds: ids,
    details: {
      agreement: a.amount.currency,
      invoice: i.amount.currency,
      payment: p.amount.currency,
    },
  });

  if (allCurrencyMatch) {
    const pairings = [
      [
        "agreement_invoice_amount",
        "Agreement ↔ invoice amount",
        a.amount.amountMinor,
        i.amount.amountMinor,
        [a.id, i.id],
      ],
      [
        "invoice_payment_amount",
        "Invoice ↔ payment amount",
        i.amount.amountMinor,
        p.amount.amountMinor,
        [i.id, p.id],
      ],
      [
        "agreement_payment_amount",
        "Agreement ↔ payment amount",
        a.amount.amountMinor,
        p.amount.amountMinor,
        [a.id, p.id],
      ],
    ] as const;
    for (const [code, label, left, right, evidenceIds] of pairings) {
      const delta = Math.abs(left - right);
      const match = delta <= amountToleranceMinor;
      signals.push({
        code,
        status: match ? "match" : "mismatch",
        severity: match ? "info" : "conflict",
        message: match
          ? `${label} is within the configured tolerance.`
          : `${label} differs by ${delta} minor currency units.`,
        evidenceIds: [...evidenceIds],
        details: {
          leftMinor: left,
          rightMinor: right,
          deltaMinor: delta,
          toleranceMinor: amountToleranceMinor,
        },
      });
    }
  }

  signals.push(
    entitySignal(
      "agreement_invoice_counterparty",
      "Agreement ↔ invoice counterparty",
      a.counterparty,
      i.counterparty,
      [a.id, i.id],
    ),
  );
  signals.push(
    entitySignal(
      "invoice_payment_counterparty",
      "Invoice ↔ payment counterparty",
      i.counterparty,
      p.counterparty,
      [i.id, p.id],
    ),
  );
  const references = [a.reference, i.reference, p.reference].filter(
    (x): x is string => Boolean(x),
  );
  if (references.length > 1) {
    const distinct = new Set(references.map(normalize));
    signals.push({
      code: "reference_consistency",
      status: distinct.size === 1 ? "match" : "uncertain",
      severity: distinct.size === 1 ? "info" : "warning",
      message:
        distinct.size === 1
          ? "Provided references agree."
          : "Provided references differ; reference fields may use different identifiers.",
      evidenceIds: ids,
      details: { references },
    });
  }
  const elapsed = daysBetween(i.issuedDate, p.transactionDate);
  const timingMatch =
    p.transactionDate >= i.issuedDate && elapsed <= timingWindowDays;
  signals.push({
    code: "invoice_payment_timing",
    status: timingMatch ? "match" : "uncertain",
    severity: timingMatch ? "info" : "warning",
    message: timingMatch
      ? "Payment date falls on or after invoice date within the configured window."
      : "Payment timing is outside the configured invoice window and needs review.",
    evidenceIds: [i.id, p.id],
    details: {
      invoiceDate: i.issuedDate,
      paymentDate: p.transactionDate,
      absoluteDaysApart: elapsed,
      timingWindowDays,
    },
  });
  signals.push({
    code: "payment_direction",
    status: p.direction === "credit" ? "match" : "mismatch",
    severity: p.direction === "credit" ? "info" : "conflict",
    message:
      p.direction === "credit"
        ? "The supplied payment record shows an incoming credit."
        : "Transaction is a debit, not an incoming payment.",
    evidenceIds: [p.id],
    details: { direction: p.direction },
  });

  const warnings = signals
    .filter((s) => s.severity === "warning")
    .map((s) => s.message);
  const conflicts = signals
    .filter((s) => s.severity === "conflict")
    .map((s) => s.message);
  const status = conflicts.length
    ? "conflict"
    : warnings.length
      ? "review_required"
      : "consistent";
  const evidenceConfidence = Number(
    (
      Math.min(a.confidence ?? 1, i.confidence ?? 1, p.confidence ?? 1) *
      (signals.some((s) => s.status === "uncertain") ? 0.85 : 1)
    ).toFixed(2),
  );
  const reviewerSummary =
    status === "consistent"
      ? `Agreement ${a.id}, invoice ${i.invoiceNumber}, and payment ${p.transactionId} agree on amount, counterparty, currency, timing, and payment direction based on the supplied evidence.`
      : status === "conflict"
        ? `Review required: ${conflicts.length} deterministic conflict(s) were found among agreement ${a.id}, invoice ${i.invoiceNumber}, and payment ${p.transactionId}.${warnings.length ? ` ${warnings.length} additional warning(s) need review.` : ""}`
        : `Review required: ${warnings.length} signal(s) are uncertain for agreement ${a.id}, invoice ${i.invoiceNumber}, and payment ${p.transactionId}.`;

  return {
    eventId: input.eventId ?? `evt_${i.id}`,
    status,
    signals,
    warnings,
    conflicts,
    evidenceConfidence,
    reviewerSummary,
    decisioning: { creditDecision: null, fraudLabel: null },
  };
}
