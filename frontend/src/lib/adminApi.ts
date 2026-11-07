import { request } from "./api";
import type { AdminBooking, Billing, Me, Options, Role } from "./adminTypes";

const AUTH = "/api/v1/auth";

function cookie(name: string): string {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
}

/** 更新系のリクエストには、DjangoのCSRFトークンを付ける。Cookieがなければ先に発行してもらう。 */
async function mutate<T>(path: string, method: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  if (!cookie("csrftoken")) await request(`${AUTH}/csrf`);
  return request<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "X-CSRFToken": cookie("csrftoken"), ...headers },
  });
}

const base = (sub: string) => `/api/v1/admin/tenants/${encodeURIComponent(sub)}`;
const qs = (params: Record<string, string | number | undefined | null>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "") as [string, string][]).toString();

export interface Member {
  id: number;
  email: string;
  name: string;
  role: Role;
  staff: number | null;
  staff_name: string;
  is_active: boolean;
  calendar_connected: boolean;
}

export interface Invitation {
  id: number;
  email: string;
  role: Role;
  staff: number | null;
  staff_name: string;
  state: "open" | "accepted" | "revoked" | "expired";
  expires_at: string;
}

export interface Applied<T> {
  applied: boolean;
  result: T;
  affected_bookings: AdminBooking[];
}

export const adminApi = {
  me: () => request<Me>(`${AUTH}/me`),
  /** Googleの認証を始める前に、目的（ログイン・新規登録・招待の受け入れ）を預ける。返ったURLへ移ると、Googleの認証が始まる。 */
  googleStart: (body: { kind: "login" } | { kind: "signup"; store_name: string; subdomain: string } | { kind: "invite"; token: string }) =>
    mutate<{ url: string }>(`${AUTH}/google/start`, "POST", body),
  billing: (sub: string, checkoutSession?: string | null) =>
    request<Billing>(`${base(sub)}/billing?${qs({ checkout_session: checkoutSession })}`),
  checkout: (sub: string) => mutate<{ url: string }>(`${base(sub)}/billing/checkout`, "POST"),
  billingPortal: (sub: string) => mutate<{ url: string }>(`${base(sub)}/billing/portal`, "POST"),
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
  /** メンバーの招待・停止（オーナーのみ、ADMIN-03）。 */
  invite: (sub: string, body: { email: string; role: string; staff: number | null; new_staff_name: string }) =>
    mutate<Invitation>(`${base(sub)}/settings/invitations`, "POST", body),
  revokeInvitation: (sub: string, id: number) => mutate<Invitation>(`${base(sub)}/settings/invitations/${id}`, "DELETE"),
  setMemberActive: (sub: string, id: number, is_active: boolean) => mutate<Member>(`${base(sub)}/settings/members/${id}`, "PATCH", { is_active }),
  /** 招待の内容の確認（ログイン不要）。参加はGoogleでログインして行う。 */
  invitation: (token: string) =>
    request<{ tenant: string; email: string; role: Role; staff_name: string }>(`${AUTH}/invitations/${encodeURIComponent(token)}`),
  /** 設定の読み込み（オーナーのみ）。 */
  setting: <T>(sub: string, path: string) => request<T>(`${base(sub)}/settings/${path}`),
  /** 店舗の様子から設定案を作る（保存はしない）。 */
  setupAssistant: (sub: string, message: string, history: { role: string; content: string }[]) =>
    mutate<{ available: boolean; reply: string; steps: { label: string; path: string; method: string; body: unknown; ref?: string }[]; notes: string[] }>(
      `${base(sub)}/settings/assistant`,
      "POST",
      { message, history },
    ),
  /** 設定の変更。dryRun なら保存せず、影響を受ける予約だけを返す。 */
  changeSetting: <T>(sub: string, path: string, method: string, body: unknown, dryRun: boolean, source?: "ai") =>
    mutate<Applied<T>>(`${base(sub)}/settings/${path}${dryRun ? "?dry_run=1" : ""}`, method, body, source ? { "X-Setting-Source": source } : {}),
};
