# AuditTrak: what is left for the MVP

> Hosting update, 9 October 2026: this version now includes the Vercel Function and PostgreSQL backend. See [DEPLOY-TO-VERCEL.md](DEPLOY-TO-VERCEL.md) for current deployment instructions and verification limits. Earlier hosting tasks below describe the previous local-only version. A live deployment remains pending.
Updated 9 October 2026

## Current state

AuditTrak is a working local MVP. It has a public landing page and sign-up/sign-in screens, a signed-in workspace for recording a business event and its evidence, deterministic reconciliation results, evidence uploads, and reviewer-facing flows. Accounts and records currently save to a local SQLite file. The app is not hosted online.

Current protections include scrypt password hashes, random session tokens stored as hashes, HttpOnly and SameSite cookies, and business ownership checks. The app does not yet have email verification, password recovery, account deletion/export, or a production-grade shared rate limiter. Reviewer access needs explicit, per-job grants before external pilot use. Upload scanning, retention, encrypted backup and recovery procedures also remain.

The local sample route is separate from the saved workspace. It is not a real account or a durable data source. No bank connection or AI extraction provider is active by default.

## Before we put the app online

1. Choose and confirm the Vercel team/account and billing plan. Vercel's Hobby plan is for personal, non-commercial use. Check current terms and expected usage before choosing a plan.
2. Adapt the current Fastify API to Vercel's Node.js function model, or select a compatible deployment shape. The existing server starts one long-running process, so it cannot be assumed to work unchanged as a Vercel function.
3. Replace `node:sqlite` as the online source of truth with managed PostgreSQL. Vercel functions have a read-only filesystem with temporary `/tmp` space, so SQLite files written there would not be durable across invocations.
4. Move uploaded documents out of database BLOBs to private object storage. Add file size/type checks and malware scanning. Vercel Function request and response bodies have a 4.5 MB limit, so larger files should upload directly to private storage using short-lived authorized upload URLs.
5. Create separate preview and production environments. Keep credentials in provider environment settings. Never commit `.env` files, database credentials, session secrets, uploaded customer files, or the local SQLite database.
6. Set production cookies to Secure, keep HttpOnly and SameSite protections, and review trusted proxy/session behavior over HTTPS.

## Before a limited real-user pilot

- Email verification, password reset, email-change confirmation, and session revocation.
- Business-only data access on every route. Reviewers see a job only after an explicit, revocable, time-limited grant.
- Shared sign-in and sensitive-action rate limits, monitoring, alerting, and an incident contact process.
- Data export, account deletion, a plain-language privacy notice, and a retention schedule for evidence.
- Private file delivery, malware scanning, encrypted database backups, and a restore rehearsal.
- Database migrations, deployment rollback, and operational ownership for the database and email provider.
- A review of the security controls before receiving genuine financial or client documents.

Use synthetic records while these are unfinished. Keep bank import disabled until a user-consented provider flow exists. Email verification proves inbox access; it does not provide multi-factor authentication. Do not turn reconciliation outputs into credit decisions, fraud labels, or automated judgments.

## After the first pilot

Add a consent-based bank data connection, starting with one provider. Add optional document extraction as a separate proposal step that cites the source document and waits for a human to confirm fields. Consider passkeys or authenticator MFA before enabling higher-risk account actions. Expand integrations only after users validate the need.

## How we will know the MVP is ready

- A new user can verify an email, sign in, create a business event, enter agreement/invoice/payment details, and find those records after signing out and back in.
- Businesses cannot read one another's events or files. A reviewer receives access only through a visible grant that the business can revoke.
- A file is private by default, size/type-checked, scanned, and served only after authorization.
- Reconciliation shows matches, mismatches, missing evidence, source references, and confidence with a human-readable explanation. Rules remain deterministic.
- Account recovery, export, deletion, retention, backup, and restore behavior are documented and work as intended.
- The preview and production deployment use separate secrets and data stores. Production has HTTPS, monitoring, a rollback path, and no seeded accounts or fictional sample records mixed with real records.

## Sources for the Vercel hosting assumptions

- [Vercel Functions runtimes and filesystem behavior](https://vercel.com/docs/functions/runtimes)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Postgres through Vercel Marketplace](https://vercel.com/docs/marketplace-storage)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
