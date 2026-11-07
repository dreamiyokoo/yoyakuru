import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/adminTypes";
import { mockFetch } from "@/test-utils";
import { AdminProvider } from "./AdminContext";
import { InvitePage } from "./InvitePage";
import { SettingsPage } from "./settings/SettingsPage";

const nav = vi.hoisted(() => ({ replace: vi.fn(), pathname: "/invite" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => nav.pathname,
}));

const owner: Me = { email: "o@example.com", name: "院長", calendar_connected: true, memberships: [{ subdomain: "fushimi", name: "伏見整体院", role: "owner", staff_id: 10, billing_required: false, billing_managed: false }] } as Me;

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

describe("invitation", () => {
  it("lets an invited person join with Google, without redirecting to login first", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const calls = mockFetch((url) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/auth/me")) return { status: 403, body: {} };
      if (url.endsWith("/google/start")) return { body: { url: "/accounts/google/login/?process=login" } };
      return { body: { tenant: "伏見整体院", email: "new@example.com", role: "staff", staff_name: "Dさん" } };
    });
    render(
      <AdminProvider>
        <InvitePage token="tok" />
      </AdminProvider>,
    );
    expect(await screen.findByText(/伏見整体院/)).toBeInTheDocument();
    expect(screen.getByText(/担当者：Dさん/)).toBeInTheDocument();
    expect(screen.getByText("new@example.com")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalledWith("/login");
    expect(screen.queryByLabelText(/パスワード/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Googleで参加する" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/accounts/google/login/?process=login"));
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ kind: "invite", token: "tok" });
  });

  it("explains invalid links", async () => {
    mockFetch((url) => (url.endsWith("/auth/me") ? { status: 403, body: {} } : { status: 404, body: { detail: "この招待は無効か、期限が切れています" } }));
    render(
      <AdminProvider>
        <InvitePage token="bad" />
      </AdminProvider>,
    );
    expect(await screen.findByText("この招待は無効か、期限が切れています")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Googleで参加する" })).not.toBeInTheDocument();
  });

  it("owner invites, revokes and pauses members", async () => {
    nav.pathname = "/settings";
    const writes: { url: string; method: string; body: unknown }[] = [];
    mockFetch((url, init) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/auth/me")) return { body: owner };
      if (init?.method) {
        writes.push({ url: url.replace(/^.*\/settings\//, ""), method: init.method, body: init.body ? JSON.parse(String(init.body)) : null });
        return { body: {} };
      }
      if (url.endsWith("/settings/staff"))
        return { body: [{ id: 10, display_name: "Aさん", title: "", priority: 1, is_active: true }, { id: 12, display_name: "Cさん", title: "", priority: 3, is_active: true }] };
      if (url.endsWith("/settings/members"))
        return {
          body: {
            members: [
              { id: 1, email: "o@example.com", name: "院長", role: "owner", staff: 10, staff_name: "Aさん", is_active: true, calendar_connected: true },
              { id: 2, email: "b@example.com", name: "", role: "staff", staff: null, staff_name: "", is_active: false, calendar_connected: false },
              { id: 3, email: "c@example.com", name: "", role: "staff", staff: 13, staff_name: "Eさん", is_active: true, calendar_connected: false },
            ],
            invitations: [
              { id: 5, email: "x@example.com", role: "staff", staff: 12, staff_name: "Cさん", state: "open", expires_at: "2026-11-12T10:00:00+09:00" },
              { id: 4, email: "y@example.com", role: "owner", staff: null, staff_name: "", state: "expired", expires_at: "2026-11-01T10:00:00+09:00" },
            ],
          },
        };
      return { body: [] };
    });
    render(
      <AdminProvider>
        <SettingsPage today="2026-11-05" />
      </AdminProvider>,
    );
    await userEvent.click(await screen.findByRole("tab", { name: "メンバー" }));
    expect(await screen.findByText(/担当者：Aさん/)).toBeInTheDocument();
    expect(screen.getByText(/（停止中）/)).toBeInTheDocument();
    expect(screen.getByText(/期限切れ/)).toBeInTheDocument();
    expect(screen.getByText(/Googleカレンダーの接続が切れています/)).toBeInTheDocument();
    // Aさんはログインする人がいるので、担当者の選択肢に出ない
    expect(screen.queryByRole("option", { name: "Aさん" })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("招待するひとのメールアドレス"), "new@example.com");
    await userEvent.type(screen.getByLabelText("担当者の表示名"), "Dさん");
    await userEvent.click(screen.getByRole("button", { name: "招待メールを送る" }));
    expect(await screen.findByText("new@example.com に招待メールを送りました。")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("招待するひとのメールアドレス"), "own@example.com");
    await userEvent.selectOptions(screen.getByLabelText("権限"), "owner");
    await userEvent.selectOptions(screen.getByLabelText("担当者"), "none");
    await userEvent.click(screen.getByRole("button", { name: "招待メールを送る" }));
    await userEvent.type(screen.getByLabelText("招待するひとのメールアドレス"), "c@example.com");
    await userEvent.selectOptions(screen.getByLabelText("権限"), "staff");
    await userEvent.selectOptions(screen.getByLabelText("担当者"), "12");
    await userEvent.click(screen.getByRole("button", { name: "招待メールを送る" }));
    await userEvent.click(await screen.findByRole("button", { name: "取り消す" }));
    await userEvent.click(await screen.findByRole("button", { name: "再開" }));
    await waitFor(() => expect(writes).toHaveLength(5));
    expect(writes).toEqual([
      { url: "invitations", method: "POST", body: { email: "new@example.com", role: "staff", staff: null, new_staff_name: "Dさん" } },
      { url: "invitations", method: "POST", body: { email: "own@example.com", role: "owner", staff: null, new_staff_name: "" } },
      { url: "invitations", method: "POST", body: { email: "c@example.com", role: "staff", staff: 12, new_staff_name: "" } },
      { url: "invitations/5", method: "DELETE", body: null },
      { url: "members/2", method: "PATCH", body: { is_active: true } },
    ]);
  });
});
