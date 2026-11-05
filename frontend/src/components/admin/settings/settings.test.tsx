import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminBooking, Me } from "@/lib/adminTypes";
import { mockFetch } from "@/test-utils";
import { AdminProvider } from "../AdminContext";
import { SettingsPage } from "./SettingsPage";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings",
}));

const owner: Me = { email: "o@example.com", name: "院長", memberships: [{ subdomain: "fushimi", name: "伏見整体院", role: "owner", staff_id: 10 }] };
const staffMe: Me = { ...owner, memberships: [{ ...owner.memberships[0], role: "staff", staff_id: 11 }] };

const affected: AdminBooking = {
  id: 7, status: "confirmed", starts_at: "2026-11-11T10:00:00+09:00", ends_at: "2026-11-11T11:00:00+09:00", hold_expires_at: null,
  service: 1, service_name: "全身調整", staff: 10, staff_name: "Aさん", customer_type: "repeat", customer_name: "山田 花子",
  customer_email: "", customer_phone: "", note: "", channel: "web", auto_assigned: false, party_size: 1, created_at: "2026-11-05T10:00:00+09:00",
};

type Call = { path: string; method: string; dry: boolean; body: unknown };

/** 設定APIの簡易な偽物。dry_run で影響を返すパスを指定できる。 */
function backend({ affects = [] as string[], fail = "", me = owner } = {}) {
  const writes: Call[] = [];
  const db = {
    store: { name: "伏見整体院", phone: "075", address: "", slot_interval_minutes: 30, booking_window_days: 60, same_day_cutoff_minutes: 60, cancel_deadline_days: 1, default_buffer_minutes: 0 },
    hours: [{ weekday: 0, opens_at: "10:00:00", closes_at: "20:00:00" }],
    breaks: [{ id: 1, staff: null, weekday: null, starts_at: "13:00:00", ends_at: "14:00:00" }, { id: 2, staff: 10, weekday: 2, starts_at: "15:00:00", ends_at: "15:30:00" }],
    "date-overrides?from=2026-11-05": [{ id: 3, date: "2026-12-31", is_closed: true, opens_at: null, closes_at: null, note: "年末" }, { id: 4, date: "2026-11-23", is_closed: false, opens_at: "10:00:00", closes_at: "15:00:00", note: "" }],
    resources: [{ id: 5, name: "ベッド", quantity: 2 }],
    services: [
      { id: 1, name: "全身調整", category: "", description: "", price: 5000, duration_minutes: 60, first_visit_duration_minutes: 90, buffer_before_minutes: 0, buffer_after_minutes: 10, staff: [10], resource: 5, resource_quantity: 1, capacity: 1, is_active: true, sort_order: 0 },
      { id: 2, name: "ヨガ", category: "", description: "", price: null, duration_minutes: 60, first_visit_duration_minutes: null, buffer_before_minutes: 0, buffer_after_minutes: 0, staff: [], resource: null, resource_quantity: 1, capacity: 8, is_active: false, sort_order: 1 },
    ],
    staff: [{ id: 10, display_name: "Aさん", title: "院長", priority: 1, is_active: true }, { id: 11, display_name: "Bさん", title: "", priority: 2, is_active: false }],
    "staff/10/shifts": { weekly: [{ weekday: 0, starts_at: "10:00:00", ends_at: "19:00:00" }], exceptions: [{ id: 9, date: "2026-11-20", is_off: true, starts_at: null, ends_at: null }, { id: 8, date: "2026-11-21", is_off: false, starts_at: "10:00:00", ends_at: "15:00:00" }, { id: 6, date: "2026-01-01", is_off: true, starts_at: null, ends_at: null }] },
  } as Record<string, unknown>;
  const calls = mockFetch((url, init) => {
    if (url.endsWith("/auth/me")) return { body: me };
    if (url.endsWith("/auth/csrf")) {
      document.cookie = "csrftoken=t";
      return { body: {} };
    }
    const [path, query] = url.replace(/^.*\/settings\//, "").split("?dry_run=");
    const method = init?.method ?? "GET";
    if (method === "GET") return path in db ? { body: db[path] } : { status: 404, body: { detail: "ありません" } };
    if (path === fail) return { status: 400, body: { detail: "入力を確認してください" } };
    const dry = query === "1";
    writes.push({ path, method, dry, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return { body: { applied: !dry, result: {}, affected_bookings: affects.includes(path) ? [affected] : [] } };
  });
  return { calls, writes: () => writes.filter((w) => !w.dry) };
}

function renderAs(_me: Me = owner) {
  return render(
    <AdminProvider>
      <SettingsPage today="2026-11-05" />
    </AdminProvider>,
  );
  void _me;
}

beforeEach(() => {
  document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const openTab = async (name: string) => {
  await userEvent.click(await screen.findByRole("tab", { name }));
};

describe("settings", () => {
  it("is for owners only", async () => {
    mockFetch((url) => (url.endsWith("/auth/me") ? { body: staffMe } : { status: 403, body: {} }));
    renderAs(staffMe);
    expect(await screen.findByText("設定はオーナーのみ変更できます。")).toBeInTheDocument();
  });

  it("saves booking rules", async () => {
    const be = backend({ fail: "" });
    renderAs();
    await openTab("予約ルール");
    const name = await screen.findByLabelText("店舗名");
    await userEvent.clear(name);
    await userEvent.type(name, "伏見整体");
    await userEvent.click(screen.getByRole("radio", { name: "15分" }));
    await userEvent.selectOptions(screen.getByLabelText("当日の受付締切"), "1440");
    await userEvent.selectOptions(screen.getByLabelText("お客様による取消の締切"), "2");
    await userEvent.clear(screen.getByLabelText("何日先まで受け付けるか（日）"));
    await userEvent.type(screen.getByLabelText("何日先まで受け付けるか（日）"), "90");
    for (const label of ["電話番号", "住所", "準備時間の既定値（分）"]) await userEvent.type(screen.getByLabelText(label), "1");
    await userEvent.click(screen.getByRole("button", { name: "保存する" }));
    expect(await screen.findByText("保存しました。")).toBeInTheDocument();
    expect(be.writes()[0]).toMatchObject({ path: "store", method: "PUT", body: { name: "伏見整体", slot_interval_minutes: 15, same_day_cutoff_minutes: 1440, cancel_deadline_days: 2, booking_window_days: 90 } });
  });

  it("shows load errors", async () => {
    mockFetch((url) => (url.endsWith("/auth/me") ? { body: owner } : { status: 500, body: { detail: "失敗しました" } }));
    renderAs();
    await openTab("予約ルール");
    expect(await screen.findByText("失敗しました")).toBeInTheDocument();
    for (const tab of ["サービス", "担当者", "設備"]) {
      await openTab(tab);
      expect(await screen.findByText("失敗しました")).toBeInTheDocument();
    }
  });

  it("confirms an hours change that affects bookings, or goes back", async () => {
    const be = backend({ affects: ["hours"] });
    renderAs();
    await openTab("営業時間");
    await userEvent.click(await screen.findByRole("checkbox", { name: "火" }));
    await userEvent.selectOptions(screen.getByLabelText("月曜の開始"), "09:00");
    await userEvent.selectOptions(screen.getByLabelText("月曜の終了"), "18:00");
    await userEvent.selectOptions(screen.getByLabelText("火曜の開始"), "11:00");
    await userEvent.selectOptions(screen.getByLabelText("火曜の終了"), "19:00");
    await userEvent.click(screen.getByRole("checkbox", { name: "火" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "水" }));
    await userEvent.click(screen.getByRole("button", { name: "営業時間を保存する" }));
    const dialog = await screen.findByRole("dialog", { name: "変更前の確認" });
    expect(within(dialog).getByText(/山田 花子様/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "戻る" }));
    expect(be.writes()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "営業時間を保存する" }));
    await userEvent.click(await screen.findByRole("button", { name: "変更を保存する" }));
    expect(await screen.findByText("保存しました。影響を受ける予約が1件あります。")).toBeInTheDocument();
    expect(be.writes()[0].body).toEqual([
      { weekday: 0, opens_at: "09:00", closes_at: "18:00" },
      { weekday: 2, opens_at: "10:00", closes_at: "20:00" },
    ]);
  });

  it("adds and deletes breaks and date overrides", async () => {
    const be = backend();
    renderAs();
    await openTab("営業時間");
    expect(await screen.findByText("全員・毎日 13:00〜14:00")).toBeInTheDocument();
    expect(screen.getByText("Aさん・水曜 15:00〜15:30")).toBeInTheDocument();
    expect(screen.getByText(/休業（年末）/)).toBeInTheDocument();
    expect(screen.getByText(/営業 10:00〜15:00/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("休憩の対象"), "10");
    await userEvent.selectOptions(screen.getByLabelText("休憩の曜日"), "4");
    await userEvent.selectOptions(screen.getByLabelText("休憩の開始"), "12:00");
    await userEvent.selectOptions(screen.getByLabelText("休憩の終了"), "12:30");
    await userEvent.click(screen.getByRole("button", { name: "休憩を追加" }));
    await waitFor(() => expect(be.writes()).toHaveLength(1));
    await userEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    await waitFor(() => expect(be.writes()).toHaveLength(2));
    await userEvent.selectOptions(screen.getByLabelText("休業か営業か"), "open");
    await userEvent.selectOptions(screen.getByLabelText("特別営業の開始"), "11:00");
    await userEvent.selectOptions(screen.getByLabelText("特別営業の終了"), "16:00");
    await userEvent.type(screen.getByLabelText("メモ（任意）"), "祝日");
    await userEvent.clear(screen.getByLabelText("日付"));
    await userEvent.type(screen.getByLabelText("日付"), "2026-11-03");
    await userEvent.click(screen.getByRole("button", { name: "臨時休業・特別営業を追加" }));
    await waitFor(() => expect(be.writes()).toHaveLength(3));
    await userEvent.click(screen.getAllByRole("button", { name: "削除" })[2]);
    await waitFor(() => expect(be.writes()).toHaveLength(4));
    expect(be.writes().map((w) => [w.path, w.method])).toEqual([
      ["breaks", "POST"],
      ["breaks/1", "DELETE"],
      ["date-overrides", "POST"],
      ["date-overrides/3", "DELETE"],
    ]);
    expect(be.writes()[0].body).toEqual({ staff: 10, weekday: 4, starts_at: "12:00", ends_at: "12:30" });
    expect(be.writes()[2].body).toEqual({ date: "2026-11-03", is_closed: false, opens_at: "11:00", closes_at: "16:00", note: "祝日" });
  });

  it("shows save errors", async () => {
    backend({ fail: "breaks" });
    renderAs();
    await openTab("営業時間");
    await userEvent.click(await screen.findByRole("button", { name: "休憩を追加" }));
    expect(await screen.findByText("入力を確認してください")).toBeInTheDocument();
  });

  it("edits and adds services", async () => {
    const be = backend();
    renderAs();
    await openTab("サービス");
    expect(await screen.findByText(/60分（初回90分）・5,000円/)).toBeInTheDocument();
    expect(screen.getByText(/（非公開）/)).toBeInTheDocument();
    expect(screen.getByText(/定員8名/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /全身調整/ }));
    await userEvent.selectOptions(screen.getByLabelText("所要時間"), "75");
    await userEvent.selectOptions(screen.getByLabelText("初回の所要時間"), "");
    await userEvent.selectOptions(screen.getByLabelText("前の準備"), "5");
    await userEvent.selectOptions(screen.getByLabelText("後の片付け"), "15");
    await userEvent.selectOptions(screen.getByLabelText("使う設備"), "");
    await userEvent.clear(screen.getByLabelText("料金（税込・円）"));
    await userEvent.type(screen.getByLabelText("分類（任意）"), "整体");
    await userEvent.click(screen.getByRole("checkbox", { name: "Aさん" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Aさん" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "予約ページに公開する" }));
    await userEvent.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(be.writes()).toHaveLength(1));
    expect(be.writes()[0]).toMatchObject({
      path: "services/1",
      method: "PATCH",
      body: { duration_minutes: 75, first_visit_duration_minutes: null, buffer_before_minutes: 5, buffer_after_minutes: 15, resource: null, price: null, category: "整体", staff: [10], is_active: false },
    });
    await userEvent.click(await screen.findByRole("button", { name: "サービスを追加" }));
    await userEvent.click(screen.getByRole("button", { name: "戻る" }));
    await userEvent.click(screen.getByRole("button", { name: "サービスを追加" }));
    await userEvent.type(screen.getByLabelText("サービス名"), "カット");
    await userEvent.type(screen.getByLabelText("料金（税込・円）"), "4000");
    await userEvent.selectOptions(screen.getByLabelText("使う設備"), "5");
    await userEvent.clear(screen.getByLabelText("定員（1回あたりの人数）"));
    await userEvent.type(screen.getByLabelText("定員（1回あたりの人数）"), "3");
    await userEvent.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(be.writes()).toHaveLength(2));
    expect(be.writes()[1]).toMatchObject({ path: "services", method: "POST", body: { name: "カット", price: 4000, resource: 5, capacity: 3, staff: [10], buffer_before_minutes: null, buffer_after_minutes: null } });
  });

  it("orders, pauses and adds staff", async () => {
    const be = backend({ affects: ["staff/10"] });
    renderAs();
    await openTab("担当者");
    expect(await screen.findByText(/（停止中）/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aさんを上へ" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Aさんを下へ" }));
    await waitFor(() => expect(be.writes()).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "Bさんを上へ" }));
    await waitFor(() => expect(be.writes()).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "停止" }));
    await userEvent.click(await screen.findByRole("button", { name: "変更を保存する" }));
    await waitFor(() => expect(be.writes()).toHaveLength(3));
    await userEvent.click(screen.getByRole("button", { name: "再開" }));
    await waitFor(() => expect(be.writes()).toHaveLength(4));
    await userEvent.type(screen.getByLabelText("表示名"), "Cさん");
    await userEvent.click(screen.getByRole("button", { name: "担当者を追加" }));
    await waitFor(() => expect(be.writes()).toHaveLength(5));
    expect(be.writes().map((w) => w.body)).toEqual([
      { ids: [11, 10] },
      { ids: [11, 10] },
      { is_active: false },
      { is_active: true },
      { display_name: "Cさん", priority: 3 },
    ]);
  });

  it("edits weekly shifts and day exceptions", async () => {
    const be = backend();
    renderAs();
    await openTab("担当者");
    await userEvent.click((await screen.findAllByRole("button", { name: "勤務" }))[0]);
    expect(await screen.findByText("Aさんの勤務")).toBeInTheDocument();
    expect(screen.getByText(/11月20日.*休み/)).toBeInTheDocument();
    expect(screen.getByText(/10:00〜15:00/)).toBeInTheDocument();
    expect(screen.queryByText(/1月1日/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "土" }));
    await userEvent.selectOptions(screen.getByLabelText("土曜の勤務開始"), "09:00");
    await userEvent.selectOptions(screen.getByLabelText("土曜の勤務終了"), "13:00");
    await userEvent.click(screen.getByRole("checkbox", { name: "月" }));
    await userEvent.click(screen.getByRole("button", { name: "勤務を保存する" }));
    await waitFor(() => expect(be.writes()).toHaveLength(1));
    await userEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    await waitFor(() => expect(be.writes()).toHaveLength(2));
    await userEvent.selectOptions(screen.getByLabelText("休みか時間変更か"), "work");
    await userEvent.selectOptions(screen.getByLabelText("その日の勤務開始"), "12:00");
    await userEvent.selectOptions(screen.getByLabelText("その日の勤務終了"), "18:00");
    await userEvent.click(screen.getByRole("button", { name: "日ごとの変更を追加" }));
    await waitFor(() => expect(be.writes()).toHaveLength(3));
    expect(be.writes()).toMatchObject([
      { path: "staff/10/shifts", method: "PUT", body: [{ weekday: 5, starts_at: "09:00", ends_at: "13:00" }] },
      { path: "staff/10/exceptions/9", method: "DELETE" },
      { path: "staff/10/exceptions", method: "POST", body: { date: "2026-11-05", is_off: false, starts_at: "12:00", ends_at: "18:00" } },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "‹ 担当者の一覧へ" }));
    expect(await screen.findByRole("button", { name: "担当者を追加" })).toBeInTheDocument();
  });

  it("changes and adds resources", async () => {
    const be = backend({ affects: ["resources/5"] });
    renderAs();
    await openTab("設備");
    await userEvent.selectOptions(await screen.findByLabelText("ベッドの数"), "1");
    await userEvent.click(await screen.findByRole("button", { name: "変更を保存する" }));
    await waitFor(() => expect(be.writes()).toHaveLength(1));
    await userEvent.type(screen.getByLabelText("設備の名前"), "個室");
    await userEvent.clear(screen.getByLabelText("数"));
    await userEvent.type(screen.getByLabelText("数"), "3");
    await userEvent.click(screen.getByRole("button", { name: "設備を追加" }));
    await waitFor(() => expect(be.writes()).toHaveLength(2));
    expect(be.writes().map((w) => w.body)).toEqual([{ quantity: 1 }, { name: "個室", quantity: 3 }]);
  });

  it("explains when there are no resources", async () => {
    mockFetch((url) => (url.endsWith("/auth/me") ? { body: owner } : { body: url.includes("store") ? {} : [] }));
    renderAs();
    await openTab("設備");
    expect(await screen.findByText(/設備はまだありません/)).toBeInTheDocument();
  });

  it("drops a pending change when the owner switches stores", async () => {
    const two: Me = { ...owner, memberships: [...owner.memberships, { subdomain: "kyoto", name: "京都店", role: "owner", staff_id: 20 }] };
    const be = backend({ affects: ["hours"], me: two });
    renderAs();
    await openTab("営業時間");
    await userEvent.click(await screen.findByRole("button", { name: "営業時間を保存する" }));
    expect(await screen.findByRole("dialog", { name: "変更前の確認" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("店舗"), "kyoto");
    expect(await screen.findByRole("tab", { name: "AIで設定", selected: true })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "変更前の確認" })).not.toBeInTheDocument();
    expect(be.writes()).toEqual([]);
  });
});
