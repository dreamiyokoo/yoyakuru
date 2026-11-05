import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "@/test-utils";
import type { PublicBooking } from "@/lib/types";
import { CancelView } from "./CancelView";
import { ConfirmView } from "./ConfirmView";

afterEach(() => vi.unstubAllGlobals());

const booking = (over: Partial<PublicBooking> = {}): PublicBooking => ({
  status: "confirmed",
  starts_at: "2026-11-11T10:30:00+09:00",
  ends_at: "2026-11-11T11:30:00+09:00",
  hold_expires_at: null,
  service_name: "全身調整",
  staff_name: "Aさん",
  store_name: "伏見整体院",
  store_phone: "075-000-0000",
  customer_name: "山田 花子",
  auto_assigned: true,
  cancel_deadline: "2026-11-11T00:00:00+09:00",
  ...over,
});

describe("ConfirmView", () => {
  it("shows the completed booking with calendar links", async () => {
    mockFetch(() => ({ body: booking() }));
    render(<ConfirmView token="tok" />);
    expect(await screen.findByText("ご予約が確定しました")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "カレンダーに追加（予定ファイル）" })).toHaveAttribute("href", "/api/v1/public/bookings/tok/ics");
    expect(screen.getByRole("link", { name: "Googleカレンダーに追加" }).getAttribute("href")).toContain("calendar.google.com");
  });
  it("shows the expired screen", async () => {
    mockFetch(() => ({ status: 410, body: { code: "hold_expired", message: "期限切れ" } }));
    render(<ConfirmView token="tok" />);
    expect(await screen.findByText("確認の期限（15分）を過ぎました")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "もう一度予約する" })).toHaveAttribute("href", "/");
  });
  it("shows other errors", async () => {
    mockFetch(() => ({ status: 409, body: { code: "cancelled", message: "この予約は取消されています" } }));
    render(<ConfirmView token="tok" />);
    expect(await screen.findByText("この予約は取消されています")).toBeInTheDocument();
  });
  it("handles a missing token", async () => {
    render(<ConfirmView token="" />);
    expect(await screen.findByText(/リンクが正しくありません/)).toBeInTheDocument();
  });
});

describe("CancelView", () => {
  const before = () => new Date("2026-11-10T12:00:00+09:00");
  it("cancels before the deadline", async () => {
    const calls = mockFetch((url) => (url.endsWith("/cancel") ? { body: booking({ status: "cancelled" }) } : { body: booking() }));
    const user = userEvent.setup();
    render(<CancelView token="tok" now={before} />);
    expect(await screen.findByText("取消の締切：11月10日（火）23:59まで")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "予約を取消する" }));
    expect(await screen.findByText("ご予約を取消しました")).toBeInTheDocument();
    expect(calls.at(-1)?.init?.method).toBe("POST");
  });
  it("guides to call after the deadline", async () => {
    mockFetch(() => ({ body: booking() }));
    render(<CancelView token="tok" now={() => new Date("2026-11-11T09:00:00+09:00")} />);
    expect(await screen.findByText(/取消の締切を過ぎています/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "予約を取消する" })).not.toBeInTheDocument();
  });
  it("shows non cancellable and errors", async () => {
    mockFetch((url) => (url.endsWith("/cancel") ? { status: 403, body: { message: "締切を過ぎています" } } : { body: booking({ status: "expired" }) }));
    render(<CancelView token="tok" now={before} />);
    expect(await screen.findByText("この予約は取消できません。")).toBeInTheDocument();
  });
  it("shows cancel errors", async () => {
    mockFetch((url) => (url.endsWith("/cancel") ? { status: 403, body: { message: "締切を過ぎています" } } : { body: booking() }));
    const user = userEvent.setup();
    render(<CancelView token="tok" now={before} />);
    await user.click(await screen.findByRole("button", { name: "予約を取消する" }));
    expect(await screen.findByText("締切を過ぎています")).toBeInTheDocument();
  });
  it("shows load errors", async () => {
    mockFetch(() => ({ status: 404, body: { message: "予約が見つかりません" } }));
    render(<CancelView token="bad" />);
    expect(await screen.findByText("予約が見つかりません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "予約ページへ" })).toBeInTheDocument();
  });
});
