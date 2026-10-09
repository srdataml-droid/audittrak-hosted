import { it, expect } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { buildServer } from "../src/server.js";
import { MvpDatabase } from "../src/mvp/db.js";
import { createHandler } from "../api/index.js";

it("serves UI, API, cookies and streamed JSON through the Vercel handler", async () => {
  const app = buildServer({ database: new MvpDatabase(":memory:") });
  await app.ready();
  const handler = createHandler(Promise.resolve(app));
  const server = createServer((req, res) => void handler(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    expect((await fetch(url + "/")).status).toBe(200);
    expect((await (await fetch(url + "/health")).json()).status).toBe("ok");
    const signup = await fetch(url + "/api/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: url },
      body: JSON.stringify({
        name: "Hosted Test",
        email: "hosted@example.com",
        password: "TwelveCharacters!",
        businessName: "Hosted Studio",
      }),
    });
    expect(signup.status).toBe(200);
    const cookie = signup.headers.get("set-cookie")!.split(";")[0];
    const saved = await fetch(url + "/api/v1/events", { headers: { cookie } });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual([]);
    const missing = await fetch(url + "/api/v1/events");
    expect(missing.status).toBe(401);
    const seed = await fetch(url + "/api/v1/demo/seed", {
      method: "POST",
      headers: { cookie, origin: url },
    });
    expect(seed.status).toBe(200);
    const events = await (
      await fetch(url + "/api/v1/events", { headers: { cookie } })
    ).json();
    const invite = await fetch(
      url + `/api/v1/events/${events[0].id}/attestations`,
      {
        method: "POST",
        headers: { cookie, origin: url, "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(invite.status).toBe(200);
    const token = (await invite.json()).path.split("/").pop();
    expect((await fetch(url + `/confirm/${token}`)).status).toBe(200);
    const evidence = await (
      await fetch(url + `/api/v1/attest/${token}`)
    ).json();
    expect(evidence.files.length).toBeGreaterThan(0);
    expect(
      (
        await fetch(
          url + `/api/v1/attest/${token}/files/${evidence.files[0].id}`,
        )
      ).status,
    ).toBe(200);
    const confirmed = await fetch(url + `/api/v1/attest/${token}`, {
      method: "POST",
      headers: { origin: url, "content-type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    expect(confirmed.status).toBe(200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await app.close();
  }
});
