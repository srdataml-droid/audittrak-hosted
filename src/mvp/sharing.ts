import type { FastifyInstance } from "fastify";
import type { MvpDatabase } from "./db.js";
import type { PostgresDatabase } from "./postgres.js";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { hash, id, now } from "./db.js";
import {
  configuredSender,
  deliverNotifications,
  type NotificationSender,
} from "./notifications.js";
type Db = MvpDatabase | PostgresDatabase;
function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
export function evidenceSnapshot(event: any) {
  return {
    id: event.id,
    title: event.title,
    service: event.service,
    currency: event.currency,
    business: event.business_name,
    counterparty: event.counterparty,
    revision: event.revision,
    agreement: event.agreement,
    invoice: event.invoice,
    payments: event.transactions,
    fulfillment: event.fulfillment,
    files: event.evidence,
    assessment: event.assessment,
    confirmations: event.attestations
      .filter((x: any) => x.status !== "pending")
      .map((x: any) => ({
        status: x.status,
        revision: x.revision,
        responded_at: x.responded_at,
        name: x.review_consent ? x.name : "",
        review: x.review_consent ? x.comment : "",
      })),
  };
}
export async function sendSnapshotFile(
  db: Db,
  snapshot: any,
  fileId: string,
  reply: any,
) {
  const metadata = snapshot.files.find((x: any) => x.id === fileId);
  if (!metadata) fail(404, "Document is not included in this link.");
  const item = await db.one(
    "SELECT name,mime,bytes FROM evidence_items WHERE id=? AND event_id=?",
    fileId,
    snapshot.id,
  );
  if (!item) fail(410, "This document is no longer available.");
  const image = ["image/png", "image/jpeg"].includes(item.mime);
  return reply
    .header("referrer-policy", "no-referrer")
    .header("x-robots-tag", "noindex, nofollow")
    .header(
      "content-disposition",
      `${image ? "inline" : "attachment"}; filename="${item.name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
    )
    .type(image ? item.mime : "application/octet-stream")
    .send(Buffer.from(item.bytes));
}
export function registerSharing(
  api: FastifyInstance,
  db: Db,
  requireUser: (r: any) => Promise<any>,
  sender?: NotificationSender,
) {
  const businessUser = async (request: any) => {
    const user = await requireUser(request);
    if (user.role !== "business") fail(403, "Business access required.");
    return user;
  };
  const load = async (token: string) => {
    if (!/^[a-f0-9]{64}$/.test(token)) fail(404, "Shared evidence not found.");
    const share = await db.one(
      "SELECT * FROM evidence_shares WHERE token_hash=?",
      hash(token),
    );
    if (!share) fail(404, "Shared evidence not found.");
    if (share.revoked || share.expires_at < now())
      fail(410, "This sharing link has expired or been revoked.");
    const snapshot = JSON.parse(share.snapshot);
    for (const event of snapshot.events) {
      if (
        !(await db.one(
          "SELECT id FROM commercial_events WHERE id=? AND business_id=?",
          event.id,
          share.business_id,
        ))
      )
        fail(410, "This evidence was removed by its owner.");
    }
    return { ...share, snapshot };
  };
  api.post("/shares", async (request) => {
    const user = await businessUser(request);
    const input = z
      .object({
        eventIds: z.array(z.string().min(1)).min(1).max(20),
        title: z.string().trim().min(2).max(150),
        expiresDays: z
          .union([z.literal(7), z.literal(30), z.literal(90)])
          .default(30),
      })
      .parse(request.body);
    const snapshots: any[] = [];
    await db.atomic(async () => {
      for (const eventId of [...new Set(input.eventIds)]) {
        const event = await db.event(eventId);
        if (!event || event.business_id !== user.business_id)
          fail(404, "Commercial Evidence not found.");
        const current = await db.one(
          "SELECT revision FROM commercial_events WHERE id=?",
          event.id,
        );
        if (current.revision !== event.revision)
          fail(409, "Evidence changed while capturing the pack. Try again.");
        snapshots.push(evidenceSnapshot(event));
      }
    });
    const token = randomBytes(32).toString("hex"),
      shareId = id(),
      created = now();
    await db.run(
      "INSERT INTO evidence_shares(id,business_id,token_hash,title,snapshot,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",
      shareId,
      user.business_id,
      hash(token),
      input.title,
      JSON.stringify({ events: snapshots }),
      created,
      new Date(Date.now() + input.expiresDays * 86400000).toISOString(),
    );
    await db.audit(user.business_id, user.id, null, "evidence.link.created");
    return {
      id: shareId,
      path: "/share/" + token,
      created_at: created,
      expiresDays: input.expiresDays,
    };
  });
  api.get("/shares", async (request) => {
    const user = await businessUser(request);
    const rows = await db.all(
      "SELECT id,title,snapshot,created_at,expires_at,revoked FROM evidence_shares WHERE business_id=? ORDER BY created_at DESC",
      user.business_id,
    );
    return rows.map((x) => ({
      id: x.id,
      title: x.title,
      created_at: x.created_at,
      expires_at: x.expires_at,
      revoked: !!x.revoked,
      eventIds: JSON.parse(x.snapshot).events.map((e: any) => e.id),
    }));
  });
  api.post<{ Params: { id: string } }>(
    "/shares/:id/revoke",
    async (request) => {
      const user = await businessUser(request);
      const result = await db.run(
        "UPDATE evidence_shares SET revoked=1 WHERE id=? AND business_id=?",
        request.params.id,
        user.business_id,
      );
      if (!result.changes) fail(404, "Sharing link not found.");
      await db.audit(user.business_id, user.id, null, "evidence.link.revoked");
      return { ok: true };
    },
  );
  api.get<{ Params: { token: string } }>(
    "/shared/:token",
    async (request, reply) => {
      const share = await load(request.params.token);
      reply
        .header("referrer-policy", "no-referrer")
        .header("x-robots-tag", "noindex, nofollow");
      const totals: Record<string, number> = {};
      let unreadReceipts = 0;
      for (const event of share.snapshot.events) {
        const mixed = event.payments.some(
          (p: any) => p.amount.currency !== event.currency,
        );
        if (mixed) continue;
        for (const payment of event.payments)
          totals[event.currency] =
            (totals[event.currency] ?? 0) +
            (payment.direction === "debit" ? -1 : 1) *
              payment.amount.amountMinor;
        if (
          !event.payments.length &&
          event.files.some((f: any) => f.kind === "payment")
        )
          unreadReceipts++;
      }
      return {
        title: share.title,
        created_at: share.created_at,
        expires_at: share.expires_at,
        events: share.snapshot.events,
        totals,
        unreadReceipts,
      };
    },
  );
  api.get<{ Params: { token: string; fileId: string } }>(
    "/shared/:token/files/:fileId",
    async (request, reply) => {
      const share = await load(request.params.token);
      const event = share.snapshot.events.find((e: any) =>
        e.files.some((f: any) => f.id === request.params.fileId),
      );
      if (!event) fail(404, "Document is not included in this link.");
      return sendSnapshotFile(db, event, request.params.fileId, reply);
    },
  );
  api.get("/notifications", async (request) => {
    const user = await businessUser(request);
    return {
      configured: !!(sender ?? configuredSender()),
      recipient: user.email,
      items: await db.all(
        "SELECT id,subject,status,created_at,sent_at,last_error FROM notification_outbox WHERE business_id=? ORDER BY created_at DESC LIMIT 50",
        user.business_id,
      ),
    };
  });
  api.post("/notifications/retry", async (request) => {
    const user = await businessUser(request);
    await deliverNotifications(db, user.business_id, sender);
    return { ok: true };
  });
}
