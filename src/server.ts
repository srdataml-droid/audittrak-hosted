import Fastify from "fastify";
import { PostgresDatabase } from "./mvp/postgres.js";
import { MvpDatabase } from "./mvp/db.js";
import { registerMvp } from "./mvp/routes.js";
import { readFile } from "node:fs/promises";
import { publicFile } from "./public-files.js";
import { EvidenceSchema, ReconcileRequestSchema } from "./model.js";
import { reconcile } from "./reconcile.js";
import { conflictDemoEvidence, demoEvidence } from "./demo-data.js";
import demoScenarios from "../data/five-scenarios.json" with { type: "json" };
import { InMemoryEvidenceStore } from "./store.js";
import {
  ExtractionRequestSchema,
  HttpDocumentExtractor,
  type DocumentExtractor,
} from "./extraction.js";
import { MonoTransactionsAdapter } from "./mono.js";

export function buildServer(
  options: {
    extractor?: DocumentExtractor;
    mono?: MonoTransactionsAdapter;
    database?: MvpDatabase | PostgresDatabase;
  } = {},
) {
  const app = Fastify({ logger: true, bodyLimit: 8_000_000 });
  const store = new InMemoryEvidenceStore();
  const extractor =
    options.extractor ??
    (process.env.DOCUMENT_EXTRACTION_URL
      ? new HttpDocumentExtractor(
          process.env.DOCUMENT_EXTRACTION_URL,
          process.env.DOCUMENT_EXTRACTION_API_KEY,
        )
      : undefined);
  const mono =
    options.mono ??
    (process.env.MONO_SECRET_KEY
      ? new MonoTransactionsAdapter(process.env.MONO_SECRET_KEY)
      : undefined);

  app.get("/health", async (request, reply) => {
    try {
      await database.one("SELECT 1 AS alive");
      return {
        status: "ok",
        service: "audittrak-evidence-service",
        database: "connected",
      };
    } catch (error) {
      request.log.error(error);
      const code = (error as { code?: unknown }).code;
      return reply
        .code(503)
        .send({
          status: "unavailable",
          database: "unavailable",
          code:
            typeof code === "string" && /^[A-Z0-9_]+$/.test(code)
              ? code
              : /timeout|timed out/i.test(String((error as Error).message))
                ? "CONNECTION_TIMEOUT"
                : /terminated|closed/i.test(String((error as Error).message))
                  ? "CONNECTION_CLOSED"
                  : "DATABASE_UNAVAILABLE",
        });
    }
  });

  app.get("/assets/audittrak-five-apps.png", async (_request, reply) => {
    const image = await readFile(publicFile("audittrak-five-apps.png"));
    return reply.type("image/png").send(image);
  });

  app.get("/api/demo/scenarios", async () =>
    demoScenarios.map((scenario) => {
      const request = ReconcileRequestSchema.parse(
        scenario.reconciliationRequest,
      );
      return { ...scenario, actualResult: reconcile(request) };
    }),
  );

  app.get("/prototype", async (_request, reply) => {
    const escapeHtml = (value: unknown) =>
      String(value).replace(
        /[&<>"']/g,
        (char) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[char]!,
      );
    const formatMoney = (minor: number, currency = "NGN") =>
      `${currency} ${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(minor / 100)}`;
    const summarizeRecord = (
      record: Record<string, any>,
      sourceKey: string,
    ) => {
      if (typeof record.text === "string") return record.text;
      if (sourceKey === "agreement")
        return `${record.file ?? "Agreement"} · ${formatMoney(record.feeMinor ?? 0)}`;
      if (sourceKey === "invoice")
        return `${record.invoiceNumber ?? "Invoice"} · ${formatMoney(record.totalMinor ?? 0)}`;
      if (sourceKey === "bank")
        return (record.lines ?? [])
          .map(
            (line: Record<string, any>) =>
              `${line.direction} ${formatMoney(line.amountMinor, line.currency)} · ${line.name}`,
          )
          .join("; ");
      return record.summary ?? "Review the source record.";
    };
    const scenarioCards = demoScenarios
      .map((scenario, index) => {
        const records = Object.entries(
          scenario.appRecords as unknown as Record<string, Record<string, any>>,
        )
          .map(
            ([key, record]) =>
              `<li><strong>${escapeHtml(record.app)}</strong><span>${escapeHtml(summarizeRecord(record, key))}</span></li>`,
          )
          .join("");
        const messages = (scenario.appRecords as any).chat.messages
          .map(
            (message: { speaker: string; text: string }) =>
              `<div class="bubble"><strong>${escapeHtml(message.speaker)}</strong><span>${escapeHtml(message.text)}</span></div>`,
          )
          .join("");
        return `<article class="case"><span class="tag">${escapeHtml(scenario.channel)} · Example ${index + 1}</span><h3>${escapeHtml(scenario.title)}</h3><p><strong>${escapeHtml(scenario.customer)}:</strong> ${escapeHtml(scenario.service)}</p><p>${escapeHtml(scenario.story)}</p><p><strong>Evidence route:</strong> ${escapeHtml(scenario.channelExplanation)}</p><details><summary>Read their pretend conversation</summary><div class="conversation">${messages}</div></details><details><summary>See the source records</summary><ol>${records}</ol></details><p class="outcome">${escapeHtml(scenario.prototypeExpectation)}</p><button class="check-case" data-scenario="${escapeHtml(scenario.id)}">Check this job</button><p class="muted"><strong>Current limitation:</strong> ${escapeHtml(scenario.limitation)}</p></article>`;
      })
      .join("");
    return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AuditTrak Demo</title>
<style>
  :root{font-family:system-ui,sans-serif;color:#18212f;background:#f4f6fa}body{max-width:1080px;margin:38px auto;padding:0 20px}h1{font-size:2rem;margin-bottom:8px}.sub{color:#586579;margin-top:0;font-size:1.08rem;line-height:1.55}.how{background:#eaf0fa;border-radius:12px;padding:16px 20px;line-height:1.6}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}button{border:0;border-radius:9px;padding:13px 18px;background:#174ea6;color:white;font-size:1rem;font-weight:650;cursor:pointer}button.secondary{background:#e2e9f4;color:#1a2a44}button:disabled{opacity:.55;cursor:wait}.card{background:white;border:1px solid #dce2ec;border-radius:12px;padding:20px;margin:16px 0;box-shadow:0 2px 8px #17223b0a}.status{font-size:1.18rem;font-weight:700}.status.consistent{color:#087443}.status.review_required{color:#9a6200}.status.conflict{color:#b42318}ul,ol{padding-left:22px}.signal{padding:12px 0;border-top:1px solid #edf0f5;line-height:1.5}.muted{color:#637084;font-size:.94rem}.what{margin-top:18px;padding:14px;background:#f6f8fb;border-radius:9px;line-height:1.55}.sources{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.source,.case{background:#fff;border:1px solid #dce2ec;border-radius:12px;padding:14px}.source strong,.case strong{display:block;margin-bottom:5px}.source span,.case p,.case li span{color:#566276;font-size:.92rem;line-height:1.5;margin:4px 0}.flow{padding:13px;background:#eaf0fa;border-radius:10px;text-align:center;line-height:1.7;font-weight:600}.cases{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.case .outcome{color:#174ea6;font-weight:650}.tag{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#52627a}.note{margin:14px 0;padding:13px;border-left:4px solid #e0a72e;background:#fff8e8;color:#55441c;line-height:1.5}.case li{margin:8px 0}.case li span{display:block}.case h3{margin:5px 0 8px}summary{cursor:pointer;color:#174ea6;font-weight:650}.conversation{display:grid;gap:8px;margin:12px 0}.bubble{padding:10px 12px;background:#f3f6fb;border-radius:10px;line-height:1.45}.bubble span{display:block;color:#45536a}.check-case{padding:10px 14px}.review-results{margin:16px 0}.review-results h2{margin-bottom:8px}.review-results .signal{background:#fff;padding:12px;border-radius:8px;margin:6px 0}.entry-form{background:white;border:1px solid #dce2ec;border-radius:12px;padding:20px;margin:18px 0}.entry-form fieldset{border:1px solid #dce2ec;border-radius:10px;margin:14px 0;padding:14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.entry-form legend{font-weight:700;padding:0 6px}.entry-form label{display:grid;gap:5px;font-weight:600}.entry-form input,.entry-form select{box-sizing:border-box;width:100%;padding:11px;border:1px solid #aeb9ca;border-radius:8px;font:inherit}.entry-form small{font-weight:400;color:#637084;line-height:1.35}.entry-form .form-submit{margin-top:8px}@media(max-width:680px){.sources{grid-template-columns:repeat(2,1fr)}.cases{grid-template-columns:1fr}.entry-form fieldset{grid-template-columns:1fr}body{margin:24px auto}}
</style></head><body>
<h1>Let’s check if these records tell the same story</h1><p class="sub">A business deal can leave three records: what was agreed, what was invoiced, and what money arrived. This demo checks whether those records line up.</p>
<figure><img src="/assets/audittrak-five-apps.png" alt="Illustrative evidence path across conversation, agreement, invoice and payment" style="width:100%;height:auto;border-radius:14px;border:1px solid #dce2ec"><figcaption class="muted">An earlier illustration of an evidence path. The five separate jobs below contain the current synthetic records; no customer accounts are connected.</figcaption></figure>
<div class="how"><strong>Try one job:</strong> Open its conversation, then press “Check this job.” The demo compares its agreement, invoice, and payment records.</div>
<div id="result" class="card review-results"><p class="muted">Choose any job below to see how the check works.</p></div>
<h2>Try your own example</h2>
<p class="sub">Enter made-up details or use a simple example. “Agreement” is what you agreed. “Invoice” is what you billed. “Payment” is what actually arrived.</p>
<form id="evidence-form" class="entry-form">
  <fieldset><legend>1. What did you agree?</legend>
    <label>Customer name<input name="customer" required value="Amina Okafor"><small>The name written in the agreement or deal.</small></label>
    <label>What work was promised?<input name="service" required value="Logo design"><small>For example: logo design, website build, or bookkeeping.</small></label>
    <label>Agreed price in naira<input name="agreedAmount" type="number" min="0.01" step="0.01" required value="250000"><small>Use naira, like 250000 for ₦250,000.</small></label>
  </fieldset>
  <fieldset><legend>2. What did the invoice say?</legend>
    <label>Invoice number<input name="invoiceNumber" required value="INV-101"><small>A label used to find the bill.</small></label>
    <label>Invoice amount in naira<input name="invoiceAmount" type="number" min="0.01" step="0.01" required value="250000"><small>This can differ from the agreed price; the checker will point that out.</small></label>
    <label>Invoice date<input name="invoiceDate" type="date" required><small>When the bill was sent.</small></label>
  </fieldset>
  <fieldset><legend>3. What payment arrived?</legend>
    <label>Name shown on payment<input name="payer" required value="AMINA OKAFOR"><small>This may be the client, a company, or another payer.</small></label>
    <label>Amount received in naira<input name="paymentAmount" type="number" min="0" step="0.01" required value="250000"><small>Enter 0 if nothing has arrived yet.</small></label>
    <label>Payment date<input name="paymentDate" type="date" required><small>When the bank or payment app shows it.</small></label>
    <label>Did money enter or leave?<select name="direction"><option value="credit">Enter — money came in</option><option value="debit">Leave — money went out or was reversed</option></select></label>
  </fieldset>
  <button class="form-submit" type="submit">Compare my records</button>
  <p class="muted">This demo uses the details only in memory while it is running. Use fictional data; it is not connected to your real accounts.</p>
</form>
<h2>Five real app connection targets</h2>
<p class="sub">These are separate services we can build against. “API available” does not mean your account is connected; each still needs its own setup and permission.</p>
<div class="sources">
  <div class="source"><strong>💬 WhatsApp Business Cloud</strong><span>Real Meta API; requires a Business account, test number or approved number, and webhook setup. It cannot read personal WhatsApp history.</span></div>
  <div class="source"><strong>📁 Google Drive</strong><span>Real API; reads agreement files after Google OAuth consent and selected file permissions.</span></div>
  <div class="source"><strong>🧾 Zoho Books</strong><span>Real API; invoice access needs a Zoho OAuth app and the account owner’s authorization.</span></div>
  <div class="source"><strong>🏦 Mono</strong><span>Real bank-data API with a sandbox; adapter is in this demo, but a test key and consented account ID are needed.</span></div>
  <div class="source"><strong>💳 Stripe test mode</strong><span>Real test API; can provide simulated payment records with a Stripe test key. No real money moves in test mode.</span></div>
</div>
<div class="flow">Five different customers and jobs<br>↓<br>Agreement + invoice + payment evidence<br>↓<br>AuditTrak compares the records and points out what needs a person to check</div>
<div class="note"><strong>Connection status:</strong> only the Mono transaction adapter is implemented so far. It needs a Mono sandbox key and a user-consented account ID. WhatsApp, Drive, Zoho, and Stripe are real API targets, but this project does not yet contain their connector code or your account setup.</div>
<h2>Two ways freelancers work</h2>
<p class="sub">Marketplace clients usually keep the job conversation and payment inside the marketplace. Direct clients may use chat or email, a separate invoice, and a bank or payment app. These are examples, not a claim that every freelancer uses these tools.</p>
<div class="flow">Marketplace job: platform messages → platform contract or milestones → platform payment record<br><br>Direct client: email or chat → agreement file → invoice app → bank or payment record</div>
<h2>Five made-up jobs with messy records</h2>
<p class="sub">Three marketplace examples and two direct-client examples. Open the pretend conversation, inspect the records, then check that job.</p>
<div class="cases">${scenarioCards}</div>
<p class="muted">All names and transactions are fictional. The screen artwork and source records are examples, not imports from those companies. Only the Mono API adapter exists in code today; it is not connected until credentials and consent are configured.</p>
<p><a href="/api/demo/scenarios">View the fake scenario data (JSON)</a></p>
<script>
const result=document.querySelector('#result');
const labels={currency_consistency:'Do all three use the same currency?',agreement_invoice_amount:'Does the invoice charge what the agreement says?',invoice_payment_amount:'Does the payment cover the invoice amount?',agreement_payment_amount:'Does the payment match the agreed amount?',agreement_invoice_counterparty:'Does the agreement name the same customer as the invoice?',invoice_payment_counterparty:'Does the payment appear to come from the invoiced customer?',reference_consistency:'Do the records share a reference number?',invoice_payment_timing:'Did the payment happen after the invoice?',payment_direction:'Did money come into the account?'};
function explain(status){if(status==='match')return 'Yes, these details line up.';if(status==='mismatch')return 'No, these details differ. Someone should check why.';if(status==='uncertain')return 'The system can’t tell for sure from these records. A person should check.';return 'This detail is missing.'}
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
async function run(scenarioId){document.querySelectorAll('.check-case').forEach(b=>b.disabled=true);result.innerHTML='<p>Checking this job…</p>';try{const response=await fetch('/api/demo/scenarios/'+encodeURIComponent(scenarioId)+'/reconcile',{method:'POST'});if(!response.ok)throw new Error('The example could not be loaded ('+response.status+').');const data=await response.json();const r=data.result;const good=r.status==='consistent';result.innerHTML='<h2>'+escapeHtml(data.scenario.customer)+' · '+escapeHtml(data.scenario.service)+'</h2><div class="status '+r.status+'">'+(good?'These records line up':r.status==='conflict'?'There is a difference to check':'A person should review this')+'</div><p>'+escapeHtml(r.reviewerSummary)+'</p><div class="what"><strong>Evidence confidence: '+Math.round(r.evidenceConfidence*100)+'%</strong><br>This is demo metadata. Manually entered records default to 100%; that does not mean the information was independently verified.</div><h2>What the system checked</h2>'+r.signals.map(s=>'<div class="signal"><strong>'+escapeHtml(labels[s.code]||s.code)+'</strong><br>'+escapeHtml(explain(s.status))+'<div class="muted">'+escapeHtml(s.message)+'</div></div>').join('')+(r.warnings.length?'<h3>Needs a person to check</h3><ul>'+r.warnings.map(w=>'<li>'+escapeHtml(w)+'</li>').join('')+'</ul>':'')+(r.conflicts.length?'<h3>Differences found</h3><ul>'+r.conflicts.map(c=>'<li>'+escapeHtml(c)+'</li>').join('')+'</ul>':'')+'<p class="muted">This comparison doesn’t decide credit or label anyone as fraudulent.</p>';result.scrollIntoView({behavior:'smooth',block:'start'});}catch(e){result.innerHTML='<p class="status conflict">Could not load the demo</p><p>'+escapeHtml(e.message)+'</p>'}finally{document.querySelectorAll('.check-case').forEach(b=>b.disabled=false)}}
document.querySelectorAll('.check-case').forEach(button=>button.addEventListener('click',()=>run(button.dataset.scenario)));
const today=new Date().toISOString().slice(0,10);document.querySelector('[name="invoiceDate"]').value=today;document.querySelector('[name="paymentDate"]').value=today;
document.querySelector('#evidence-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const submit=form.querySelector('button[type="submit"]');submit.disabled=true;result.innerHTML='<p>Comparing the three records…</p>';try{const values=Object.fromEntries(new FormData(form).entries());const toMinor=name=>Math.round(Number(values[name])*100);const eventId='manual_'+Date.now();const payload={eventId,agreement:{id:eventId+'_agreement',kind:'agreement',source:'user',counterparty:values.customer,service:values.service,amount:{amountMinor:toMinor('agreedAmount'),currency:'NGN'}},invoice:{id:eventId+'_invoice',kind:'invoice',source:'user',invoiceNumber:values.invoiceNumber,counterparty:values.customer,service:values.service,amount:{amountMinor:toMinor('invoiceAmount'),currency:'NGN'},issuedDate:values.invoiceDate},payment:{id:eventId+'_payment',kind:'payment',source:'user',transactionId:eventId+'_payment',direction:values.direction,counterparty:values.payer,description:values.service+' payment',amount:{amountMinor:toMinor('paymentAmount'),currency:'NGN'},transactionDate:values.paymentDate}};const response=await fetch('/api/reconcile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw new Error(data.error||'The records could not be checked.');const r=data.result;const good=r.status==='consistent';result.innerHTML='<h2>Your example · '+escapeHtml(values.service)+'</h2><div class="status '+r.status+'">'+(good?'These records line up':r.status==='conflict'?'There is a difference to check':'A person should review this')+'</div><p>'+escapeHtml(r.reviewerSummary)+'</p><div class="what"><strong>Evidence confidence: '+Math.round(r.evidenceConfidence*100)+'%</strong><br>This is demo metadata. Manually entered records default to 100%; that does not mean the information was independently verified.</div><h2>What the system checked</h2>'+r.signals.map(signal=>'<div class="signal"><strong>'+escapeHtml(labels[signal.code]||signal.code)+'</strong><br>'+escapeHtml(explain(signal.status))+'<div class="muted">'+escapeHtml(signal.message)+'</div></div>').join('')+(r.warnings.length?'<h3>Needs a person to check</h3><ul>'+r.warnings.map(w=>'<li>'+escapeHtml(w)+'</li>').join('')+'</ul>':'')+(r.conflicts.length?'<h3>Differences found</h3><ul>'+r.conflicts.map(c=>'<li>'+escapeHtml(c)+'</li>').join('')+'</ul>':'')+'<p class="muted">The checker compares evidence only. It does not make a credit decision or label anyone fraudulent.</p>';result.scrollIntoView({behavior:'smooth',block:'start'});}catch(error){result.innerHTML='<p class="status conflict">Could not check those records</p><p>'+escapeHtml(error.message)+'</p>'}finally{submit.disabled=false}});
</script></body></html>`);
  });

  app.post("/api/reconcile", async (request, reply) => {
    const parsed = ReconcileRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "Invalid reconciliation request",
        issues: parsed.error.issues,
      });
    const result = reconcile(parsed.data);
    const eventId = result.eventId;
    const event = store.save({
      id: eventId,
      evidence: [
        parsed.data.agreement,
        parsed.data.invoice,
        parsed.data.payment,
      ],
      reconciliation: result,
      createdAt: new Date().toISOString(),
    });
    return { event, result };
  });

  app.get<{ Params: { eventId: string } }>(
    "/api/events/:eventId",
    async (request, reply) => {
      const event = store.get(request.params.eventId);
      return event
        ? { event }
        : reply.code(404).send({ error: "Event not found" });
    },
  );

  app.post<{ Querystring: { scenario?: string } }>(
    "/api/demo/reconcile",
    async (request) => {
      const evidence =
        request.query.scenario === "conflict"
          ? conflictDemoEvidence
          : demoEvidence;
      const result = reconcile({
        ...evidence,
        eventId: `evt_${request.query.scenario === "conflict" ? "conflict" : "demo"}_001`,
        amountToleranceMinor: 0,
        timingWindowDays: 90,
      });
      const event = store.save({
        id: result.eventId,
        evidence: [evidence.agreement, evidence.invoice, evidence.payment],
        reconciliation: result,
        createdAt: new Date().toISOString(),
      });
      return { event, result };
    },
  );

  app.post<{ Params: { scenarioId: string } }>(
    "/api/demo/scenarios/:scenarioId/reconcile",
    async (request, reply) => {
      const scenario = demoScenarios.find(
        (item) => item.id === request.params.scenarioId,
      );
      if (!scenario)
        return reply.code(404).send({ error: "Demo scenario not found" });
      const parsed = ReconcileRequestSchema.safeParse(
        scenario.reconciliationRequest,
      );
      if (!parsed.success)
        return reply
          .code(500)
          .send({ error: "Demo scenario evidence is invalid" });
      const result = reconcile(parsed.data);
      const event = store.save({
        id: result.eventId,
        evidence: [
          parsed.data.agreement,
          parsed.data.invoice,
          parsed.data.payment,
        ],
        reconciliation: result,
        createdAt: new Date().toISOString(),
      });
      return {
        scenario: {
          id: scenario.id,
          customer: scenario.customer,
          service: scenario.service,
          channel: scenario.channel,
          title: scenario.title,
        },
        event,
        result,
      };
    },
  );

  app.post("/api/evidence/validate", async (request, reply) => {
    const parsed = EvidenceSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "Invalid evidence record",
        issues: parsed.error.issues,
      });
    return { evidence: parsed.data };
  });

  app.post<{
    Params: { accountId: string };
    Querystring: { start?: string; end?: string };
  }>(
    "/api/providers/mono/accounts/:accountId/transactions",
    async (request, reply) => {
      if (!mono)
        return reply.code(503).send({
          error: "Mono is not configured",
          hint: "Set MONO_SECRET_KEY to a Mono sandbox or production secret key.",
        });
      if (
        !process.env.PROVIDER_ACCESS_TOKEN ||
        request.headers.authorization !==
          `Bearer ${process.env.PROVIDER_ACCESS_TOKEN}`
      )
        return reply.code(403).send({
          error:
            "Provider access requires the server operator token. Use the authenticated workspace import.",
        });
      try {
        const transactions = await mono.listTransactions(
          request.params.accountId,
          request.query,
        );
        return { source: "mono", transactions };
      } catch (error) {
        request.log.error(error);
        return reply
          .code(502)
          .send({ error: "Mono transactions request failed" });
      }
    },
  );

  app.post("/api/documents/extract", async (request, reply) => {
    const parsed = ExtractionRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "Invalid extraction request",
        issues: parsed.error.issues,
      });
    if (!extractor)
      return reply.code(503).send({
        error: "Document extraction provider is not configured",
        hint: "Set DOCUMENT_EXTRACTION_URL to your AI extraction service. Extracted values must be reviewed before reconciliation.",
      });
    if (
      !process.env.PROVIDER_ACCESS_TOKEN ||
      request.headers.authorization !==
        `Bearer ${process.env.PROVIDER_ACCESS_TOKEN}`
    )
      return reply
        .code(403)
        .send({ error: "Use the authenticated event extraction endpoint." });
    try {
      return await extractor.extract(parsed.data);
    } catch (error) {
      request.log.error(error);
      return reply
        .code(502)
        .send({ error: "Document extraction provider failed" });
    }
  });

  const database =
    options.database ??
    (process.env.DATABASE_URL
      ? new PostgresDatabase(process.env.DATABASE_URL)
      : new MvpDatabase(
          process.env.NODE_ENV === "test" ? ":memory:" : undefined,
        ));
  registerMvp(app, database, extractor, mono);
  app.addHook("onClose", async () => {
    await database.db.close();
  });
  return app;
}

if (
  process.env.NODE_ENV !== "test" &&
  process.env.AUDITTRAK_SERVERLESS !== "true"
) {
  const app = buildServer();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
}
