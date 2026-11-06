import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/adminTypes";
import { mockFetch } from "@/test-utils";
import { AccountPage } from "./AccountPage";
import { AdminProvider } from "./AdminContext";
import { SettingsPage } from "./settings/SettingsPage";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/account",
}));

const owner: Me = { two_factor_enabled: true, two_factor_required: true, email: "o@example.com", name: "院長", memberships: [{ subdomain: "fushimi", name: "伏見整体院", role: "owner", staff_id: 10 }] };

function csrf(url: string) {
  if (url.endsWith("/auth/csrf")) {
    document.cookie = "csrftoken=t";
    return { body: {} };
  }
  return null;
}

const renderWith = (ui: React.ReactNode) => render(<AdminProvider>{ui}</AdminProvider>);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("account", () => {
  it("regenerates recovery codes after confirming the current code", async () => {
    const calls = mockFetch((url) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/auth/me")) return { body: owner };
      if (url.endsWith("/recovery-codes"))
        return calls.filter((x) => x.url.endsWith("/recovery-codes")).length === 1
          ? { status: 400, body: { message: "コードが違います" } }
          : { body: { recovery_codes: ["aaaaa-11111", "bbbbb-22222"] } };
      return { body: {} };
    });
    renderWith(<AccountPage />);
    expect(await screen.findByText("二段階認証：設定済み")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "アカウント" })).toHaveAttribute("href", "/account");
    await userEvent.type(screen.getByLabelText("認証アプリの6桁（または回復コード）"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "回復コードを作り直す" }));
    expect(await screen.findByText("コードが違います")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("認証アプリの6桁（または回復コード）"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "回復コードを作り直す" }));
    expect(await screen.findByText("aaaaa-11111")).toBeInTheDocument();
    expect(screen.getByText(/古い回復コードは使えなくなりました/)).toBeInTheDocument();
  });

  it("an owner who resets moves straight to setting up the new device", async () => {
    mockFetch((url) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/auth/me")) return { body: owner };
      if (url.endsWith("/2fa/reset")) return { body: { ...owner, two_factor_enabled: false } };
      return { body: {} };
    });
    renderWith(<AccountPage />);
    await userEvent.type(await screen.findByLabelText("認証アプリの6桁（または回復コード）"), "abcde-12345");
    await userEvent.click(screen.getByRole("button", { name: /認証アプリを変更する/ }));
    expect(await screen.findByText("二段階認証を設定してください")).toBeInTheDocument();
  });

  it("staff can remove it, or set it up optionally", async () => {
    const staff = { ...owner, two_factor_required: false, memberships: [{ ...owner.memberships[0], role: "staff" as const }] };
    let enabled = true;
    mockFetch((url) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/auth/me")) return { body: { ...staff, two_factor_enabled: enabled } };
      if (url.endsWith("/2fa/reset")) {
        enabled = false;
        return { body: { ...staff, two_factor_enabled: false } };
      }
      if (url.endsWith("/2fa/setup")) return { body: { secret: "S", uri: "otpauth://x", qr_svg: "<svg/>" } };
      if (url.endsWith("/2fa/confirm")) return { body: { ...staff, two_factor_enabled: true, recovery_codes: ["ccccc-33333"] } };
      return { body: {} };
    });
    renderWith(<AccountPage />);
    await userEvent.type(await screen.findByLabelText("認証アプリの6桁（または回復コード）"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /認証アプリを変更する/ }));
    expect(await screen.findByText("二段階認証を外しました。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "二段階認証を設定する" }));
    await userEvent.click(await screen.findByRole("button", { name: "設定を始める" }));
    await userEvent.type(await screen.findByLabelText("認証アプリに表示された6桁"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "確認して有効にする" }));
    await userEvent.click(await screen.findByRole("button", { name: "保存しました" }));
    expect(await screen.findByText("二段階認証を設定しました。")).toBeInTheDocument();
  });

  it("an owner resets another member's two-factor after confirming", async () => {
    const writes: string[] = [];
    mockFetch((url, init) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/auth/me")) return { body: owner };
      if (init?.method) {
        writes.push(url.replace(/^.*\/settings\//, ""));
        return { body: {} };
      }
      if (url.endsWith("/settings/members"))
        return {
          body: {
            members: [
              { id: 1, email: "o@example.com", name: "", role: "owner", staff: 10, staff_name: "A", is_active: true, two_factor_enabled: true },
              { id: 2, email: "b@example.com", name: "", role: "owner", staff: null, staff_name: "", is_active: true, two_factor_enabled: true },
            ],
            invitations: [],
          },
        };
      return { body: [] };
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWith(<SettingsPage today="2026-11-05" />);
    await userEvent.click(await screen.findByRole("tab", { name: "メンバー" }));
    const buttons = await screen.findAllByRole("button", { name: "二段階認証をリセット" });
    expect(buttons).toHaveLength(1); // 自分の分は出さない
    await userEvent.click(buttons[0]);
    expect(writes).toEqual([]);
    await userEvent.click(buttons[0]);
    await waitFor(() => expect(writes).toEqual(["members/2/reset-2fa"]));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/b@example.com の二段階認証をリセットしました/)).toBeInTheDocument();
  });
});
