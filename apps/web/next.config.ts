import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  // packages/ui ships TypeScript source.
  transpilePackages: ["@terrasight/ui"],
  // The API runs separately; the browser calls it through this rewrite so cookies stay first-party.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${process.env.API_URL ?? "http://localhost:4000"}/api/:path*` },
    ];
  },
  poweredByHeader: false,
};

export default withNextIntl(config);
