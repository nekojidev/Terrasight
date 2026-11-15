import type { NextFunction, Request, Response } from "express";

/**
 * Headers for a JSON API: nothing here is meant to be rendered or framed. They don't touch the body, so SSE
 * (text/event-stream) streams are unaffected. HSTS is sent only when asked (production, behind TLS).
 */
export function securityHeaders(opts: { hsts: boolean }) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (opts.hsts) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  };
}
