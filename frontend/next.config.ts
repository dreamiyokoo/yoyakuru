import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /admin/ は proxy.ts でバックエンドにプロキシするため、
  // Next.js デフォルトの trailing slash 除去 308 リダイレクトを無効化する。
  skipTrailingSlashRedirect: true,
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
