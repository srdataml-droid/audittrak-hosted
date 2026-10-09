import type { PostgresDatabase } from "./postgres.js";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z, ZodError } from "zod";
import { readFile } from "node:fs/promises";
import { publicFile } from "../public-files.js";
import { extname } from "node:path";
import {
  MvpDatabase,
  id,
  now,
  hash,
  passwordHash,
  passwordMatches,
} from "./db.js";
import type { MonoTransactionsAdapter } from "../mono.js";
import { assess } from "./assessment.js";
import { AgreementSchema, InvoiceSchema, PaymentSchema } from "../model.js";
import type { DocumentExtractor } from "../extraction.js";
import { ExtractionRequestSchema } from "../extraction.js";
import scenarios from "../../data/five-scenarios.json" with { type: "json" };
const eventSchema = z.object({
  title: z.string().trim().min(2).max(150),
  service: z.string().trim().min(2).max(500),
  counterparty: z.string().trim().min(2).max(150),
  counterpartyEmail: z.string().email().or(z.literal("")).default(""),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("NGN"),
  channel: z.enum(["direct", "marketplace"]).default("direct"),
});
const body = (request: any, schema: any): any => schema.parse(request.body);
function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode: status });
}
export function registerMvp(
  app: FastifyInstance,
  db: MvpDatabase | PostgresDatabase,
  extractor?: DocumentExtractor,
  mono?: MonoTransactionsAdapter,
) {
  const sessionUser = async (request: any) => {
    const cookie = (request.headers.cookie ?? "")
      .split(";")
      .map((x: string) => x.trim())
      .find((x: string) => x.startsWith("audittrak_session="));
    if (!cookie) return null;
    return await db.one(
      "SELECT u.id,u.name,u.email,u.role,b.id AS business_id FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN businesses b ON b.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?",
      hash(cookie.slice("audittrak_session=".length)),
      now(),
    );
  };
  const requireUser = async (request: any) => {
    const user = await sessionUser(request);
    if (!user) fail(401, "Please sign in.");
    return user;
  };
  const owned = async (request: any, eventId: string) => {
    const user = await requireUser(request);
    const event = await db.event(eventId);
    if (
      !event ||
      user.role !== "business" ||
      event.business_id !== user.business_id
    )
      fail(404, "Event not found.");
    return { user, event };
  };
  const visible = async (request: any, eventId: string) => {
    const user = await requireUser(request);
    const event = await db.event(eventId);
    if (
      !event ||
      !(
        (user.role === "business" && event.business_id === user.business_id) ||
        (user.role === "reviewer" && event.submitted)
      )
    )
      fail(404, "Event not found.");
    return { user, event };
  };
  const safeUser = (user: any) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    businessId: user.business_id,
  });
  const startSession = async (reply: any, userId: string) => {
    const token = randomBytes(32).toString("hex");
    await db.run(
      "INSERT INTO sessions VALUES (?,?,?)",
      hash(token),
      userId,
      new Date(Date.now() + 7 * 86400000).toISOString(),
    );
    reply.header(
      "set-cookie",
      `audittrak_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
    );
  };
  const guard = async (request: any, reply: any) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.origin
    ) {
      let origin;
      try {
        origin = new URL(request.headers.origin).host;
      } catch {
        return reply.code(403).send({ error: "Invalid origin." });
      }
      if (origin !== request.headers.host)
        return reply
          .code(403)
          .send({ error: "Cross-origin writes are not allowed." });
    }
  };
  const attempts = new Map<
    string,
    {
      count: number;
      until: number;
    }
  >();
  app.register(
    async (api) => {
      api.addHook("preHandler", guard);
      api.addHook("onRequest", async (_request, reply) => {
        reply.header("cache-control", "no-store");
        reply.header("x-content-type-options", "nosniff");
      });
      api.setErrorHandler((caught, request, reply) => {
        const error = caught as Error & {
          statusCode?: number;
        };
        if (error instanceof ZodError)
          return reply.code(400).send({
            error: "Please check the entered fields.",
            issues: error.issues,
          });
        if (
          String(error.message).includes("UNIQUE constraint") ||
          (error as any).code === "23505"
        )
          return reply.code(409).send({
            error: "This account or transaction reference already exists.",
          });
        const status = (error as any).statusCode ?? 500;
        if (status >= 500) request.log.error(error);
        reply.code(status).send({
          error:
            status >= 500
              ? "The request could not be completed."
              : error.message,
        });
      });
      api.post("/auth/signup", async (request, reply) => {
        const input = body(
          request,
          z.object({
            name: z.string().trim().min(2).max(100),
            email: z.string().email().max(200).toLowerCase(),
            password: z.string().min(12).max(128),
            businessName: z.string().trim().min(2).max(150),
          }),
        );
        const uid = id(),
          bid = id();
        await db.atomic(async () => {
          await db.run(
            "INSERT INTO users VALUES (?,?,?,?,?,?)",
            uid,
            input.email,
            input.name,
            passwordHash(input.password),
            "business",
            now(),
          );
          await db.run(
            "INSERT INTO businesses(id,user_id,name,created_at) VALUES (?,?,?,?)",
            bid,
            uid,
            input.businessName,
            now(),
          );
          await db.audit(bid, uid, null, "account.created");
        });
        await startSession(reply, uid);
        return {
          user: safeUser({
            ...input,
            id: uid,
            role: "business",
            business_id: bid,
          }),
        };
      });
      api.post("/auth/login", async (request, reply) => {
        const key = request.ip;
        const counter = attempts.get(key);
        if (counter && counter.until > Date.now() && counter.count >= 10)
          fail(429, "Too many attempts. Please wait 15 minutes.");
        const input = body(
          request,
          z.object({
            email: z.string().email().toLowerCase(),
            password: z.string().min(1).max(128),
          }),
        );
        const user = await db.one(
          "SELECT u.*,b.id AS business_id FROM users u LEFT JOIN businesses b ON b.user_id=u.id WHERE u.email=?",
          input.email,
        );
        if (!user || !passwordMatches(input.password, user.password_hash)) {
          const old =
            counter && counter.until > Date.now()
              ? counter
              : { count: 0, until: Date.now() + 900000 };
          attempts.set(key, { count: old.count + 1, until: old.until });
          fail(401, "Email or password is incorrect.");
        }
        attempts.delete(key);
        await startSession(reply, user.id);
        return { user: safeUser(user) };
      });
      api.post("/auth/logout", async (request, reply) => {
        const cookie = (request.headers.cookie ?? "")
          .split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("audittrak_session="));
        if (cookie)
          await db.run(
            "DELETE FROM sessions WHERE token_hash=?",
            hash(cookie.slice("audittrak_session=".length)),
          );
        reply.header(
          "set-cookie",
          "audittrak_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return { ok: true };
      });
      api.get("/auth/me", async (request) => ({
        user: safeUser(await requireUser(request)),
      }));
      api.get("/business", async (request) => {
        const user = await requireUser(request);
        if (user.role !== "business") fail(403, "Business access required.");
        return await db.one(
          "SELECT id,name,sector,description,created_at FROM businesses WHERE id=?",
          user.business_id,
        );
      });
      api.put("/business", async (request) => {
        const user = await requireUser(request);
        if (user.role !== "business") fail(403, "Business access required.");
        const input = body(
          request,
          z.object({
            name: z.string().trim().min(2).max(150),
            sector: z.string().max(100).default(""),
            description: z.string().max(1000).default(""),
          }),
        );
        await db.run(
          "UPDATE businesses SET name=?,sector=?,description=? WHERE id=?",
          input.name,
          input.sector,
          input.description,
          user.business_id,
        );
        await db.audit(user.business_id, user.id, null, "business.updated");
        return { ok: true };
      });
      api.get("/counterparties", async (request) => {
        const user = await requireUser(request);
        if (user.role !== "business") fail(403, "Business access required.");
        return await db.all(
          "SELECT * FROM counterparties WHERE business_id=?",
          user.business_id,
        );
      });
      api.get("/events", async (request) => {
        const user = await requireUser(request);
        const rows =
          user.role === "reviewer"
            ? await db.all(
                "SELECT id FROM commercial_events WHERE submitted=1 ORDER BY updated_at DESC",
              )
            : await db.all(
                "SELECT id FROM commercial_events WHERE business_id=? ORDER BY updated_at DESC",
                user.business_id,
              );
        return await sequence(rows, async (row) => await db.event(row.id));
      });
      api.post("/events", async (request) => {
        const user = await requireUser(request);
        if (user.role !== "business") fail(403, "Business access required.");
        const input = body(request, eventSchema),
          eid = id(),
          cid = id();
        await db.atomic(async () => {
          await db.run(
            "INSERT INTO counterparties VALUES (?,?,?,?)",
            cid,
            user.business_id,
            input.counterparty,
            input.counterpartyEmail,
          );
          await db.run(
            "INSERT INTO commercial_events VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            eid,
            user.business_id,
            cid,
            input.title,
            input.service,
            input.currency,
            input.channel,
            1,
            0,
            now(),
            now(),
          );
          await db.audit(user.business_id, user.id, eid, "event.created");
        });
        return await db.event(eid);
      });
      api.get<{
        Params: {
          id: string;
        };
      }>("/events/:id", async (request) => {
        const { user, event } = await visible(request, request.params.id);
        if (user.role === "reviewer")
          await db.audit(
            event.business_id,
            user.id,
            event.id,
            "institutional.event.viewed",
          );
        return event;
      });
      api.patch<{
        Params: {
          id: string;
        };
      }>("/events/:id", async (request) => {
        const { user, event } = await owned(request, request.params.id);
        const input = body(request, eventSchema);
        await db.atomic(async () => {
          await db.run(
            "UPDATE counterparties SET name=?,email=? WHERE id=?",
            input.counterparty,
            input.counterpartyEmail,
            event.counterparty_id,
          );
          await db.run(
            "UPDATE commercial_events SET title=?,service=?,currency=?,channel=? WHERE id=?",
            input.title,
            input.service,
            input.currency,
            input.channel,
            event.id,
          );
          await db.touch(event.id);
          await db.audit(user.business_id, user.id, event.id, "event.updated");
        });
        return await db.event(event.id);
      });
      api.delete<{
        Params: {
          id: string;
        };
      }>("/events/:id", async (request) => {
        const { user, event } = await owned(request, request.params.id);
        await db.atomic(async () => {
          await db.audit(user.business_id, user.id, event.id, "event.deleted");
          await db.run("DELETE FROM commercial_events WHERE id=?", event.id);
        });
        return { ok: true };
      });
      for (const [path, table, schema] of [
        ["agreement", "agreements", AgreementSchema],
        ["invoice", "invoices", InvoiceSchema],
      ] as const) {
        api.put<{
          Params: {
            id: string;
          };
        }>(`/events/:id/${path}`, async (request) => {
          const { user, event } = await owned(request, request.params.id);
          const input = body(request, schema);
          input.source = "user";
          await db.atomic(async () => {
            await db.run(
              `INSERT INTO ${table}(id,event_id,data) VALUES (?,?,?) ON CONFLICT(event_id) DO UPDATE SET data=excluded.data`,
              id(),
              event.id,
              JSON.stringify(input),
            );
            await db.touch(event.id);
            await db.audit(
              user.business_id,
              user.id,
              event.id,
              `${path}.saved`,
            );
          });
          return await db.event(event.id);
        });
      }
      api.post<{
        Params: {
          id: string;
        };
      }>("/events/:id/transactions", async (request) => {
        const { user, event } = await owned(request, request.params.id);
        const input = body(request, PaymentSchema);
        input.source = "user";
        await db.atomic(async () => {
          await db.run(
            "INSERT INTO transactions VALUES (?,?,?,?,?)",
            id(),
            event.id,
            user.business_id,
            input.transactionId,
            JSON.stringify(input),
          );
          await db.touch(event.id);
          await db.audit(
            user.business_id,
            user.id,
            event.id,
            "transaction.linked",
          );
        });
        return await db.event(event.id);
      });
      api.delete<{
        Params: {
          id: string;
          transactionId: string;
        };
      }>("/events/:id/transactions/:transactionId", async (request) => {
        const { user, event } = await owned(request, request.params.id);
        await db.atomic(async () => {
          const result = await db.run(
            "DELETE FROM transactions WHERE event_id=? AND transaction_id=?",
            event.id,
            request.params.transactionId,
          );
          if (!result.changes) fail(404, "Transaction not found.");
          await db.touch(event.id);
          await db.audit(
            user.business_id,
            user.id,
            event.id,
            "transaction.unlinked",
          );
        });
        return await db.event(event.id);
      });
      api.put<{
        Params: {
          id: string;
        };
      }>("/events/:id/fulfillment", async (request) => {
        const { user, event } = await owned(request, request.params.id);
        const input = body(
          request,
          z.object({
            status: z.enum(["in_progress", "completed"]),
            description: z.string().trim().min(3).max(2000),
            completedDate: z.string().date().optional(),
          }),
        );
        if (input.status === "completed" && !input.completedDate)
          fail(400, "Enter the completion date.");
        await db.atomic(async () => {
          await db.run(
            "INSERT INTO fulfillments VALUES (?,?,?) ON CONFLICT(event_id) DO UPDATE SET data=excluded.data",
            id(),
            event.id,
            JSON.stringify(input),
          );
          await db.touch(event.id);
          await db.audit(
            user.business_id,
            user.id,
            event.id,
            "fulfillment.saved",
          );
        });
        return await db.event(event.id);
      });
      api.post<{
        Params: {
          id: string;
        };
      }>("/events/:id/evidence", async (request) => {
        const { user, event } = await owned(request, request.params.id);
        const input = body(
          request,
          z.object({
            kind: z.enum([
              "agreement",
              "invoice",
              "payment",
              "fulfillment",
              "other",
            ]),
            name: z.string().min(1).max(200),
            mime: z.enum([
              "application/pdf",
              "image/png",
              "image/jpeg",
              "text/plain",
            ]),
            base64: z.string().max(7000000),
          }),
        );
        const bytes = Buffer.from(input.base64, "base64");
        if (!bytes.length || bytes.length > 3 * 1024 * 1024)
          fail(400, "Files must be between 1 byte and 3 MB.");
        await db.atomic(async () => {
          await db.run(
            "INSERT INTO evidence_items VALUES (?,?,?,?,?,?,?)",
            id(),
            event.id,
            input.kind,
            input.name,
            input.mime,
            bytes,
            now(),
          );
          await db.touch(event.id);
          await db.audit(
            user.business_id,
            user.id,
            event.id,
            "evidence.uploaded",
          );
        });
        return await db.event(event.id);
      });
      api.get<{
        Params: {
          id: string;
          itemId: string;
        };
      }>("/events/:id/evidence/:itemId", async (request, reply) => {
        await visible(request, request.params.id);
        const item = await db.one(
          "SELECT * FROM evidence_items WHERE event_id=? AND id=?",
          request.params.id,
          request.params.itemId,
        );
        if (!item) fail(404, "Evidence not found.");
        return reply
          .header(
            "content-disposition",
            `attachment; filename="${item.name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
          )
          .type("application/octet-stream")
          .send(Buffer.from(item.bytes));
      });
      api.post<{
        Params: {
          id: string;
        };
      }>("/events/:id/attestations", async (request) => {
        const { user, event } = await owned(request, request.params.id);
        const token = randomBytes(32).toString("hex");
        await db.run(
          "INSERT INTO attestations(id,event_id,token_hash,revision,created_at) VALUES (?,?,?,?,?)",
          id(),
          event.id,
          hash(token),
          event.revision,
          now(),
        );
        await db.audit(
          user.business_id,
          user.id,
          event.id,
          "attestation.invitation.created",
        );
        return {
          path: "/confirm/" + token,
          revision: event.revision,
          notice:
            "Share this link yourself with the intended counterparty. No message was sent. The link verifies possession, not identity.",
        };
      });
      api.get<{
        Params: {
          token: string;
        };
      }>("/attest/:token", async (request) => {
        const entry = await db.one(
          "SELECT * FROM attestations WHERE token_hash=?",
          hash(request.params.token),
        );
        if (!entry) fail(404, "Invitation not found.");
        if (Date.now() - Date.parse(entry.created_at) > 14 * 86400000)
          fail(410, "This invitation expired. Ask for a new link.");
        const event = await db.event(entry.event_id);
        if (entry.revision !== event.revision)
          fail(409, "This event changed. Ask for a new confirmation link.");
        return {
          title: event.title,
          service: event.service,
          business: event.business_name,
          counterparty: event.counterparty,
          invoice: event.invoice
            ? {
                amount: event.invoice.amount,
                invoiceNumber: event.invoice.invoiceNumber,
              }
            : null,
          agreement: event.agreement
            ? {
                amount: event.agreement.amount,
                service: event.agreement.service,
              }
            : null,
          payments: event.transactions.map((x: any) => ({
            amount: x.amount,
            direction: x.direction,
            date: x.transactionDate,
            counterparty: x.counterparty,
          })),
          fulfillment: event.fulfillment,
          status: entry.status,
          revision: entry.revision,
        };
      });
      api.post<{
        Params: {
          token: string;
        };
      }>("/attest/:token", async (request) => {
        const input = body(
          request,
          z.object({
            name: z.string().trim().min(2).max(150),
            status: z.enum(["confirmed", "disputed"]),
            comment: z.string().max(2000).default(""),
          }),
        );
        const entry = await db.one(
          "SELECT * FROM attestations WHERE token_hash=?",
          hash(request.params.token),
        );
        if (!entry) fail(404, "Invitation not found.");
        if (Date.now() - Date.parse(entry.created_at) > 14 * 86400000)
          fail(410, "This invitation expired. Ask for a new link.");
        const event = await db.event(entry.event_id);
        if (entry.status !== "pending")
          fail(409, "This invitation has already been answered.");
        if (entry.revision !== event.revision)
          fail(409, "This event changed. Ask for a new link.");
        await db.atomic(async () => {
          await db.run(
            "UPDATE attestations SET status=?,name=?,comment=?,responded_at=? WHERE id=?",
            input.status,
            input.name,
            input.comment,
            now(),
            entry.id,
          );
          await db.run(
            "UPDATE commercial_events SET submitted=0 WHERE id=?",
            event.id,
          );
          await db.run(
            "UPDATE evidence_assessments SET revision=-abs(revision) WHERE event_id=?",
            event.id,
          );
          await db.audit(
            event.business_id,
            "link-recipient",
            event.id,
            "attestation." + input.status,
          );
        });
        return { ok: true, status: input.status };
      });
      api.post<{
        Params: {
          id: string;
        };
      }>("/events/:id/assessment", async (request) => {
        const { user, event } = await owned(request, request.params.id);
        const assessment = assess(event),
          aid = id();
        await db.atomic(async () => {
          await db.run(
            "INSERT INTO evidence_assessments VALUES (?,?,?,?,?)",
            aid,
            event.id,
            event.revision,
            JSON.stringify(assessment),
            now(),
          );
          await sequence(
            assessment.reasons,
            async (reason: any) =>
              await db.run(
                "INSERT INTO consistency_flags VALUES (?,?,?,?,?)",
                id(),
                aid,
                reason.code,
                reason.status,
                reason.message,
              ),
          );
          await db.audit(
            user.business_id,
            user.id,
            event.id,
            "assessment.created",
          );
        });
        return await db.event(event.id);
      });
      api.post<{
        Params: {
          id: string;
        };
      }>("/events/:id/submit", async (request) => {
        const { user, event } = await owned(request, request.params.id);
        if (!event.assessment || event.assessment.stale)
          fail(400, "Run an up-to-date assessment before sharing.");
        await db.run(
          "UPDATE commercial_events SET submitted=1 WHERE id=?",
          event.id,
        );
        await db.audit(
          user.business_id,
          user.id,
          event.id,
          "event.shared.for.review",
        );
        return await db.event(event.id);
      });
      api.post<{
        Params: {
          id: string;
        };
      }>("/events/:id/unshare", async (request) => {
        const { user, event } = await owned(request, request.params.id);
        await db.run(
          "UPDATE commercial_events SET submitted=0 WHERE id=?",
          event.id,
        );
        await db.audit(
          user.business_id,
          user.id,
          event.id,
          "event.sharing.revoked",
        );
        return await db.event(event.id);
      });
      api.post<{
        Params: {
          id: string;
        };
      }>("/events/:id/reviews", async (request) => {
        const { user, event } = await visible(request, request.params.id);
        if (user.role !== "reviewer")
          fail(403, "Institutional reviewer access required.");
        const input = body(
          request,
          z.object({ note: z.string().trim().min(3).max(2000) }),
        );
        await db.run(
          "INSERT INTO institutional_reviews VALUES (?,?,?,?,?,?)",
          id(),
          event.id,
          user.id,
          event.revision,
          input.note,
          now(),
        );
        await db.audit(
          event.business_id,
          user.id,
          event.id,
          "institutional.note.created",
        );
        return await db.event(event.id);
      });
      api.get("/profile", async (request) => {
        const user = await requireUser(request);
        if (user.role !== "business") fail(403, "Business access required.");
        const events = await sequence(
          await db.all(
            "SELECT id FROM commercial_events WHERE business_id=?",
            user.business_id,
          ),
          async (x) => await db.event(x.id),
        );
        const byCurrency: Record<string, number> = {};
        events.forEach((event) => {
          const value = assess(event);
          if (value.netPaymentMinor !== null)
            byCurrency[event.currency] =
              (byCurrency[event.currency] ?? 0) + value.netPaymentMinor;
        });
        const profile = {
          events: events.length,
          shared: events.filter((x) => x.submitted).length,
          consistent: events.filter((x) => assess(x).status === "consistent")
            .length,
          requiresReview: events.filter(
            (x) => assess(x).status !== "consistent",
          ).length,
          netLinkedPaymentsByCurrency: byCurrency,
          explanation:
            "Summarizes linked records. This is not verified income or a credit score.",
        };
        await db.run(
          "INSERT INTO commercial_activity_profiles VALUES (?,?,?) ON CONFLICT(business_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
          user.business_id,
          JSON.stringify(profile),
          now(),
        );
        return profile;
      });
      api.get("/audit", async (request) => {
        const user = await requireUser(request);
        if (user.role !== "business") fail(403, "Business access required.");
        return await db.all(
          "SELECT action,event_id,created_at FROM audit_logs WHERE business_id=? ORDER BY rowid DESC LIMIT 200",
          user.business_id,
        );
      });
      api.post<{
        Params: {
          id: string;
        };
      }>("/events/:id/mono-import", async (request) => {
        const { user, event } = await owned(request, request.params.id);
        if (!mono)
          fail(503, "Mono is not configured. Manual records remain available.");
        const input = body(
          request,
          z.object({
            transactionIds: z.array(z.string().min(1)).min(1).max(100),
          }),
        );
        let bindings: Record<string, string> = {};
        try {
          bindings = JSON.parse(process.env.MONO_ACCOUNT_BINDINGS ?? "{}");
        } catch {
          fail(503, "Bank account bindings are not configured correctly.");
        }
        const account = bindings[user.business_id];
        if (!account)
          fail(
            403,
            "No consented Mono account is bound to this business by the server operator.",
          );
        const records = await mono!.listTransactions(account);
        const selected = records.filter((x) =>
          input.transactionIds.includes(x.transactionId),
        );
        if (selected.length !== new Set(input.transactionIds).size)
          fail(
            400,
            "A requested transaction was not returned by the bound account.",
          );
        await db.atomic(async () => {
          await sequence(
            selected,
            async (tx) =>
              await db.run(
                "INSERT INTO transactions VALUES (?,?,?,?,?)",
                id(),
                event.id,
                user.business_id,
                tx.transactionId,
                JSON.stringify(tx),
              ),
          );
          await db.touch(event.id);
          await db.audit(
            user.business_id,
            user.id,
            event.id,
            "mono.transactions.imported",
          );
        });
        return await db.event(event.id);
      });
      api.post<{
        Params: {
          id: string;
        };
      }>("/events/:id/extraction", async (request) => {
        const { user, event } = await owned(request, request.params.id);
        if (!extractor)
          fail(
            503,
            "AI extraction is not configured. Enter reviewed fields manually; no AI result has been invented.",
          );
        const input = body(request, ExtractionRequestSchema);
        const document = await db.one(
          "SELECT kind FROM evidence_items WHERE id=? AND event_id=?",
          input.documentId,
          event.id,
        );
        if (!document || document.kind !== input.documentKind)
          fail(400, "Choose an attached document of the matching type.");
        const result = await extractor!.extract(input);
        if (
          result.documentId !== input.documentId ||
          result.documentKind !== input.documentKind
        )
          fail(502, "Extraction provider returned a different document.");
        for (const field of Object.values(result.fields))
          if (!input.documentText.includes(field.supportingText))
            fail(
              502,
              "A proposed field did not include a matching source excerpt.",
            );
        await db.run(
          "INSERT INTO extraction_proposals VALUES (?,?,?,?)",
          id(),
          event.id,
          JSON.stringify(result),
          now(),
        );
        await db.audit(
          user.business_id,
          user.id,
          event.id,
          "extraction.proposed",
        );
        return {
          proposal: result,
          notice:
            "Review against the original. No agreement, invoice, payment, or assessment was changed.",
        };
      });
      api.post("/demo/seed", async (request) => {
        const user = await requireUser(request);
        if (user.role !== "business") fail(403, "Business access required.");
        if (
          await db.one(
            "SELECT id FROM commercial_events WHERE business_id=? LIMIT 1",
            user.business_id,
          )
        )
          fail(409, "Examples can only be added to an empty workspace.");
        await db.atomic(async () => {
          await sequence(scenarios, async (scenario, index) => {
            const eid = id(),
              cid = id(),
              request = scenario.reconciliationRequest;
            await db.run(
              "INSERT INTO counterparties VALUES (?,?,?,?)",
              cid,
              user.business_id,
              scenario.customer,
              "",
            );
            await db.run(
              "INSERT INTO commercial_events VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              eid,
              user.business_id,
              cid,
              scenario.service + " — " + scenario.customer,
              scenario.service,
              "NGN",
              index < 3 ? "marketplace" : "direct",
              1,
              0,
              now(),
              now(),
            );
            await db.run(
              "INSERT INTO agreements VALUES (?,?,?)",
              id(),
              eid,
              JSON.stringify({ ...request.agreement, id: id() }),
            );
            await db.run(
              "INSERT INTO invoices VALUES (?,?,?)",
              id(),
              eid,
              JSON.stringify({ ...request.invoice, id: id() }),
            );
            await sequence(
              scenario.appRecords.bank.lines,
              async (line: any, n: number) => {
                const tx = {
                  id: id(),
                  kind: "payment",
                  source: "demo",
                  transactionId: `demo-${eid}-${n}`,
                  direction: line.direction,
                  counterparty: line.name,
                  amount: {
                    amountMinor: line.amountMinor,
                    currency: line.currency,
                  },
                  transactionDate: line.date,
                  reference: line.reference,
                };
                await db.run(
                  "INSERT INTO transactions VALUES (?,?,?,?,?)",
                  id(),
                  eid,
                  user.business_id,
                  tx.transactionId,
                  JSON.stringify(tx),
                );
              },
            );
            await db.run(
              "INSERT INTO demo_stories VALUES (?,?)",
              eid,
              JSON.stringify({
                scenarioId: scenario.id,
                customer: scenario.customer,
                chat: scenario.appRecords.chat,
                expectedExplanation: scenario.prototypeExpectation,
              }),
            );
            const conversation = Buffer.from(
              "FICTIONAL DEMO — " +
                scenario.appRecords.chat.app +
                "\n\n" +
                scenario.appRecords.chat.messages
                  .map((m: any) => m.speaker + ": " + m.text)
                  .join("\n"),
            );
            await db.run(
              "INSERT INTO evidence_items VALUES (?,?,?,?,?,?,?)",
              id(),
              eid,
              "agreement",
              "fictional-conversation.txt",
              "text/plain",
              conversation,
              now(),
            );
            await db.audit(
              user.business_id,
              user.id,
              eid,
              "demo.event.created",
            );
          });
        });
        return { ok: true, count: 5 };
      });
    },
    { prefix: "/api/v1" },
  );
  app.get("/", async (_request, reply) =>
    reply.type("text/html").send(await readFile(publicFile("app/index.html"))),
  );
  app.get("/confirm/:token", async (_request, reply) =>
    reply.type("text/html").send(await readFile(publicFile("app/index.html"))),
  );
  app.get<{
    Params: {
      name: string;
    };
  }>("/story-assets/:name", async (request, reply) => {
    if (!/^(amina|chidi|zainab|kemi|tobi)\.png$/.test(request.params.name))
      return reply.code(404).send();
    try {
      return reply
        .type("image/png")
        .send(await readFile(publicFile("stories/" + request.params.name)));
    } catch {
      return reply.code(404).send();
    }
  });
  app.get<{
    Params: {
      "*": string;
    };
  }>("/app-assets/*", async (request, reply) => {
    const filename = request.params["*"];
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return reply.code(404).send();
    try {
      const file = await readFile(publicFile("app/app-assets/" + filename));
      return reply
        .type(
          extname(filename) === ".js"
            ? "text/javascript"
            : extname(filename) === ".css"
              ? "text/css"
              : "application/octet-stream",
        )
        .send(file);
    } catch {
      return reply.code(404).send();
    }
  });
}

async function sequence<T, R>(
  values: readonly T[],
  fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index++)
    results.push(await fn(values[index], index));
  return results;
}
