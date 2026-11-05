/**
 * Next.js Proxy — サブドメイン判定によるルーティング
 *
 *   dreami.blog              → apex（サービス紹介ページ）
 *   admin.dreami.blog        → Cloudflare が Django に直接転送（ここには届かない）
 *   {subdomain}.dreami.blog  → テナントのサイト
 *
 * /admin/, /static/, /media/ はバックエンドへ直接プロキシする。
 * next.config.ts の rewrites ではなくここで処理することで、
 * Next.js の trailing slash 正規化（308）によるリダイレクトループを避ける。
 */

import { NextRequest, NextResponse } from "next/server";

const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? "dreami.blog";
const BACKEND_INTERNAL_URL =
  process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";

const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER;
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD;

/** BASIC_AUTH_USER / BASIC_AUTH_PASSWORD が両方セットされている場合のみ有効 */
function checkBasicAuth(request: NextRequest): NextResponse | null {
  if (!BASIC_AUTH_USER || !BASIC_AUTH_PASSWORD) return null;

  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = authorization.split(" ");

  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const [user, ...rest] = decoded.split(":");
    if (user === BASIC_AUTH_USER && rest.join(":") === BASIC_AUTH_PASSWORD) {
      return null;
    }
  }

  return new NextResponse("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Secure Area"' },
  });
}

const BACKEND_PATHS = ["/admin", "/static", "/media"];

export function proxy(request: NextRequest): NextResponse {
  const authResponse = checkBasicAuth(request);
  if (authResponse) return authResponse;

  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const pathname = request.nextUrl.pathname;

  const subdomain = hostname.endsWith(`.${BASE_DOMAIN}`)
    ? hostname.slice(0, -`.${BASE_DOMAIN}`.length)
    : null;

  const requestHeaders = new Headers(request.headers);
  if (subdomain && subdomain !== "admin") {
    // バックエンドの TenantMainMiddleware が X-Forwarded-Host でテナントを解決する
    requestHeaders.set("x-tenant-subdomain", subdomain);
    requestHeaders.set("x-forwarded-host", hostname);
  }
  if (hostname === BASE_DOMAIN) {
    requestHeaders.set("x-apex", "true");
  }

  const isBackendPath = BACKEND_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isBackendPath) {
    const backendUrl = new URL(
      pathname + request.nextUrl.search,
      BACKEND_INTERNAL_URL,
    );
    return NextResponse.rewrite(backendUrl, {
      request: { headers: requestHeaders },
    });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
