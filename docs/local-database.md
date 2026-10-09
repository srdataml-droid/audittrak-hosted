# AuditTrak local database

Updated 9 October 2026

## Plain-language overview

The local app uses SQLite, a small database saved as a file on this computer. AuditTrak reads and writes that file while the app is running. The default location is `data/audittrak.sqlite`. `AUDITTRAK_DATABASE` can point the app to a different file. The app creates the folder and database tables automatically the first time it starts.

This database is separate from GitHub. The repository ignores SQLite database files, so pushing code does not upload user accounts, jobs, payments, or uploaded documents. The fictional examples in `data/five-scenarios.json` are separate sample data, not the contents of the local database.

## What the database stores

| Information | How AuditTrak uses it |
| --- | --- |
| User accounts | Name, email, role, creation time, and a protected password hash |
| Business profile | Business name, sector, and description, linked to its account |
| Sign-in sessions | A hash of the session token and its expiry time |
| Jobs and counterparties | The business, client or other party, service, currency, channel, status, and timestamps |
| Agreement and invoice | Structured details saved with the job |
| Payments | One or more transaction records linked to the job and business |
| Delivery and confirmation | Fulfillment details and client confirmation requests/responses |
| Evidence files | File name, type, upload time, and file bytes stored inside SQLite |
| Reconciliation | Saved assessment details, rule findings, and the job revision assessed |
| Reviewer notes | Review notes attached to submitted jobs |
| Activity history | Application events such as account creation, job changes, uploads, and assessments |
| Optional proposals and sample story | Document extraction suggestions and example-specific data, when those features are used |

Some records store structured fields as JSON text in SQLite. Money values are kept in integer minor units, such as kobo, and currencies are not converted or combined.

## How saving and access work

- The server uses Node.js's built-in SQLite library and opens the database when it starts.
- Foreign-key checks are enabled. Related job records are deleted when a job is deleted. The app writes related changes together in a database transaction, so a multi-step save either completes or rolls back.
- The database uses SQLite's write-ahead logging mode and has indexes for finding events and activity by business.
- Passwords are not saved as readable text. The app uses a random salt and the scrypt password-hashing function.
- The browser receives a random session token in an HttpOnly, SameSite cookie. The database stores a hash of that token, and the session expires after seven days. Secure cookies are enabled when `COOKIE_SECURE=true`.
- Business routes check that the signed-in user's business owns the requested job. Reviewer accounts can see submitted jobs; the current implementation does not yet require a separate grant for each reviewer and job.
- Uploaded evidence is stored as file bytes in the database, with a 5 MB per-file limit and a small allowlist of file types.
- Sign-in throttling is held in the running server's memory, so it resets when the server restarts. It is not yet a shared, production rate limit.

## What is not included yet

- The database file is not encrypted by the app. Protect the computer and its disk using operating-system account and disk protections.
- There is no automatic backup or tested restore process configured for this local database.
- Email verification, password reset, and account deletion/export are not implemented.
- Database schema setup uses `CREATE TABLE IF NOT EXISTS` at startup. A versioned database migration process has not been added.
- Uploaded files are not malware-scanned. A stored file is evidence supplied by a user, not proof that the file is genuine.
- The app is configured to listen on this computer by default. This SQLite setup is for local use; it is not a durable shared database for an online multi-user service.

## Table names in the current schema

`users`, `businesses`, `sessions`, `counterparties`, `commercial_events`, `agreements`, `invoices`, `transactions`, `fulfillments`, `attestations`, `evidence_items`, `evidence_assessments`, `consistency_flags`, `commercial_activity_profiles`, `institutional_reviews`, `audit_logs`, `demo_stories`, and `extraction_proposals`.

## Before hosting online

The planned hosted version should move the main records to managed PostgreSQL and store uploaded files in private object storage. It also needs versioned migrations, email verification and recovery, specific reviewer grants, shared rate limits, encrypted backups, restore checks, retention/deletion controls, and a security review. Do not use the local file or GitHub to host real financial records.

## Related documentation

- [MVP online plan](../U-plan.md)
- [What remains before the MVP pilot](whats-left.md)
- [System design](system-design.md)
