import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

/** Tech Design §14.1: 15-minute access JWT in an httpOnly cookie; opaque refresh token stored hashed. */
export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;
export const ACCESS_COOKIE = "ts_at";
export const REFRESH_COOKIE = "ts_rt";
const ISSUER = "terrasight";
const AUDIENCE = "terrasight-web";

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccess(
  userId: string,
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(nowS)
    .setExpirationTime(nowS + ACCESS_TTL_S)
    .sign(key(secret));
}

/** Returns the user id, or null for a missing, expired or forged token. */
export async function verifyAccess(token: string | undefined, secret: string): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only hashes are stored: a database leak doesn't reveal usable tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
