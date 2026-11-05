import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // dreami.blog サブドメイン経由のアクセスで HMR WebSocket を許可する
  allowedDevOrigins: ["dreami.blog", "*.dreami.blog"],
  async rewrites() {
    const apiBase = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
