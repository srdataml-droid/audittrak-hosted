import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";

// Do not start a listener when importing the application into a Function.
process.env.AUDITTRAK_SERVERLESS = "true";
const application = import("../src/server.js").then(async ({ buildServer }) => {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required on Vercel.");
  const app = buildServer();
  await app.ready();
  return app;
});
void application.catch(() => {});

export function createHandler(application: Promise<FastifyInstance>) {
  return async function handler(
    request: IncomingMessage & { body?: unknown },
    response: ServerResponse,
  ) {
    try {
      const app = await application;
      let payload: string | Buffer | undefined;
      if (!["GET", "HEAD"].includes(request.method ?? "GET")) {
        if (request.body !== undefined) {
          payload =
            typeof request.body === "string" || Buffer.isBuffer(request.body)
              ? request.body
              : JSON.stringify(request.body);
        } else {
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of request) {
            const bytes = Buffer.from(chunk);
            length += bytes.length;
            if (length > 4_400_000) {
              response.statusCode = 413;
              response.end("Request too large");
              return;
            }
            chunks.push(bytes);
          }
          payload = Buffer.concat(chunks);
        }
      }
      const headers = { ...request.headers };
      delete headers["content-length"];
      delete headers["transfer-encoding"];
      const result = await app.inject({
        method: request.method as any,
        url: request.url ?? "/",
        headers,
        payload,
        remoteAddress: request.socket.remoteAddress,
      });
      response.statusCode = result.statusCode;
      for (const [key, value] of Object.entries(result.headers)) {
        if (
          value !== undefined &&
          !["connection", "transfer-encoding"].includes(key)
        )
          response.setHeader(key, value);
      }
      response.end(result.rawPayload);
    } catch (error) {
      console.error("AuditTrak Function failed", error);
      response.statusCode = 503;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          error:
            "AuditTrak is temporarily unavailable. Check the database configuration.",
        }),
      );
    }
  };
}

export default createHandler(application);
