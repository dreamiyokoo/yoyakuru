import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/adminTypes";
import { mockFetch } from "@/test-utils";
import { AdminProvider } from "./AdminContext";
import { BookingListPage } from "./BookingListPage";
import { LoginPage } from "./LoginPage";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/bookings",
}));

const base: Me = { two_factor_enabled: true, two_factor_required: true, email: "o@example.com", name: "院長", memberships: [{ subdomain: "fushimi", name: "伏見整体院", role: "owner", staff_id: 10 }] };

function csrf(url: string) {
  if (url.endsWith("/auth/csrf")) {
    document.cookie = "csrftoken=t";
    return { body: {} };
  }
  return null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("two-factor login", () => {
  it("asks for the authenticator code after the password", async () => {
    const calls = mockFetch((url) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/auth/me")) return { status: 403, body: {} };
      if (url.endsWith("/auth/login")) return { body: { two_factor_required: true } };
      if (url.endsWith("/auth/login/code")) return calls.filter((x) => x.url.endsWith("/login/code")).length === 1 ? { status: 400, body: { message: "コードが違います" } } : { body: base };
      return { body: {} };
    });
    render(
      <AdminProvider>
        <LoginPage />
      </AdminProvider>,
    );
    await userEvent.type(await screen.findByLabelText("メールアドレス"), "o@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));
    await userEvent.type(await screen.findByLabelText("確認コード"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "確認する" }));
    expect(await screen.findByText("コードが違います")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("確認コード"));
    await userEvent.type(screen.getByLabelText("確認コード"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "確認する" }));
    await vi.waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/bookings"));
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ code: "123456" });
  });

  it("makes an owner set up two-factor before managing, then shows recovery codes once", async () => {
    let enabled = false;
    mockFetch((url) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/auth/me")) return { body: { ...base, two_factor_enabled: enabled } };
      if (url.endsWith("/2fa/setup")) return { body: { secret: "ABCDEF", uri: "otpauth://totp/x", qr_svg: "<svg></svg>" } };
      if (url.endsWith("/2fa/confirm")) {
        enabled = true;
        return { body: { ...base, recovery_codes: ["aaaaa-11111", "bbbbb-22222"] } };
      }
      if (url.includes("/bookings")) return { body: [] };
      return { body: {} };
    });
    render(
      <AdminProvider>
        <BookingListPage today="2026-11-11" />
      </AdminProvider>,
    );
    expect(await screen.findByText("二段階認証を設定してください")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "設定を始める" }));
    expect(await screen.findByAltText("認証アプリで読み取るQRコード")).toHaveAttribute("src", expect.stringContaining("data:image/svg+xml"));
    expect(screen.getByText("ABCDEF")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "このスマホの認証アプリで開く" })).toHaveAttribute("href", "otpauth://totp/x");
    await userEvent.type(screen.getByLabelText("認証アプリに表示された6桁"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "確認して有効にする" }));
    expect(await screen.findByText("aaaaa-11111")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "保存しました" }));
    expect(await screen.findByText(/今日/)).toBeInTheDocument();
  });

  it("shows setup errors", async () => {
    mockFetch((url) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/auth/me")) return { body: { ...base, two_factor_enabled: false } };
      return { status: 500, body: {} };
    });
    render(
      <AdminProvider>
        <BookingListPage today="2026-11-11" />
      </AdminProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "設定を始める" }));
    expect(await screen.findByText(/通信に失敗しました|設定できませんでした/)).toBeInTheDocument();
  });
});
