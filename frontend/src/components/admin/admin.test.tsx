import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "@/lib/adminApi";
import type { AdminBooking, Me } from "@/lib/adminTypes";
import { STORE, mockFetch } from "@/test-utils";
import { AdminProvider } from "./AdminContext";
import { BookingDetailPage } from "./BookingDetailPage";
import { BookingListPage } from "./BookingListPage";
import { LoginPage } from "./LoginPage";
import { NewBookingPage } from "./NewBookingPage";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), pathname: "/bookings" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => nav.pathname,
}));

const ME: Me = {
  email: "owner@example.com",
  name: "院長",
  calendar_connected: true,
  memberships: [{ subdomain: "fushimi", name: "伏見整体院", role: "owner", staff_id: 10, billing_required: false, billing_managed: false }],
};
const OPTIONS = { tenant: { subdomain: "fushimi", name: "伏見整体院" }, role: "owner", staff_id: 10, services: STORE.services, staff: STORE.staff, calendar_issues: [] };
const booking = (over: Partial<AdminBooking> = {}): AdminBooking => ({
  id: 7, status: "confirmed", starts_at: "2026-11-11T10:00:00+09:00", ends_at: "2026-11-11T11:00:00+09:00",
  hold_expires_at: null, service: 1, service_name: "全身調整", staff: 10, staff_name: "Aさん", customer_type: "repeat",
  customer_name: "山田 花子", customer_email: "y@example.com", customer_phone: "", note: "", channel: "web",
  auto_assigned: true, party_size: 1, created_at: "2026-11-05T10:00:00+09:00",
  events: [{ action: "confirmed", channel: "web", actor_name: "", created_at: "2026-11-05T10:00:00+09:00" }], ...over,
});

type Route = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;
function api(route: Route, me: Me | null = ME) {
  return mockFetch((url, init) => {
    if (url.endsWith("/auth/me")) return me ? { body: me } : { status: 403, body: { detail: "ログインしてください" } };
    if (url.endsWith("/auth/csrf")) return { body: {} };
    if (url.endsWith("/options")) return { body: OPTIONS };
    return route(url, init) ?? { status: 404, body: {} };
  });
}
const withAdmin = (ui: React.ReactNode) => render(<AdminProvider>{ui}</AdminProvider>);

beforeEach(() => {
  nav.pathname = "/bookings";
  document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("adminApi", () => {
  it("gets a CSRF cookie before mutating and sends it", async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith("/auth/csrf")) document.cookie = "csrftoken=abc";
      return { body: {} };
    });
    await adminApi.cancelBooking("fushimi", 1);
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/auth/csrf", "/api/v1/admin/tenants/fushimi/bookings/1/cancel"]);
    expect((calls[1].init?.headers as Record<string, string>)["X-CSRFToken"]).toBe("abc");
  });
  it("builds query strings without empty values", async () => {
    const calls = mockFetch(() => ({ body: [] }));
    await adminApi.bookings("fushimi", "2026-11-11", "2026-11-12", null);
    expect(calls[0].url).toBe("/api/v1/admin/tenants/fushimi/bookings?date_from=2026-11-11&date_to=2026-11-12");
  });
});

describe("store that needs payment", () => {
  it("keeps the store switcher so a member can move to another store", async () => {
    localStorage.setItem("yoyakuru.tenant", "komorebi");
    const me: Me = {
      ...ME,
      memberships: [
        { subdomain: "komorebi", name: "こもれび整体院", role: "staff", staff_id: null, billing_required: true, billing_managed: true },
        ME.memberships[0],
      ],
    };
    api((url) => (url.includes("/bookings?") ? { body: [] } : undefined), me);
    withAdmin(<BookingListPage today="2026-11-11" />);
    expect(await screen.findByText(/こもれび整体院 はまだ利用を開始していません/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("店舗"), "fushimi");
    expect(await screen.findByText("この期間の予約はありません")).toBeInTheDocument();
    localStorage.clear();
  });
});

describe("login and session", () => {
  it("redirects to login when signed out", async () => {
    api(() => undefined, null);
    withAdmin(<BookingListPage today="2026-11-11" />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
  });
  it("starts the Google login and moves to Google", async () => {
    nav.pathname = "/login";
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const calls = api((url) => (url.endsWith("/auth/google/start") ? { body: { url: "/accounts/google/login/?process=login" } } : undefined), null);
    const user = userEvent.setup();
    withAdmin(<LoginPage />);
    expect(screen.queryByLabelText("パスワード")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Googleでログイン" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/accounts/google/login/?process=login"));
    const start = calls.find((c) => c.url.endsWith("/auth/google/start"));
    expect(JSON.parse(String(start?.init?.body))).toEqual({ kind: "login" });
  });
  it("explains why the Google login did not complete", () => {
    nav.pathname = "/login";
    api(() => undefined, null);
    withAdmin(<LoginPage error="calendar" />);
    expect(screen.getByText(/カレンダーの権限が許可されていません/)).toBeInTheDocument();
  });
  it("shows a message when the Google login cannot be started", async () => {
    nav.pathname = "/login";
    api((url) => (url.endsWith("/auth/google/start") ? { status: 429, body: { detail: "リクエストが多すぎます" } } : undefined), null);
    withAdmin(<LoginPage />);
    await userEvent.click(screen.getByRole("button", { name: "Googleでログイン" }));
    expect(await screen.findByText("リクエストが多すぎます")).toBeInTheDocument();
  });
  it("logs out and lets the user switch stores", async () => {
    const two: Me = { ...ME, memberships: [...ME.memberships, { subdomain: "kyoto", name: "京都店", role: "staff", staff_id: 11, billing_required: false, billing_managed: false }] };
    const calls = api((url) => (url.includes("/bookings?") ? { body: [] } : url.endsWith("/logout") ? { body: {} } : undefined), two);
    const user = userEvent.setup();
    withAdmin(<BookingListPage today="2026-11-11" />);
    await user.selectOptions(await screen.findByLabelText("店舗"), "kyoto");
    await waitFor(() => expect(calls.some((c) => c.url.includes("/tenants/kyoto/bookings"))).toBe(true));
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
  });
  it("explains when the user belongs to no store", async () => {
    api(() => undefined, { ...ME, memberships: [] });
    withAdmin(<BookingListPage today="2026-11-11" />);
    expect(await screen.findByText(/所属している店舗がありません/)).toBeInTheDocument();
  });
});

describe("bookings", () => {
  it("lists bookings for today and the week", async () => {
    const calls = api((url) => (url.includes("/bookings?") ? { body: url.includes("date_to=2026-11-17") ? [booking({ status: "hold", channel: "phone" })] : [] } : undefined));
    const user = userEvent.setup();
    withAdmin(<BookingListPage today="2026-11-11" />);
    expect(await screen.findByText("この期間の予約はありません")).toBeInTheDocument();
    // 予約がないときは、予約ページのURLを案内する（管理画面と同じドメインの店舗のサブドメイン）
    expect(screen.getByText(/^http:\/\/(fushimi\.)?localhost/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "URLをコピーする" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "今週" }));
    expect(await screen.findByText("仮押さえ")).toBeInTheDocument();
    expect(screen.getByText(/電話（AI）/)).toBeInTheDocument();
    expect(screen.getByText(/11月11日（水） 10:00–11:00/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "明日" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("date_from=2026-11-12"))).toBe(true));
  });

  it("reschedules and cancels a booking", async () => {
    let current = booking();
    const calls = api((url) => {
      if (url.includes("/availability?")) return { body: { slots: [{ starts_at: "2026-11-11T15:00:00+09:00", staff_ids: [10] }] } };
      if (url.endsWith("/reschedule")) {
        current = booking({ starts_at: "2026-11-11T15:00:00+09:00" });
        return { body: current };
      }
      if (url.endsWith("/cancel")) {
        current = booking({ status: "cancelled" });
        return { body: current };
      }
      if (url.endsWith("/bookings/7")) return { body: current };
    });
    const user = userEvent.setup();
    withAdmin(<BookingDetailPage id={7} />);
    await user.click(await screen.findByRole("button", { name: "日時・担当を変更" }));
    await user.click(await screen.findByRole("radio", { name: "15:00" }));
    await user.click(screen.getByRole("button", { name: "変更を保存する" }));
    expect(await screen.findByText(/日時・担当を変更しました/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes("/availability?"))?.url).toContain("exclude_booking=7");
    await user.click(screen.getByRole("button", { name: "予約を取消" }));
    await user.click(screen.getByRole("button", { name: "取消する" }));
    expect(await screen.findByText(/予約を取消しました/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "予約を取消" })).not.toBeInTheDocument());
  });

  it("shows reschedule and cancel errors", async () => {
    api((url) => {
      if (url.includes("/availability?")) return { body: { slots: [{ starts_at: "2026-11-11T15:00:00+09:00", staff_ids: [10] }] } };
      if (url.endsWith("/reschedule")) return { status: 409, body: { message: "その日時・担当では空きがありません" } };
      if (url.endsWith("/cancel")) return { status: 409, body: { message: "この予約は取消できません" } };
      if (url.endsWith("/bookings/7")) return { body: booking() };
    });
    const user = userEvent.setup();
    withAdmin(<BookingDetailPage id={7} />);
    await user.click(await screen.findByRole("button", { name: "日時・担当を変更" }));
    await user.click(await screen.findByRole("radio", { name: "15:00" }));
    await user.click(screen.getByRole("button", { name: "変更を保存する" }));
    expect(await screen.findByText("その日時・担当では空きがありません")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "やめる" }));
    await user.click(screen.getByRole("button", { name: "予約を取消" }));
    await user.click(screen.getByRole("button", { name: "やめる" }));
    await user.click(screen.getByRole("button", { name: "予約を取消" }));
    await user.click(screen.getByRole("button", { name: "取消する" }));
    expect(await screen.findByText("この予約は取消できません")).toBeInTheDocument();
  });

  it("shows a not found booking", async () => {
    api((url) => (url.endsWith("/bookings/9") ? { status: 404, body: { detail: "見つかりません。" } } : undefined));
    withAdmin(<BookingDetailPage id={9} />);
    expect(await screen.findByText("見つかりません。")).toBeInTheDocument();
  });

  it("creates a manual booking", async () => {
    let created = 0;
    const calls = api((url) => {
      if (url.includes("/availability?")) return { body: url.includes("2026-11-12") ? { slots: [] } : { slots: [{ starts_at: "2026-11-11T10:30:00+09:00", staff_ids: [10] }] } };
      if (url.endsWith("/bookings")) {
        created += 1;
        return created === 1 ? { status: 409, body: { message: "選んだ枠は埋まりました" } } : { status: 201, body: booking({ id: 8 }) };
      }
    });
    const user = userEvent.setup();
    withAdmin(<NewBookingPage today="2026-11-11" />);
    await user.click(await screen.findByRole("radio", { name: "初めて" }));
    await user.click(await screen.findByRole("radio", { name: "10:30" }));
    await user.click(screen.getByRole("button", { name: "登録する" }));
    expect(screen.getByText("お名前を入力してください")).toBeInTheDocument();
    await user.type(screen.getByLabelText("お名前"), "電話のお客様");
    await user.click(screen.getByRole("button", { name: "登録する" }));
    expect(await screen.findByText("選んだ枠は埋まりました")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "登録する" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/bookings/8"));
    const sent = JSON.parse(String(calls.filter((c) => c.url.endsWith("/bookings")).at(-1)?.init?.body));
    expect(sent).toMatchObject({ service: 1, staff: 10, customer_type: "first", customer_name: "電話のお客様" });
    await user.selectOptions(screen.getByLabelText("サービス"), "2");
    expect(screen.getByRole("option", { name: "Bさん" })).toBeInTheDocument();
    fireDate(screen.getByLabelText("日付"), "2026-11-12");
    expect(await screen.findByText("この日は空きがありません。")).toBeInTheDocument();
  });
});

function fireDate(input: HTMLElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("calendar connection", () => {
  it("tells the owner which staff are hidden because their calendar is not connected", async () => {
    mockFetch((url) => {
      if (url.endsWith("/auth/me")) return { body: ME };
      if (url.endsWith("/options")) return { body: { ...OPTIONS, calendar_issues: [{ staff_id: 11, name: "Bさん" }] } };
      return { body: [] };
    });
    withAdmin(<BookingListPage today="2026-11-11" />);
    expect(await screen.findByText(/Googleカレンダーが接続されていないため、予約枠が出ていません：Bさん/)).toBeInTheDocument();
  });
  it("tells a staff member to reconnect their own calendar", async () => {
    const staffMe: Me = { ...ME, memberships: [{ ...ME.memberships[0], role: "staff" }] };
    mockFetch((url) => {
      if (url.endsWith("/auth/me")) return { body: staffMe };
      if (url.endsWith("/options")) return { body: { ...OPTIONS, role: "staff", calendar_issues: [{ staff_id: 10, name: "Aさん" }] } };
      return { body: [] };
    });
    withAdmin(<BookingListPage today="2026-11-11" />);
    expect(await screen.findByText(/あなたのGoogleカレンダーの接続が切れている/)).toBeInTheDocument();
  });
});
