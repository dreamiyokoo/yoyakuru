import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/adminTypes";
import { mockFetch } from "@/test-utils";
import { AdminProvider } from "../AdminContext";
import { SettingsPage } from "./SettingsPage";
import { resolveRefs } from "./SetupTab";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings",
}));

const owner: Me = { email: "o@example.com", name: "院長", memberships: [{ subdomain: "fushimi", name: "伏見整体院", role: "owner", staff_id: 10 }] };

const STEPS = [
  { label: "設備「ベッド」を2で追加", path: "resources", method: "POST", body: { name: "ベッド", quantity: 2 }, ref: "resource:ベッド" },
  { label: "サービス「全身調整」を追加：60分", path: "services", method: "POST", body: { name: "全身調整", resource: { $ref: "resource:ベッド" }, staff: { $ref: "all_staff" } } },
  { label: "営業時間：月 10:00〜20:00", path: "hours", method: "PUT", body: [{ weekday: 0, opens_at: "10:00", closes_at: "20:00" }] },
];

function backend({ assistant = { available: true, reply: "案を作りました", steps: STEPS.slice(2), notes: ["担当者「Z」が見つかりません"] } } = {}) {
  const writes: { path: string; body: unknown }[] = [];
  const calls = mockFetch((url, init) => {
    if (url.endsWith("/auth/me")) return { body: owner };
    if (url.endsWith("/auth/csrf")) {
      document.cookie = "csrftoken=t";
      return { body: {} };
    }
    const [path, query] = url.replace(/^.*\/settings\//, "").split("?dry_run=");
    if (path === "templates") return { body: [{ key: "seitai", label: "整体・治療院" }, { key: "general", label: "汎用" }] };
    if (path === "templates/seitai") return { body: { label: "整体・治療院", steps: STEPS, notes: [] } };
    if (path === "templates/general") return { status: 500, body: { detail: "作れません" } };
    if (path === "assistant") return { body: assistant };
    if (path === "staff" && !init?.method) return { body: [{ id: 10, display_name: "A", title: "", priority: 1, is_active: true }, { id: 11, display_name: "B", title: "", priority: 2, is_active: false }] };
    if (init?.method && init.method !== "GET") {
      if (query !== "1") writes.push({ path, body: JSON.parse(String(init.body)) });
      return { body: { applied: query !== "1", result: path === "resources" ? { id: 77 } : {}, affected_bookings: [] } };
    }
    return { body: [] };
  });
  return { calls, writes };
}

const renderPage = () =>
  render(
    <AdminProvider>
      <SettingsPage today="2026-11-05" />
    </AdminProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("AI setup", () => {
  it("resolves references in nested bodies", () => {
    expect(resolveRefs({ a: { $ref: "x" }, b: [{ $ref: "all_staff" }], c: { $ref: "missing" }, d: 1 }, { x: 5 }, [1, 2])).toEqual({ a: 5, b: [[1, 2]], c: null, d: 1 });
  });

  it("applies a template step by step, using ids from earlier steps", async () => {
    const be = backend();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "整体・治療院" }));
    expect(await screen.findByText("手順 1 / 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "反映する" }));
    expect(await screen.findByText("手順 2 / 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "反映する" }));
    expect(await screen.findByText("手順 3 / 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "スキップ" }));
    expect(await screen.findByText(/設定案の確認が終わりました/)).toBeInTheDocument();
    expect(screen.getByText("– スキップ：営業時間：月 10:00〜20:00")).toBeInTheDocument();
    expect(be.writes).toEqual([
      { path: "resources", body: { name: "ベッド", quantity: 2 } },
      { path: "services", body: { name: "全身調整", resource: 77, staff: [10] } },
    ]);
  });

  it("asks the assistant and shows its reply, notes and steps", async () => {
    const be = backend();
    renderPage();
    await userEvent.type(await screen.findByLabelText("店舗の様子"), "月曜は10時〜20時");
    await userEvent.click(screen.getByRole("button", { name: "設定案を作る" }));
    expect(await screen.findByText("案を作りました")).toBeInTheDocument();
    expect(screen.getByText("担当者「Z」が見つかりません")).toBeInTheDocument();
    expect(screen.getByText("営業時間：月 10:00〜20:00")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("店舗の様子"), "火曜も");
    await userEvent.click(screen.getByRole("button", { name: "設定案を作る" }));
    await waitFor(() => expect(be.calls.filter((c) => c.url.endsWith("/assistant"))).toHaveLength(2));
    const second = JSON.parse(String(be.calls.filter((c) => c.url.endsWith("/assistant"))[1].init?.body));
    expect(second).toEqual({ message: "火曜も", history: [{ role: "user", content: "月曜は10時〜20時" }, { role: "assistant", content: "案を作りました" }] });
  });

  it("explains when there is nothing to change or the plan fails", async () => {
    backend({ assistant: { available: false, reply: "いまはAIで設定案を作れません。", steps: [], notes: [] } });
    renderPage();
    await userEvent.type(await screen.findByLabelText("店舗の様子"), "こんにちは");
    await userEvent.click(screen.getByRole("button", { name: "設定案を作る" }));
    expect(await screen.findByText("変更する項目はありません。")).toBeInTheDocument();
    expect(screen.getByText("いまはAIで設定案を作れません。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "汎用" }));
    expect(await screen.findByText("作れません")).toBeInTheDocument();
  });
});
