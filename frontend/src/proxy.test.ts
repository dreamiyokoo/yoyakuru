// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(env: Record<string, string> = {}) {
  vi.stubEnv("NEXT_PUBLIC_BASE_DOMAIN", "yoyakuru.test");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return (await import("./proxy")).proxy;
}

const req = (host: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://${host}/`, { headers: { host, ...headers } });

const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

describe("proxy", () => {
  it("routes by host name", async () => {
    const proxy = await load();
    expect(forwarded(proxy(req("fushimi.yoyakuru.test:3000")), "x-site")).toBe("tenant");
    expect(forwarded(proxy(req("fushimi.yoyakuru.test")), "x-tenant-subdomain")).toBe("fushimi");
    expect(forwarded(proxy(req("app.yoyakuru.test")), "x-site")).toBe("app");
    expect(forwarded(proxy(req("localhost:3000")), "x-site")).toBe("apex");
    expect(proxy(req("www.yoyakuru.test")).status).toBe(307);
  });
  it("does not trust a spoofed tenant header", async () => {
    const proxy = await load();
    const res = proxy(req("localhost", { "x-tenant-subdomain": "evil" }));
    expect(forwarded(res, "x-tenant-subdomain")).toBeNull();
  });
  it("requires basic auth when configured", async () => {
    const proxy = await load({ BASIC_AUTH_USER: "u", BASIC_AUTH_PASSWORD: "p:w" });
    expect(proxy(req("localhost")).status).toBe(401);
    expect(proxy(req("localhost", { authorization: "Basic bad" })).status).toBe(401);
    const ok = proxy(req("localhost", { authorization: `Basic ${Buffer.from("u:p:w").toString("base64")}` }));
    expect(ok.status).toBe(200);
  });
});
