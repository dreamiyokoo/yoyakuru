import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ApiError, fetchStore } from "./api";
import type { Store } from "./types";

export const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";

/** proxy.ts が付けたヘッダーから、表示するサイトと店舗名を読む。 */
export async function currentSite(): Promise<{ site: string | null; subdomain: string | null }> {
  const h = await headers();
  return { site: h.get("x-site"), subdomain: h.get("x-tenant-subdomain") };
}

/** 店舗の公開情報。停止中・存在しない店舗は404（TENANT-02）。 */
export async function loadStore(subdomain: string): Promise<Store> {
  try {
    return await fetchStore(subdomain, BACKEND_INTERNAL_URL);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

/** 店舗のサブドメインでのみ表示するページで使う。 */
export async function requireTenant(): Promise<string> {
  const { site, subdomain } = await currentSite();
  if (site !== "tenant" || !subdomain) notFound();
  return subdomain;
}

/** LP に出す料金の表記（バックエンドが Stripe の価格から作る）。取れなければ出さない。 */
export async function planLabel(): Promise<string | undefined> {
  try {
    const res = await fetch(`${BACKEND_INTERNAL_URL}/api/v1/public/plan`, { next: { revalidate: 600 } });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { price_label?: string };
    return body.price_label || undefined;
  } catch {
    return undefined;
  }
}
