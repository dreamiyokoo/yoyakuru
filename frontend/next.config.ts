import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
