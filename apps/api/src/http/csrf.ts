import type { NextFunction, Request, Response } from "express";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence (Tech Design §14.1): SameSite=Lax cookies plus a required `X-Requested-With` header on every
 * mutating request. Browsers can't add that header cross-site without a CORS preflight, which we don't allow.
 */
export function requireRequestedWith(req: Request, res: Response, next: NextFunction): void {
  if (SAFE.has(req.method) || !req.path.startsWith("/api/")) return next();
  if (req.get("x-requested-with")) return next();
  res.status(403).type("application/problem+json").json({
    type: "https://terrasight.app/problems/csrf",
    title: "Not allowed",
    status: 403,
    detail: "Missing X-Requested-With header",
  });
}
