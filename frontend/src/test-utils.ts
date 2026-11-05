import { vi } from "vitest";
import type { Store } from "@/lib/types";

export const STORE: Store = {
  subdomain: "fushimi",
  name: "伏見整体院",
  phone: "075-000-0000",
  address: "京都市伏見区",
  slot_interval_minutes: 30,
  booking_window_days: 60,
  services: [
    { id: 1, name: "全身調整", category: "", description: "", price: 5000, duration_minutes: 60, first_visit_duration_minutes: 90, capacity: 1 },
    { id: 2, name: "骨盤矯正", category: "", description: "", price: null, duration_minutes: 45, first_visit_duration_minutes: null, capacity: 1 },
  ],
  staff: [
    { id: 10, display_name: "Aさん", title: "院長", service_ids: [1, 2] },
    { id: 11, display_name: "Bさん", title: "", service_ids: [2] },
  ],
};

export const slot = (hm: string, day = "2026-11-11") => ({
  starts_at: `${day}T${hm}:00+09:00`,
  ends_at: `${day}T${hm}:00+09:00`,
  staff_ids: [10],
});

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

/** fetch を差し替え、呼び出しを記録する。 */
export function mockFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const { status = 200, body } = await handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}
