import { headers } from "next/headers";
import { notFound } from "next/navigation";

const BACKEND_INTERNAL_URL =
  process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";

type PublicTenant = { name: string; subdomain: string };

async function fetchTenant(subdomain: string): Promise<PublicTenant | null> {
  const res = await fetch(
    `${BACKEND_INTERNAL_URL}/api/v1/public/tenants/${encodeURIComponent(subdomain)}/`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`backend returned ${res.status} for tenant ${subdomain}`);
  }
  return res.json();
}

export default async function Home() {
  const h = await headers();
  const site = h.get("x-site");

  if (site === "app") {
    return <h1>ヨヤクル 管理画面</h1>;
  }

  if (site === "tenant") {
    const tenant = await fetchTenant(h.get("x-tenant-subdomain") ?? "");
    if (!tenant) notFound();
    return <h1>{tenant.name} のご予約</h1>;
  }

  return <h1>Hello, ヨヤクル</h1>;
}
