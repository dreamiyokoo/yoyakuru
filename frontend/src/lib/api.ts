import type { HoldRequest, PublicBooking, Slot, Store } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const FALLBACK_MESSAGE = "通信に失敗しました。時間をおいて、もう一度お試しください。";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "network", FALLBACK_MESSAGE);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.message === "string" ? body.message : FALLBACK_MESSAGE;
    throw new ApiError(res.status, typeof body?.code === "string" ? body.code : "error", message);
  }
  return body as T;
}

const PUBLIC = "/api/v1/public";

export function fetchStore(subdomain: string, base = ""): Promise<Store> {
  return request<Store>(`${base}${PUBLIC}/tenants/${encodeURIComponent(subdomain)}/`, { cache: "no-store" });
}

export function fetchAvailability(
  slug: string,
  params: { service: number; date: string; customer_type: string; staff?: number | null },
): Promise<{ date: string; slots: Slot[] }> {
  const q = new URLSearchParams({ service: String(params.service), date: params.date, customer_type: params.customer_type });
  if (params.staff) q.set("staff", String(params.staff));
  return request(`${PUBLIC}/tenants/${encodeURIComponent(slug)}/availability?${q}`);
}

export function createHold(slug: string, body: HoldRequest): Promise<PublicBooking> {
  return request(`${PUBLIC}/tenants/${encodeURIComponent(slug)}/bookings`, { method: "POST", body: JSON.stringify(body) });
}

export function confirmBooking(token: string): Promise<PublicBooking> {
  return request(`${PUBLIC}/bookings/confirm`, { method: "POST", body: JSON.stringify({ token }) });
}

export function fetchBooking(token: string): Promise<PublicBooking> {
  return request(`${PUBLIC}/bookings/${encodeURIComponent(token)}`);
}

export function cancelBooking(token: string): Promise<PublicBooking> {
  return request(`${PUBLIC}/bookings/${encodeURIComponent(token)}/cancel`, { method: "POST" });
}

export function icsUrl(token: string): string {
  return `${PUBLIC}/bookings/${encodeURIComponent(token)}/ics`;
}
