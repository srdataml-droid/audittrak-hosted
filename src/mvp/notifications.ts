import type { MvpDatabase } from "./db.js";
import type { PostgresDatabase } from "./postgres.js";
import { now } from "./db.js";
export type NotificationSender = (message: {
  id: string;
  recipient: string;
  subject: string;
  body: string;
}) => Promise<void>;
export function configuredSender(): NotificationSender | undefined {
  const key = process.env.RESEND_API_KEY,
    from = process.env.NOTIFICATION_FROM_EMAIL;
  if (!key || !from) return;
  return async (message) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "Idempotency-Key": `audittrak-confirmation-${message.id}`,
      },
      body: JSON.stringify({
        from,
        to: [message.recipient],
        subject: message.subject,
        text: message.body,
      }),
    });
    if (!response.ok)
      throw new Error(`Email provider returned HTTP ${response.status}`);
  };
}
export async function deliverNotifications(
  db: MvpDatabase | PostgresDatabase,
  businessId: string,
  sender = configuredSender(),
) {
  const stale = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const messages = await db.all(
    "SELECT * FROM notification_outbox WHERE business_id=? AND (status IN ('pending','failed','not_configured') OR (status='sending' AND (attempted_at<? OR attempted_at IS NULL))) AND attempts<5 ORDER BY created_at LIMIT 5",
    businessId,
    stale,
  );
  for (const message of messages) {
    if (!sender) {
      await db.run(
        "UPDATE notification_outbox SET status='not_configured',last_error='Email service is not configured.' WHERE id=?",
        message.id,
      );
      continue;
    }
    // Claim before sending; concurrent requests cannot send the same queue item.
    const claimed = await db.run(
      "UPDATE notification_outbox SET status='sending',attempts=attempts+1,attempted_at=? WHERE id=? AND (status IN ('pending','failed','not_configured') OR (status='sending' AND (attempted_at<? OR attempted_at IS NULL)))",
      now(),
      message.id,
      stale,
    );
    if (!claimed.changes) continue;
    try {
      await sender(message);
      await db.run(
        "UPDATE notification_outbox SET status='sent',sent_at=?,last_error='' WHERE id=?",
        now(),
        message.id,
      );
    } catch {
      await db.run(
        "UPDATE notification_outbox SET status='failed',last_error='Email delivery failed. Your client response is saved.' WHERE id=?",
        message.id,
      );
    }
  }
}
