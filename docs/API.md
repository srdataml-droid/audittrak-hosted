# API reference

All workspace routes begin `/api/v1`. Login/signup set an HttpOnly SameSite=Strict cookie. Mutating requests with an Origin must match the request host. Cookie sessions last 7 days. Business users see their own jobs; reviewers see explicitly shared jobs only.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /auth/signup | name, email, password (12+ characters), businessName |
| POST | /auth/login | email, password |
| GET / POST | /auth/me, /auth/logout | Current user / end session |
| GET / PUT | /business | Read/update name, sector, description |
| GET | /counterparties | Business counterparties |
| GET / POST | /events | List/create jobs |
| GET / PATCH / DELETE | /events/:id | Read/update/delete owned job |
| PUT | /events/:id/agreement | Save AgreementSchema record |
| PUT | /events/:id/invoice | Save InvoiceSchema record |
| POST | /events/:id/transactions | Link PaymentSchema record |
| DELETE | /events/:id/transactions/:transactionId | Unlink payment |
| PUT | /events/:id/fulfillment | status, description, completedDate when completed |
| POST | /events/:id/evidence | kind, name, mime, base64 (5 MB decoded max) |
| GET | /events/:id/evidence/:itemId | Download attached evidence |
| POST | /events/:id/attestations | Create link for current revision; share manually |
| GET / POST | /attest/:token | Public recipient view/response; name, status, comment |
| POST | /events/:id/assessment | Save deterministic assessment |
| POST | /events/:id/submit | Share current assessed revision with reviewers |
| POST | /events/:id/unshare | Revoke sharing |
| POST | /events/:id/reviews | Reviewer note on shared event |
| GET | /profile | Commercial activity totals by currency |
| GET | /audit | Latest 200 business actions |
| POST | /events/:id/mono-import | transactionIds from operator-bound consented account |
| POST | /events/:id/extraction | documentId, documentKind, documentText; proposal only |
| POST | /demo/seed | Add five fictional jobs to an empty business |

Event creation/update: `title`, `service`, `counterparty`, optional `counterpartyEmail`, `currency` (uppercase three letters), `channel` (`direct` or `marketplace`). PATCH expects the complete event-details object.

Structured evidence contracts are in `src/model.ts`. Each record has `id`, `kind`, `source`, and `amount: {amountMinor,currency}`. Agreements add counterparty/service, optional effectiveDate/dueDate/reference. Invoices add invoiceNumber/counterparty/issuedDate. Payments add transactionId/direction/counterparty/transactionDate, optional reference. Dates are YYYY-MM-DD. Manually saved v1 agreement/invoice/payment records are marked source `user` by the server; client-supplied provenance cannot claim a bank import.

Responses include current records, evidenceGraph nodes/edges, confirmation history, reviewer notes and the latest assessment with a stale indicator. Evidence edits increment revision and withdraw sharing; a confirmation response also invalidates the previous assessment.

Extraction provider response: documentId, documentKind, status `proposed_for_review`, fields mapping field name to `{value,confidence,supportingText}`, guardrails `{deterministicReconciliationUnaffected:true,reviewerConfirmationRequired:true}`. It never writes canonical evidence. Provider failures must not create fallback evidence.

Mono import uses the business ID returned by `/auth/me` to find an operator-set binding. No caller-supplied bank account ID is accepted by this endpoint. Imports are atomic; duplicates reject the request. A real consent flow and sandbox credentials are external setup requirements.
