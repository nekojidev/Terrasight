import { stdSerializers } from "pino";

/** Routes that carry a secret in the path: the segment right after the prefix is replaced. */
const TOKEN_PATHS: RegExp[] = [
  /^(\/api\/r\/)[^/?#]+/,
  /^(\/api\/auth\/setup\/)[^/?#]+/,
  /^(\/api\/auth\/verify\/)[^/?#]+/,
  /^(\/api\/auth\/reset\/)[^/?#]+/,
  /^(\/api\/invitations\/)[^/?#]+/,
];

/** A request URL that is safe to log: no query string (signed photo `sig`/`exp`) and no token in the path. */
export function redactUrl(url: string | undefined): string {
  if (!url) return "";
  const q = url.search(/[?#]/);
  let path = q === -1 ? url : url.slice(0, q);
  for (const re of TOKEN_PATHS) path = path.replace(re, "$1[redacted]");
  return path;
}

/** pino-http `req` serializer: the standard shape with a redacted url. */
export function reqSerializer(req: unknown): Record<string, unknown> {
  const o = stdSerializers.req(req as never) as unknown as Record<string, unknown>;
  o.url = redactUrl(String(o.url ?? ""));
  return o;
}
