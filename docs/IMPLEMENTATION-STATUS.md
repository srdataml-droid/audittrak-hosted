# MVP delivery status

> Hosting update, 9 October 2026: this version now includes the Vercel Function and PostgreSQL backend. See [DEPLOY-TO-VERCEL.md](DEPLOY-TO-VERCEL.md) for current deployment instructions and verification limits. Earlier hosting tasks below describe the previous local-only version. A live deployment remains pending.
## Working locally

Business sign-up/login/logout and profile; event creation/edit/deletion; counterparties; saved agreement, invoice, multiple payments, fulfillment and attached files; revision-bound confirmation; deterministic assessments; owner-controlled sharing and reviewer notes; evidence graph/timeline; commercial activity profile; audit history; five fictional stories and illustrations.

## Implemented boundaries requiring setup

Mono transaction adapter and authenticated event import: credentials, external consent flow and operator-bound account required. AI extraction HTTP bridge: configured provider, attached source document and manual review required. Neither was exercised against a live provider account.

## Deliberately outside this local MVP

Credit decisioning, fraud labeling, document authenticity certification, trained ML model, built-in OCR and automatic personal-chat scraping. Production institution grants, identity verification, password recovery, file scanning, retention policy, encrypted backups and migrations remain pilot preparation work.

## Validation

32 automated checks passed after upgrading the test runner. Type checks and the production UI build passed. npm audit reported zero known vulnerabilities for this lockfile at the time of delivery; this is not a security certification. Browser sign-in, loading the five examples and assessing Amina were exercised. Later browser automation hit an in-app connection/error-page restriction; HTTP checks confirmed the restarted local service and assets responded.

Presentation packages were rendered and checked with the bundled presentation tools. They were not opened in Microsoft PowerPoint. Speaker notes and a separate short pitch script are included.

The Endor package-risk workflow could not enrich package findings because Endor MCP/CLI was unavailable; no Endor approval or risk clearance is claimed. Registry audit and application tests supplied the checks above.
