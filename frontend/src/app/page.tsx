import { headers } from "next/headers";

const BACKEND_INTERNAL_URL =
  process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";

type TenantInfo = { tenant: string; schema: string; status: string };

async function fetchTenant(host: string): Promise<TenantInfo> {
  const res = await fetch(`${BACKEND_INTERNAL_URL}/`, {
    headers: { "x-forwarded-host": host },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`backend returned ${res.status} for tenant ${host}`);
  }
  return res.json();
}

export default async function Home() {
  const h = await headers();
  const subdomain = h.get("x-tenant-subdomain");

  if (!subdomain) {
    return <h1>Hello, ヨヤクル</h1>;
  }

  const tenant = await fetchTenant(h.get("x-forwarded-host") ?? "");
  return (
    <>
      <h1>Hello, {tenant.tenant}</h1>
      <p>schema: {tenant.schema}</p>
    </>
  );
}
