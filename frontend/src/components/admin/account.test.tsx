import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/adminTypes";
import { mockFetch } from "@/test-utils";
import { AccountPage } from "./AccountPage";
import { AdminProvider } from "./AdminContext";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/account",
}));

const owner: Me = {
  email: "o@example.com",
  name: "院長",
  calendar_connected: true,
  memberships: [{ subdomain: "fushimi", name: "伏見整体院", role: "owner", staff_id: 10, billing_required: false, billing_managed: false }],
};

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
  it("opens the Stripe page to manage the payment for self-registered stores", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const managed: Me = { ...owner, memberships: [{ ...owner.memberships[0], billing_managed: true }] };
    mockFetch((url) => csrf(url) ?? (url.endsWith("/auth/me") ? { body: managed } : url.endsWith("/billing/portal") ? { body: { url: "https://portal.stripe.test/x" } } : { body: {} }));
    renderWith(<AccountPage />);
    await userEvent.click(await screen.findByRole("button", { name: "お支払いの管理を開く" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://portal.stripe.test/x"));
  });

  it("shows the portal error", async () => {
    const managed: Me = { ...owner, memberships: [{ ...owner.memberships[0], billing_managed: true }] };
    mockFetch((url) => csrf(url) ?? (url.endsWith("/auth/me") ? { body: managed } : url.endsWith("/billing/portal") ? { status: 502, body: { message: "決済サービスに接続できませんでした" } } : { body: {} }));
    renderWith(<AccountPage />);
    await userEvent.click(await screen.findByRole("button", { name: "お支払いの管理を開く" }));
    expect(await screen.findByText("決済サービスに接続できませんでした")).toBeInTheDocument();
  });

  it("does not show payment for stores the operator set up", async () => {
    mockFetch((url) => csrf(url) ?? (url.endsWith("/auth/me") ? { body: owner } : { body: {} }));
    renderWith(<AccountPage />);
    expect(await screen.findByText("Googleカレンダー：接続済み")).toBeInTheDocument();
    expect(screen.getByText(/o@example.com（Googleアカウント）/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "お支払いの管理を開く" })).toBeNull();
  });

  it("offers to reconnect when the calendar connection is lost", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    mockFetch((url) =>
      csrf(url) ?? (url.endsWith("/auth/me") ? { body: { ...owner, calendar_connected: false } } : url.endsWith("/google/start") ? { body: { url: "/accounts/google/login/?process=login" } } : { body: {} }),
    );
    renderWith(<AccountPage />);
    expect(await screen.findByText("Googleカレンダー：接続が切れています")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Googleでつなぎ直す" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/accounts/google/login/?process=login"));
  });
});
