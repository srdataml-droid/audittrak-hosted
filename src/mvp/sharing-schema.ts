// Additive schema, compatible with existing SQLite and PostgreSQL databases.
export const sharingSchema = `
CREATE TABLE IF NOT EXISTS evidence_shares (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), token_hash TEXT UNIQUE NOT NULL,
 title TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS confirmation_details (
 attestation_id TEXT PRIMARY KEY REFERENCES attestations(id) ON DELETE CASCADE,
 snapshot TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', review_consent INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notification_outbox (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), attestation_id TEXT UNIQUE NOT NULL REFERENCES attestations(id) ON DELETE CASCADE,
 recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0, attempted_at TEXT, created_at TEXT NOT NULL, sent_at TEXT, last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS shares_business ON evidence_shares(business_id);
CREATE INDEX IF NOT EXISTS notification_business ON notification_outbox(business_id);
`;
