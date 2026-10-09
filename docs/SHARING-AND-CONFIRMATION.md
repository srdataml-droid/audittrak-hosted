# Commercial Evidence sharing and client confirmation

Each work record is Commercial Evidence. The account view is Commercial Evidence Pack. Existing records remain intact.

## Sharing

From one record, create an evidence link and copy it. From the pack view, select up to 20 records and create a pack link. Recipients need no account. The public page includes the selected records, agreements, invoices, entered payments or uploaded receipts, delivery evidence, assessment and client verdicts. Amount totals cover only selected entered payments, separated by currency. Uploaded receipts without entered amounts are excluded from totals.

Links expire after 7, 30 or 90 days and can be revoked from Manage existing links. Each link captures the evidence version at creation. Later edits require a new link. Removing a record or document makes that content unavailable. Anyone holding a link can open it; treat it as access to the selected evidence. Only token hashes are stored, so an old link cannot be recovered from the dashboard after leaving the page; copy it when creating it or create another.

## Client confirmation

Create a confirmation link within the record and copy it. Clients can open the evidence documents without an account, confirm or dispute the evidence and optionally supply a review, name, email or phone. Email and phone are private to the owner. A client must opt in before their name and review appear in future shared evidence. Verdict status is included without optional identifying details.

An invitation expires after 14 days and accepts one response. Evidence changes invalidate it. Responses stay tied to the version reviewed and remain visible in the owner's record. Refresh responses to see new submissions. Link possession is not identity verification.

## Email setup

The response and an email notification to the owner's signup address are stored in the same database transaction. Email failure does not lose the response. Delivery status is visible within Client confirmation and the pack notification section.

Set RESEND_API_KEY and NOTIFICATION_FROM_EMAIL in Vercel production environment variables. The sender must be permitted by the Resend account; use a verified sender domain for production. Set APP_BASE_URL to the deployed application URL if it differs from https://audittrak-hosted.vercel.app. Redeploy after setting variables. Never commit API keys.

While these variables are absent, notifications remain marked waiting for setup. Once configured, new responses attempt delivery immediately; Retry pending notifications processes older unsent messages in batches of five. Failed deliveries permit up to five attempts. Provider idempotency keys reduce duplicate delivery when recovering an interrupted send. There is no scheduled background retry in this release.

## Database and verification

Three additive tables store share snapshots, confirmation details and email outbox entries. Both SQLite and PostgreSQL initialize them automatically. Existing sessions, evidence and confirmations remain usable. Legacy confirmations fall back to their current record when no captured snapshot exists, provided the evidence revision still matches.

Tests cover selected-record isolation, public document access boundaries, snapshot stability, revocation, duplicate responses, optional-contact privacy, notification failure/retry and PostgreSQL persistence. The native Vercel handler is exercised over HTTP for anonymous review, document download and submission.

Uploaded document contents are not automatically read in this release. Evidence assessments remain based on supplied records and coverage; no lending decision is made.
