import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "@/lib/adminApi";
import type { AdminBooking, Me } from "@/lib/adminTypes";
import { STORE, mockFetch } from "@/test-utils";
import { AdminProvider } from "./AdminContext";
import { BookingDetailPage } from "./BookingDetailPage";
import { BookingListPage } from "./BookingListPage";
import { CalendarPage, minutesOnDay } from "./CalendarPage";
import { LoginPage } from "./LoginPage";
import { NewBookingPage } from "./NewBookingPage";
import { TimeOffPage } from "./TimeOffPage";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), pathname: "/bookings" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => nav.pathname,
}));

const ME: Me = { two_factor_enabled: true, two_factor_required: true,
  email: "owner@example.com",
  name: "院長",
  memberships: [{ subdomain: "fushimi", name: "伏見整体院", role: "owner", staff_id: 10, billing_required: false, billing_managed: false }],
};
const OPTIONS = { tenant: { subdomain: "fushimi", name: "伏見整体院" }, role: "owner", staff_id: 10, services: STORE.services, staff: STORE.staff };
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
    await adminApi.deleteTimeOff("fushimi", 2);
    expect(calls.map((c) => c.url)).toEqual([
      "/api/v1/auth/csrf",
      "/api/v1/admin/tenants/fushimi/bookings/1/cancel",
      "/api/v1/admin/tenants/fushimi/time-offs/2",
    ]);
    expect((calls[1].init?.headers as Record<string, string>)["X-CSRFToken"]).toBe("abc");
  });
  it("builds query strings without empty values", async () => {
    const calls = mockFetch(() => ({ body: [] }));
    await adminApi.bookings("fushimi", "2026-11-11", "2026-11-12", null);
    await adminApi.timeOffs("fushimi");
    expect(calls[0].url).toBe("/api/v1/admin/tenants/fushimi/bookings?date_from=2026-11-11&date_to=2026-11-12");
    expect(calls[1].url).toBe("/api/v1/admin/tenants/fushimi/time-offs?");
  });
});

describe("login and session", () => {
  it("redirects to login when signed out", async () => {
    api(() => undefined, null);
    withAdmin(<BookingListPage today="2026-11-11" />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
  });
  it("logs in and goes to bookings", async () => {
    nav.pathname = "/login";
    let attempts = 0;
    api((url) => {
      if (url.endsWith("/auth/login")) {
        attempts += 1;
        return attempts === 1 ? { status: 400, body: { message: "メールアドレスかパスワードが違います" } } : { body: ME };
      }
    }, null);
    const user = userEvent.setup();
    withAdmin(<LoginPage />);
    await user.type(screen.getByLabelText("メールアドレス"), "owner@example.com");
    await user.type(screen.getByLabelText("パスワード"), "pw");
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(await screen.findByText("メールアドレスかパスワードが違います")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/bookings"));
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
    expect(await screen.findByText("この期間の予約はありません。")).toBeInTheDocument();
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

describe("calendar and time off", () => {
  it("clips blocks to the displayed day", () => {
    // 前日15時〜当日17時の休みは、当日は表示開始（9時）から17時まで
    expect(minutesOnDay("2026-11-10T15:00:00+09:00", "2026-11-11")).toBe(0);
    expect(minutesOnDay("2026-11-11T17:00:00+09:00", "2026-11-11")).toBe(8 * 60);
    // 当日0時〜翌日0時は、表示範囲（9〜21時）いっぱい
    expect(minutesOnDay("2026-11-12T00:00:00+09:00", "2026-11-11")).toBe(12 * 60);
    expect(minutesOnDay("2026-11-11T10:30:00+09:00", "2026-11-11")).toBe(90);
  });

  it("shows the day with staff columns, breaks and time off", async () => {
    const calls = api((url) =>
      url.includes("/calendar?")
        ? {
            body: {
              date: "2026-11-11",
              staff: [{ id: 10, display_name: "Aさん" }, { id: 11, display_name: "Bさん" }],
              bookings: [booking(), booking({ id: 8, staff: 11, status: "hold" })],
              breaks: [{ staff: null, starts_at: "2026-11-11T13:00:00+09:00", ends_at: "2026-11-11T14:00:00+09:00" }],
              time_offs: [{ id: 1, staff: 11, staff_name: "Bさん", starts_at: "2026-11-11T15:00:00+09:00", ends_at: "2026-11-11T16:00:00+09:00", reason: "" }],
            },
          }
        : undefined,
    );
    const user = userEvent.setup();
    withAdmin(<CalendarPage today="2026-11-11" />);
    expect(await screen.findByLabelText("山田 花子 確定")).toBeInTheDocument();
    expect(screen.getByLabelText("山田 花子 仮押さえ")).toBeInTheDocument();
    expect(screen.getAllByLabelText("休憩")).toHaveLength(2);
    expect(screen.getByLabelText("予約不可")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "翌日 ›" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("date=2026-11-12"))).toBe(true));
    await user.click(screen.getByRole("button", { name: "‹ 前日" }));
    await user.click(screen.getByRole("button", { name: "今日" }));
    expect(screen.getByRole("heading", { name: "11月11日（水）" })).toBeInTheDocument();
  });

  it("adds time off, shows affected bookings and deletes", async () => {
    let deletes = 0;
    let list = [{ id: 1, staff: 10, staff_name: "Aさん", starts_at: "2026-11-11T15:00:00+09:00", ends_at: "2026-11-11T17:00:00+09:00", reason: "私用" }];
    const calls = api((url, init) => {
      if (url.includes("/time-offs?")) return { body: list };
      if (url.endsWith("/time-offs") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (body.starts_at >= body.ends_at) return { status: 400, body: { non_field_errors: ["x"] } };
        return { status: 201, body: { ...list[0], id: 2, affected_bookings: [booking()] } };
      }
      if (url.includes("/time-offs/") && init?.method === "DELETE") {
        deletes += 1;
        if (deletes === 1) return { status: 403, body: { detail: "スタッフは自分の分だけ操作できます" } };
        list = [];
        return { status: 204, body: {} };
      }
    });
    const user = userEvent.setup();
    withAdmin(<TimeOffPage today="2026-11-11" />);
    expect(await screen.findByText(/（私用）/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("担当"), "all");
    await user.selectOptions(screen.getByLabelText("終了"), "15:00");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(await screen.findByText("通信に失敗しました。時間をおいて、もう一度お試しください。")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("終了"), "17:00");
    await user.type(screen.getByLabelText("理由（任意・お客様には表示されません）"), "研修");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(await screen.findByText("影響を受ける予約：1件")).toBeInTheDocument();
    const posted = JSON.parse(String(calls.filter((c) => c.init?.method === "POST" && c.url.endsWith("/time-offs")).at(-1)?.init?.body));
    expect(posted).toMatchObject({ staff: null, starts_at: "2026-11-11T15:00:00+09:00", reason: "研修" });
    await user.click(screen.getAllByRole("button", { name: /の登録を削除/ })[0]);
    expect(await screen.findByText("スタッフは自分の分だけ操作できます")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /の登録を削除/ })[0]);
    expect(await screen.findByText("登録はありません。")).toBeInTheDocument();
  });
});
