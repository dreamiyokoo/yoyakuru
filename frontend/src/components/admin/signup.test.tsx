import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/adminTypes";
import { mockFetch } from "@/test-utils";
import { AdminProvider } from "./AdminContext";
import { BillingRequired } from "./BillingRequired";
import { SignupPage, check } from "./SignupPage";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/signup",
}));

const membership = { subdomain: "komorebi", name: "こもれび整体院", role: "owner" as const, staff_id: null, billing_required: true, billing_managed: true };

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

async function fill(values: Partial<Record<string, string>> = {}) {
  const v = { お店の名前: "こもれび整体院", 予約ページのURL: "Komorebi ", ...values };
  for (const [label, text] of Object.entries(v)) {
    const input = screen.getByLabelText(label);
    await userEvent.clear(input);
    if (text) await userEvent.type(input, text);
  }
}

function renderSignup() {
  return render(
    <AdminProvider>
      <SignupPage />
    </AdminProvider>,
  );
}

describe("signup", () => {
  it("needs valid values before going to Google", async () => {
    mockFetch((url) => (url.endsWith("/auth/me") ? { status: 403, body: {} } : { body: {} }));
    renderSignup();
    const button = screen.getByRole("button", { name: "Googleで登録する" });
    expect(button).toBeDisabled();
    await fill({ 予約ページのURL: "ab" });
    await userEvent.tab();
    expect(await screen.findByText(/英小文字・数字・ハイフンで3〜32文字にしてください/)).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(check("store_name", { store_name: " ", subdomain: "abc" })).toBe("お店の名前を入力してください");
    expect(check("subdomain", { store_name: "x", subdomain: "" })).toBe("予約ページのURLを入力してください");
  });

  it("saves the store name and URL, then moves to Google", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const calls = mockFetch((url) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/auth/me")) return { status: 403, body: {} };
      if (url.endsWith("/google/start")) return { body: { url: "/accounts/google/login/?process=login" } };
      return { body: {} };
    });
    renderSignup();
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Googleで登録する" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/accounts/google/login/?process=login"));
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ kind: "signup", store_name: "こもれび整体院", subdomain: "komorebi" });
  });

  it("shows the server's message when the URL is already taken", async () => {
    mockFetch((url) => {
      const c = csrf(url);
      if (c) return c;
      if (url.endsWith("/auth/me")) return { status: 403, body: {} };
      return { status: 400, body: { subdomain: ["このURLは既に使われています"] } };
    });
    renderSignup();
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Googleで登録する" }));
    expect(await screen.findByText("このURLは既に使われています")).toBeInTheDocument();
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
    const paid = { email: "k@example.com", name: "木漏 日子", calendar_connected: true, memberships: [{ ...membership, billing_required: false }] };
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
