import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const SANE = /^[A-Za-z0-9._-]{8,64}$/;

/** pino-http `genReqId`: keep a caller-supplied X-Request-Id when it looks sane, else generate one; echo it back. */
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers["x-request-id"];
  const id = typeof incoming === "string" && SANE.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", id);
  return id;
}
