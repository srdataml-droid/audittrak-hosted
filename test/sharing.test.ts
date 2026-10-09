import { it, expect } from "vitest";
import { buildServer } from "../src/server.js";
import { MvpDatabase } from "../src/mvp/db.js";
import { deliverNotifications } from "../src/mvp/notifications.js";

async function workspace(sender?: any) {
  const db = new MvpDatabase(":memory:");
  const app = buildServer({ database: db, notificationSender: sender });
  const call = async (
    method: string,
    path: string,
    payload?: any,
    cookie = "",
  ) =>
    app.inject({
      method: method as any,
      url: "/api/v1" + path,
      payload,
      headers: cookie ? { cookie } : undefined,
    });
  const account = await call("POST", "/auth/signup", {
    name: "Sharing Owner",
    email: "owner@example.invalid",
    password: "TwelveCharacters!",
    businessName: "Sharing Studio",
  });
  const cookie = String(account.headers["set-cookie"]).split(";")[0];
  const create = async (title: string) => {
    const r = await call(
      "POST",
      "/events",
      {
        title,
        service: "Design",
        counterparty: "Client",
        currency: "NGN",
        channel: "direct",
      },
      cookie,
    );
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  return { app, db, call, cookie, create, user: account.json().user };
}
it("shares only selected evidence, captures versions, scopes anonymous documents and supports revocation", async () => {
  const { app, db, call, cookie, create } = await workspace();
  try {
    const first = await create("Selected work"),
      second = await create("Another selected work"),
      privateJob = await create("Unselected private work");
    const receipt = (
      await call(
        "POST",
        `/events/${first.id}/evidence`,
        {
          kind: "payment",
          name: "receipt.txt",
          mime: "text/plain",
          base64: Buffer.from("Receipt original").toString("base64"),
        },
        cookie,
      )
    ).json().evidence[0];
    const privateFile = (
      await call(
        "POST",
        `/events/${privateJob.id}/evidence`,
        {
          kind: "agreement",
          name: "private.txt",
          mime: "text/plain",
          base64: Buffer.from("Private original").toString("base64"),
        },
        cookie,
      )
    ).json().evidence[0];
    await call(
      "POST",
      `/events/${second.id}/transactions`,
      {
        id: "payment1",
        kind: "payment",
        source: "user",
        transactionId: "TX1",
        direction: "credit",
        counterparty: "Client",
        amount: { amountMinor: 150000, currency: "NGN" },
        transactionDate: "2026-10-01",
      },
      cookie,
    );
    await call(
      "POST",
      `/events/${second.id}/transactions`,
      {
        id: "paymentUSD",
        kind: "payment",
        source: "user",
        transactionId: "USD1",
        direction: "credit",
        counterparty: "Client",
        amount: { amountMinor: 2500, currency: "USD" },
        transactionDate: "2026-10-01",
      },
      cookie,
    );
    const created = await call(
      "POST",
      "/shares",
      { title: "Selected Evidence Pack", eventIds: [first.id, second.id] },
      cookie,
    );
    expect(created.statusCode, created.body).toBe(200);
    const token = created.json().path.split("/").pop();
    const opened = await call("GET", "/shared/" + token);
    expect(opened.statusCode).toBe(200);
    expect(opened.headers["cache-control"]).toBe("no-store");
    expect(opened.json().events.map((e: any) => e.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(opened.json().totals.NGN).toBe(150000);
    expect(opened.json().totals.USD).toBe(2500);
    expect(opened.json().unreadReceipts).toBe(1);
    const file = await call("GET", `/shared/${token}/files/${receipt.id}`);
    expect(file.body).toBe("Receipt original");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(
      (await call("GET", `/shared/${token}/files/${privateFile.id}`))
        .statusCode,
    ).toBe(404);
    await call(
      "PATCH",
      `/events/${first.id}`,
      {
        title: "Changed later",
        service: "Different scope",
        counterparty: "Client",
        currency: "NGN",
        channel: "direct",
      },
      cookie,
    );
    expect((await call("GET", "/shared/" + token)).json().events[0].title).toBe(
      "Selected work",
    );
    const other = await call("POST", "/auth/signup", {
      name: "Other Owner",
      email: "other@example.invalid",
      password: "TwelveCharacters!",
      businessName: "Other Studio",
    });
    const otherCookie = String(other.headers["set-cookie"]).split(";")[0];
    expect(
      (
        await call(
          "POST",
          "/shares",
          { title: "Not mine", eventIds: [first.id] },
          otherCookie,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          "POST",
          `/shares/${created.json().id}/revoke`,
          {},
          otherCookie,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await call("POST", `/shares/${created.json().id}/revoke`, {}, cookie))
        .statusCode,
    ).toBe(200);
    expect((await call("GET", "/shared/" + token)).statusCode).toBe(410);
    expect(
      (await call("GET", `/shared/${token}/files/${receipt.id}`)).statusCode,
    ).toBe(410);
    expect(db.all("SELECT * FROM evidence_shares")).toHaveLength(1);
  } finally {
    await app.close();
  }
});
it("allows account-free confirmation with private optional contacts and sends one notification to the signup email", async () => {
  const sent: any[] = [];
  const { app, db, call, cookie, create, user } = await workspace(
    async (m: any) => {
      sent.push(m);
    },
  );
  try {
    const event = await create("Client-reviewed work");
    const file = (
      await call(
        "POST",
        `/events/${event.id}/evidence`,
        {
          kind: "agreement",
          name: "contract.txt",
          mime: "text/plain",
          base64: Buffer.from("Agreement original").toString("base64"),
        },
        cookie,
      )
    ).json().evidence[0];
    const invite = await call(
      "POST",
      `/events/${event.id}/attestations`,
      {},
      cookie,
    );
    expect(invite.statusCode, invite.body).toBe(200);
    const token = invite.json().path.split("/").pop();
    expect((await call("GET", "/attest/" + token)).json().files[0].id).toBe(
      file.id,
    );
    expect((await call("GET", `/attest/${token}/files/${file.id}`)).body).toBe(
      "Agreement original",
    );
    const verdict = {
      status: "confirmed",
      name: "Client Name",
      email: "client@example.invalid",
      phone: "+234 12345678",
      comment: "Delivered on time",
      reviewConsent: false,
    };
    const responses = await Promise.all([
      call("POST", "/attest/" + token, verdict),
      call("POST", "/attest/" + token, verdict),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const updated = (
      await call("GET", `/events/${event.id}`, undefined, cookie)
    ).json();
    expect(updated.attestations[0].email).toBe(verdict.email);
    expect(updated.attestations[0].notification_status).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].recipient).toBe("owner@example.invalid");
    await deliverNotifications(db, user.businessId, async (m: any) => {
      sent.push(m);
    });
    expect(sent).toHaveLength(1);
    const shared = (
      await call(
        "POST",
        "/shares",
        { title: "After confirmation", eventIds: [event.id] },
        cookie,
      )
    ).json();
    const viewed = (
      await call("GET", "/shared/" + shared.path.split("/").pop())
    ).json();
    expect(JSON.stringify(viewed)).not.toContain(verdict.email);
    expect(JSON.stringify(viewed)).not.toContain(verdict.phone);
    expect(viewed.events[0].confirmations[0].review).toBe("");
    expect(viewed.events[0].confirmations[0].name).toBe("");
    await call(
      "PATCH",
      `/events/${event.id}`,
      {
        title: "New version",
        service: "Design",
        counterparty: "Client",
        currency: "NGN",
        channel: "direct",
      },
      cookie,
    );
    const history = (
      await call("GET", `/events/${event.id}`, undefined, cookie)
    ).json();
    expect(history.attestations[0].revision).toBeLessThan(history.revision);
    expect((await call("GET", "/attest/" + token)).statusCode).toBe(409);
  } finally {
    await app.close();
  }
});
it("saves anonymous verdicts even when notification delivery fails, and retries without losing the response", async () => {
  const { app, db, call, cookie, create, user } = await workspace(async () => {
    throw new Error("Email outage");
  });
  try {
    const event = await create("Anonymous confirmation");
    const invite = (
      await call("POST", `/events/${event.id}/attestations`, {}, cookie)
    ).json();
    const token = invite.path.split("/").pop();
    const response = await call("POST", "/attest/" + token, {
      status: "disputed",
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      (await call("GET", `/events/${event.id}`, undefined, cookie)).json()
        .attestations[0].status,
    ).toBe("disputed");
    expect(db.one("SELECT status FROM notification_outbox").status).toBe(
      "failed",
    );
    let delivered = 0;
    await deliverNotifications(db, user.businessId, async () => {
      delivered++;
    });
    expect(delivered).toBe(1);
    expect(db.one("SELECT status FROM notification_outbox").status).toBe(
      "sent",
    );
  } finally {
    await app.close();
  }
});
