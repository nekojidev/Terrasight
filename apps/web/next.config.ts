import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const dev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy for the web app. Next.js and the theme boot script use inline scripts, so script-src keeps
 * 'unsafe-inline' (a nonce policy needs a middleware and dynamic rendering for every page); what the policy does pin:
 * where images, tiles and fetches may go, no plugins, no framing, no foreign form targets.
 * MapLibre: its worker runs from /maplibre-gl-worker.mjs or a blob; raster tiles come from EOX (Sentinel-2 cloudless)
 * and Microsoft Planetary Computer, fetched by the browser. Open-Meteo is called by the API only, never the browser.
 * Scouting photos upload to / load from the private S3 bucket through presigned URLs (amazonaws.com).
 */
const TILES = ["https://tiles.maps.eox.at", "https://planetarycomputer.microsoft.com", "https://*.blob.core.windows.net"];
const S3 = "https://*.amazonaws.com";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} blob:`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${TILES.join(" ")} ${S3}`,
  "font-src 'self' data:",
  `connect-src 'self' ${TILES.join(" ")} ${S3}${dev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Report-link pages carry the token in the path: other origins only ever see our origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=(), payment=()" },
];

const config: NextConfig = {
  // The web image (infra/web.Dockerfile) runs the traced standalone server: only the files the app needs.
  ...(process.env.NEXT_STANDALONE === "1"
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
      }
    : {}),
  // packages/ui ships TypeScript source.
  transpilePackages: ["@terrasight/ui"],
  // The API runs separately; the browser calls it through this rewrite so cookies stay first-party.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${process.env.API_URL ?? "http://localhost:4000"}/api/:path*` },
    ];
  },
  async headers() {
    // /api/* is proxied: the API sets its own headers there (photos need their own CSP).
    return [{ source: "/((?!api/).*)", headers: securityHeaders }];
  },
  poweredByHeader: false,
};

export default withNextIntl(config);
