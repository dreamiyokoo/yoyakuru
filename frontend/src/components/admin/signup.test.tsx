import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/adminTypes";
import { mockFetch } from "@/test-utils";
import { AdminProvider } from "./AdminContext";
import { BillingRequired } from "./BillingRequired";
import { SignupPage } from "./SignupPage";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/signup",
}));

const membership = { subdomain: "komorebi", name: "こもれび整体院", role: "owner" as const, staff_id: null, billing_required: true, billing_managed: true };
const me: Me = { two_factor_enabled: false, two_factor_required: true, email: "k@example.com", name: "木漏 日子", memberships: [membership] };

function csrf(url: string) {
  if (url.endsWith("/auth/csrf")) {
    document.cookie = "csrftoken=t";
    return { body: {} };
  }
  return null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  replace.mockReset();
  window.history.replaceState(null, "", "/");
});

describe("signup", () => {
  it("shows field errors from the server, then signs up and moves on", async () => {
    let n = 0;
    const calls = mockFetch((url) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/auth/me")) return { status: 403, body: { detail: "ログインしてください" } };
      if (url.endsWith("/auth/signup"))
        return ++n === 1
          ? { status: 400, body: { subdomain: ["このURLは既に使われています"], password: ["短すぎます", "よく使われています"] } }
          : { status: 201, body: me };
      return { body: {} };
    });
    render(
      <AdminProvider>
        <SignupPage />
      </AdminProvider>,
    );
    await userEvent.type(await screen.findByLabelText("お店の名前"), "こもれび整体院");
    await userEvent.type(screen.getByLabelText("予約ページのURL"), "Komorebi ");
    expect(screen.getByText(/https:\/\/komorebi\./)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("お名前"), "木漏 日子");
    await userEvent.type(screen.getByLabelText("メールアドレス"), " k@example.com ");
    await userEvent.type(screen.getByLabelText("パスワード"), "long-enough-pass-1");
    await userEvent.click(screen.getByRole("button", { name: "登録する" }));
    expect(await screen.findByText("このURLは既に使われています")).toBeInTheDocument();
    expect(screen.getByText("短すぎます よく使われています")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "登録する" }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/bookings"));
    const sent = calls.filter((c) => c.url.endsWith("/auth/signup"));
    expect(JSON.parse(String(sent[1].init?.body))).toEqual({
      store_name: "こもれび整体院",
      subdomain: "komorebi",
      name: "木漏 日子",
      email: "k@example.com",
      password: "long-enough-pass-1",
    });
  });

  it("shows a general message when the server gives no field errors", async () => {
    mockFetch((url) => csrf(url) ?? (url.endsWith("/auth/me") ? { status: 403, body: {} } : { status: 429, body: { detail: "しばらくしてからお試しください" } }));
    render(
      <AdminProvider>
        <SignupPage />
      </AdminProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "登録する" }));
    expect(await screen.findByText("しばらくしてからお試しください")).toBeInTheDocument();
  });
});

describe("billing required", () => {
  it("sends the owner to the Stripe payment page", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, search: "", pathname: "/bookings" });
    let n = 0;
    mockFetch((url) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/billing/checkout"))
        return ++n === 1 ? { status: 503, body: { message: "お支払いの受付を準備中です" } } : { body: { url: "https://checkout.stripe.test/x" } };
      return { body: {} };
    });
    render(<BillingRequired membership={membership} onPaid={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "お支払いを登録する" }));
    expect(await screen.findByText("お支払いの受付を準備中です")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "お支払いを登録する" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/x"));
  });

  it("confirms the payment when coming back from Stripe", async () => {
    window.history.replaceState(null, "", "/bookings?checkout_session=cs_1");
    const paid = { ...me, two_factor_enabled: true, memberships: [{ ...membership, billing_required: false }] };
    const calls = mockFetch((url) => (url.includes("/billing?") ? { body: { usable: true } } : url.endsWith("/auth/me") ? { body: paid } : { body: {} }));
    const onPaid = vi.fn();
    render(<BillingRequired membership={membership} onPaid={onPaid} />);
    await vi.waitFor(() => expect(onPaid).toHaveBeenCalledWith(paid));
    expect(calls[0].url).toContain("checkout_session=cs_1");
    expect(window.location.search).toBe("");
  });

  it("asks to reload when the payment is not confirmed yet, and reports errors", async () => {
    window.history.replaceState(null, "", "/bookings?checkout_session=cs_1");
    mockFetch(() => ({ body: { usable: false } }));
    const { unmount } = render(<BillingRequired membership={membership} onPaid={vi.fn()} />);
    expect(await screen.findByText(/確認に時間がかかっています/)).toBeInTheDocument();
    unmount();
    mockFetch(() => ({ status: 500, body: { message: "サーバーエラー" } }));
    render(<BillingRequired membership={membership} onPaid={vi.fn()} />);
    expect(await screen.findByText("サーバーエラー")).toBeInTheDocument();
  });

  it("lets an owner whose card failed open the Stripe page to change it", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, search: "", pathname: "/bookings" });
    mockFetch((url) =>
      csrf(url) ??
      (url.includes("/billing?")
        ? { body: { usable: false, manageable: true } }
        : url.endsWith("/billing/portal")
          ? { body: { url: "https://portal.stripe.test/x" } }
          : { body: {} }),
    );
    render(<BillingRequired membership={membership} onPaid={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "カードの変更・領収書の確認" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("https://portal.stripe.test/x"));
    expect(screen.queryByText(/確認に時間がかかっています/)).toBeNull();
  });

  it("tells staff to wait for the owner", () => {
    render(<BillingRequired membership={{ ...membership, role: "staff" }} onPaid={vi.fn()} />);
    expect(screen.getByText(/オーナーがお支払いを登録すると/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
