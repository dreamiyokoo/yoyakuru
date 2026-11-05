import { request } from "./api";
import type { AdminBooking, CalendarDay, Me, Options, TimeOff } from "./adminTypes";

const AUTH = "/api/v1/auth";

function cookie(name: string): string {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
}

/** 更新系のリクエストには、DjangoのCSRFトークンを付ける。Cookieがなければ先に発行してもらう。 */
async function mutate<T>(path: string, method: string, body?: unknown): Promise<T> {
  if (!cookie("csrftoken")) await request(`${AUTH}/csrf`);
  return request<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "X-CSRFToken": cookie("csrftoken") },
  });
}

const base = (sub: string) => `/api/v1/admin/tenants/${encodeURIComponent(sub)}`;
const qs = (params: Record<string, string | number | undefined | null>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "") as [string, string][]).toString();

export interface Applied<T> {
  applied: boolean;
  result: T;
  affected_bookings: AdminBooking[];
}

export const adminApi = {
  me: () => request<Me>(`${AUTH}/me`),
  login: (email: string, password: string) => mutate<Me>(`${AUTH}/login`, "POST", { email, password }),
  logout: () => mutate(`${AUTH}/logout`, "POST"),
  options: (sub: string) => request<Options>(`${base(sub)}/options`),
  bookings: (sub: string, dateFrom: string, dateTo: string, staff?: number | null) =>
    request<AdminBooking[]>(`${base(sub)}/bookings?${qs({ date_from: dateFrom, date_to: dateTo, staff })}`),
  booking: (sub: string, id: number) => request<AdminBooking>(`${base(sub)}/bookings/${id}`),
  createBooking: (sub: string, body: Record<string, unknown>) => mutate<AdminBooking>(`${base(sub)}/bookings`, "POST", body),
  cancelBooking: (sub: string, id: number) => mutate<AdminBooking>(`${base(sub)}/bookings/${id}/cancel`, "POST"),
  reschedule: (sub: string, id: number, starts_at: string, staff: number) =>
    mutate<AdminBooking>(`${base(sub)}/bookings/${id}/reschedule`, "POST", { starts_at, staff }),
  availability: (sub: string, p: { service: number; date: string; customer_type: string; staff?: number | null; exclude_booking?: number }) =>
    request<{ slots: { starts_at: string; staff_ids: number[] }[] }>(`${base(sub)}/availability?${qs(p)}`),
  calendar: (sub: string, date: string) => request<CalendarDay>(`${base(sub)}/calendar?${qs({ date })}`),
  timeOffs: (sub: string, from?: string) => request<TimeOff[]>(`${base(sub)}/time-offs?${qs({ from })}`),
  createTimeOff: (sub: string, body: Record<string, unknown>) => mutate<TimeOff>(`${base(sub)}/time-offs`, "POST", body),
  deleteTimeOff: (sub: string, id: number) => mutate(`${base(sub)}/time-offs/${id}`, "DELETE"),
  /** 設定の読み込み（オーナーのみ）。 */
  setting: <T>(sub: string, path: string) => request<T>(`${base(sub)}/settings/${path}`),
  /** 設定の変更。dryRun なら保存せず、影響を受ける予約だけを返す。 */
  changeSetting: <T>(sub: string, path: string, method: string, body: unknown, dryRun: boolean) =>
    mutate<Applied<T>>(`${base(sub)}/settings/${path}${dryRun ? "?dry_run=1" : ""}`, method, body),
};
