import { reconcile } from "../reconcile.js";
export function assess(event: any) {
  const reasons: any[] = [];
  const add = (code: string, status: string, message: string) =>
    reasons.push({ code, status, message });
  let comparison: any = null;
  const currencyMismatch = event.transactions.some(
    (tx: any) => tx.amount.currency !== event.currency,
  );
  const net = event.transactions.reduce(
    (sum: number, tx: any) =>
      sum +
      (tx.direction === "credit"
        ? tx.amount.amountMinor
        : -tx.amount.amountMinor),
    0,
  );
  if (!event.agreement) add("agreement", "missing", "Agreement is missing.");
  if (!event.invoice) add("invoice", "missing", "Invoice is missing.");
  if (!event.transactions.length)
    add("payment", "missing", "No payment record has been linked.");
  if (currencyMismatch)
    add(
      "payment_currency",
      "mismatch",
      "Payment currencies differ; amounts cannot be combined across currencies.",
    );
  if (
    event.agreement &&
    event.invoice &&
    event.transactions.length &&
    !currencyMismatch
  ) {
    const credit =
      event.transactions.find((tx: any) => tx.direction === "credit") ??
      event.transactions[0];
    comparison = reconcile({
      eventId: event.id,
      agreement: event.agreement,
      invoice: event.invoice,
      payment: {
        ...credit,
        amount: { amountMinor: Math.max(0, net), currency: event.currency },
        direction: net > 0 ? "credit" : "debit",
      },
    });
    comparison.signals.forEach((signal: any) => reasons.push(signal));
    const names = new Set(
      event.transactions
        .filter((tx: any) => tx.direction === "credit")
        .map((tx: any) => tx.counterparty.trim().toLowerCase()),
    );
    if (names.size > 1)
      add(
        "multiple_payers",
        "uncertain",
        "Payments name more than one payer; review the relationship to this event.",
      );
    if (event.transactions.some((tx: any) => tx.direction === "debit"))
      add(
        "linked_debits",
        "uncertain",
        "A linked debit reduces the net amount. Confirm whether it is a reversal, refund, or an unrelated expense.",
      );
    if (
      event.transactions.some(
        (tx: any) => tx.transactionDate < event.invoice.issuedDate,
      )
    )
      add(
        "individual_payment_timing",
        "uncertain",
        "At least one payment predates the invoice; review deposit terms.",
      );
    if (
      event.transactions.some(
        (tx: any) =>
          Date.parse(tx.transactionDate) -
            Date.parse(event.invoice.issuedDate) >
          90 * 86400000,
      )
    )
      add(
        "late_payment",
        "uncertain",
        "At least one payment is more than 90 days after the invoice; review the agreed payment terms.",
      );
    if (net < 0)
      add("negative_net", "mismatch", "Linked debits exceed linked credits.");
  }
  if (event.agreement && event.invoice) {
    if (!event.transactions.length) {
      if (event.agreement.amount.currency !== event.invoice.amount.currency)
        add(
          "agreement_invoice_currency",
          "mismatch",
          "Agreement and invoice currencies differ.",
        );
      else if (
        event.agreement.amount.amountMinor !== event.invoice.amount.amountMinor
      )
        add(
          "agreement_invoice_amount",
          "mismatch",
          "Agreement and invoice amounts differ.",
        );
    }
    if (
      event.invoice.service &&
      event.agreement.service.trim().toLowerCase() !==
        event.invoice.service.trim().toLowerCase()
    )
      add(
        "service_description",
        "uncertain",
        "Agreement and invoice describe the work differently; review scope and amendments.",
      );
  }
  if (event.agreement && event.agreement.counterparty !== event.counterparty)
    add(
      "event_agreement_party",
      "uncertain",
      "The agreement name differs from the event counterparty; confirm the relationship.",
    );
  const fulfillment = event.fulfillment;
  const supportingDelivery = event.evidence.some(
    (item: any) => item.kind === "fulfillment",
  );
  if (!fulfillment || fulfillment.status !== "completed")
    add(
      "fulfillment",
      "missing",
      "Completed work or delivery has not been recorded.",
    );
  else if (!supportingDelivery)
    add(
      "fulfillment_document",
      "missing",
      "Completion is declared, but no fulfillment evidence file has been attached.",
    );
  else
    add(
      "fulfillment",
      "match",
      "Completion is recorded with a supporting fulfillment file; its contents still require review.",
    );
  const currentAttestations = event.attestations.filter(
    (item: any) => item.revision === event.revision,
  );
  const attestation =
    currentAttestations.find((item: any) => item.status === "disputed") ??
    currentAttestations.find((item: any) => item.status === "confirmed");
  if (attestation?.status === "disputed")
    add(
      "attestation",
      "mismatch",
      "The invitation recipient disputed this event.",
    );
  else if (attestation?.status === "confirmed")
    add(
      "attestation",
      "match",
      "The holder of the event confirmation link confirmed this revision. Identity has not been independently verified.",
    );
  else
    add(
      "attestation",
      "missing",
      "Counterparty confirmation for this revision is pending or missing.",
    );
  const conflicts = reasons.filter((x) => x.status === "mismatch");
  const warnings = reasons.filter(
    (x) => x.status === "uncertain" || x.status === "missing",
  );
  const strong = conflicts.length === 0 && warnings.length === 0;
  const coverage = [
    !!event.agreement,
    !!event.invoice,
    event.transactions.length > 0,
    !!fulfillment && fulfillment.status === "completed" && supportingDelivery,
    attestation?.status === "confirmed",
  ].filter(Boolean).length;
  return {
    revision: event.revision,
    label: strong ? "Strong supporting record" : "Requires review",
    status: conflicts.length
      ? "conflict"
      : warnings.length
        ? "review_required"
        : "consistent",
    reasons,
    conflicts,
    warnings,
    coverage: { present: coverage, total: 5 },
    netPaymentMinor: currencyMismatch ? null : net,
    currency: event.currency,
    entityMatching:
      comparison?.signals.filter((x: any) => x.code.includes("counterparty")) ??
      [],
    summary: `${event.title}: ${coverage} of 5 evidence stages are present. ${currencyMismatch ? "Payments use different currencies." : `Net linked payment is ${(net / 100).toFixed(2)} ${event.currency}.`} ${conflicts.length} difference(s) and ${warnings.length} missing or uncertain item(s) require attention.`,
    confidenceExplanation:
      "This is a deterministic evidence coverage assessment, not a probability, credit score, or verification of document authenticity.",
    decisioning: { creditDecision: null, fraudLabel: null },
  };
}
