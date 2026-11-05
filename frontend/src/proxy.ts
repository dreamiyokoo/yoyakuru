/**
 * Next.js Proxy — ホスト名によるルーティング
 *
 *   dreami.blog              → サービス紹介ページ（x-site: apex）
 *   app.dreami.blog          → 店舗スタッフ用の管理画面（x-site: app）。店舗はログイン後に判定する
 *   {店舗名}.dreami.blog     → 店舗の公開予約ページ（x-site: tenant, x-tenant-subdomain）
 *   admin. / api.            → Cloudflare が Django に直接転送（ここには届かない）
 *
 * BASE_DOMAIN 外のホスト（localhost 等）は apex として扱う。
 */

import { NextRequest, NextResponse } from "next/server";

const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? "dreami.blog";

const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER;
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD;

/** 店舗名として扱わないサブドメイン（backend の RESERVED_SUBDOMAINS と揃える） */
const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "mcp", "admin", "mail", "static", "media"]);

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

export function proxy(request: NextRequest): NextResponse {
  const authResponse = checkBasicAuth(request);
  if (authResponse) return authResponse;

  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const subdomain = hostname.endsWith(`.${BASE_DOMAIN}`)
    ? hostname.slice(0, -`.${BASE_DOMAIN}`.length)
    : null;

  const requestHeaders = new Headers(request.headers);
  // 外部から偽装されたヘッダーを信用しない
  requestHeaders.delete("x-tenant-subdomain");

  if (subdomain === "app") {
    requestHeaders.set("x-site", "app");
  } else if (subdomain && !RESERVED_SUBDOMAINS.has(subdomain)) {
    requestHeaders.set("x-site", "tenant");
    requestHeaders.set("x-tenant-subdomain", subdomain);
  } else if (subdomain) {
    // www 等の予約語はサービス紹介ページへ
    return NextResponse.redirect(new URL(request.nextUrl.pathname, `https://${BASE_DOMAIN}`));
  } else {
    requestHeaders.set("x-site", "apex");
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
