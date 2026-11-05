import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "@/test-utils";
import { CalendarFeed } from "./CalendarFeed";

afterEach(() => vi.unstubAllGlobals());

describe("CalendarFeed", () => {
  it("issues, copies, reissues and stops the feed URL", async () => {
    let n = 0;
    const calls = mockFetch((url, init) => {
      if (url.endsWith("/auth/csrf")) {
        document.cookie = "csrftoken=t";
        return { body: {} };
      }
      if (init?.method === "POST") return { body: { path: `/api/v1/public/calendar/tok${++n}.ics`, shows_customer_name: false } };
      if (init?.method === "DELETE") return { body: { path: null, shows_customer_name: false } };
      return { body: { path: null, shows_customer_name: true } };
    });
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CalendarFeed sub="fushimi" />);
    expect(await screen.findByText(/時間とメニュー、お客様の名前だけです/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "URLを発行する" }));
    expect(await screen.findByLabelText("カレンダーのURL")).toHaveValue(`${window.location.origin}/api/v1/public/calendar/tok1.ics`);
    await userEvent.click(screen.getByRole("button", { name: "URLをコピー" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/v1/public/calendar/tok1.ics`);
    expect(await screen.findByText("URLをコピーしました。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "URLを再発行" }));
    expect(await screen.findByText(/古いURLは使えなくなりました/)).toBeInTheDocument();
    expect(screen.getByLabelText("カレンダーのURL")).toHaveValue(`${window.location.origin}/api/v1/public/calendar/tok2.ics`);
    await userEvent.click(screen.getByRole("button", { name: "配信を止める" }));
    expect(await screen.findByText("配信を止めました。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "URLを発行する" })).toBeInTheDocument();
    expect(calls.filter((c) => c.url.endsWith("/calendar-feed")).map((c) => c.init?.method ?? "GET")).toEqual(["GET", "POST", "POST", "DELETE"]);
  });

  it("explains when the user is not a staff member, and shows action errors", async () => {
    mockFetch(() => ({ status: 403, body: { detail: "担当者として登録されていないため、カレンダー配信はありません" } }));
    render(<CalendarFeed sub="fushimi" />);
    expect(await screen.findByText(/担当者として登録されていない/)).toBeInTheDocument();
  });

  it("shows an error when issuing fails", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/auth/csrf")) {
        document.cookie = "csrftoken=t";
        return { body: {} };
      }
      return init?.method ? { status: 500, body: {} } : { body: { path: null, shows_customer_name: false } };
    });
    render(<CalendarFeed sub="fushimi" />);
    await userEvent.click(await screen.findByRole("button", { name: "URLを発行する" }));
    expect(await screen.findByText(/通信に失敗しました|操作できませんでした/)).toBeInTheDocument();
  });
});
