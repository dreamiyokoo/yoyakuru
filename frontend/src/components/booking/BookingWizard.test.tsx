import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORE, mockFetch, slot } from "@/test-utils";
import { BookingWizard } from "./BookingWizard";

afterEach(() => vi.unstubAllGlobals());

const TODAY = "2026-11-11";

async function goToConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("radio", { name: "初めて" }));
  expect(screen.getByText("90分")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "全身調整" }));
  await user.click(screen.getByRole("button", { name: "次へ：担当を選ぶ" }));
  expect(screen.queryByRole("radio", { name: "Bさん" })).not.toBeInTheDocument(); // 全身調整を担当できない
  await user.click(screen.getByRole("radio", { name: "Aさん" }));
  await user.click(screen.getByRole("button", { name: "次へ：日時を選ぶ" }));
  await user.click(await screen.findByRole("radio", { name: "10:30" }));
  await user.click(screen.getByRole("button", { name: "次へ：お客様情報" }));
  await user.click(screen.getByRole("button", { name: "確認へ" }));
  expect(screen.getByText("お名前を入力してください")).toBeInTheDocument();
  expect(screen.getByText("メールアドレスを正しく入力してください")).toBeInTheDocument();
  await user.type(screen.getByLabelText("お名前"), "山田 花子");
  await user.type(screen.getByLabelText("メールアドレス"), "yamada@example.com");
  await user.type(screen.getByLabelText("電話番号（任意）"), "090");
  await user.type(screen.getByLabelText("ご要望（任意）"), "着替え");
  await user.click(screen.getByRole("button", { name: "確認へ" }));
  expect(screen.getByText("予約内容の確認")).toBeInTheDocument();
}

describe("BookingWizard", () => {
  it("books through all steps", async () => {
    const calls = mockFetch((url) => (url.includes("availability") ? { body: { slots: [slot("10:00"), slot("10:30")] } } : { status: 201, body: {} }));
    const user = userEvent.setup();
    render(<BookingWizard store={STORE} today={TODAY} newKey={() => "key-1"} />);
    await goToConfirm(user);
    expect(screen.getByText("全身調整（90分）")).toBeInTheDocument();
    expect(screen.getByText("5,000円（当日払い）")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "予約を送信する" }));
    expect(await screen.findByText("確認メールを送りました")).toBeInTheDocument();
    const hold = JSON.parse(String(calls.at(-1)?.init?.body));
    expect(hold).toMatchObject({ service: 1, staff: 10, customer_type: "first", idempotency_key: "key-1", note: "着替え" });
    expect(calls[0].url).toContain("staff=10");
  });

  it("offers nearby slots when the slot was taken", async () => {
    let holds = 0;
    const calls = mockFetch((url) => {
      if (url.includes("availability")) return { body: { slots: [slot("10:00"), slot("10:30"), slot("11:00"), slot("11:30")] } };
      holds += 1;
      return holds === 1 ? { status: 409, body: { code: "slot_unavailable", message: "x" } } : { status: 201, body: {} };
    });
    const user = userEvent.setup();
    let n = 0;
    render(<BookingWizard store={STORE} today={TODAY} newKey={() => `k${++n}`} />);
    await goToConfirm(user);
    await user.click(screen.getByRole("button", { name: "予約を送信する" }));
    expect(await screen.findByText(/ほかの方のご予約で埋まりました/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "11月11日（水）10:00" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "11月11日（水）11:00" }));
    expect(screen.getByText("11月11日（水）11:00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "予約を送信する" }));
    expect(await screen.findByText("確認メールを送りました")).toBeInTheDocument();
    const keys = calls.filter((c) => c.url.endsWith("/bookings")).map((c) => JSON.parse(String(c.init?.body)).idempotency_key);
    expect(keys).toEqual(["k1", "k2"]); // 断られた後に別の枠を選んだら新しいキー
  });

  it("lets the customer pick another date after a conflict", async () => {
    mockFetch((url) => (url.includes("availability") ? { body: { slots: [slot("10:30")] } } : { status: 409, body: {} }));
    const user = userEvent.setup();
    render(<BookingWizard store={STORE} today={TODAY} />);
    await goToConfirm(user);
    await user.click(screen.getByRole("button", { name: "予約を送信する" }));
    expect(await screen.findByText("この日の空き枠はありません。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "日付を選び直す" }));
    expect(await screen.findByText("11月11日（水）の空き")).toBeInTheDocument();
  });

  it("shows server errors and keeps the form", async () => {
    mockFetch((url) => (url.includes("availability") ? { body: { slots: [slot("10:30")] } } : { status: 429, body: { message: "混み合っています" } }));
    const user = userEvent.setup();
    render(<BookingWizard store={STORE} today={TODAY} />);
    await goToConfirm(user);
    await user.click(screen.getByRole("button", { name: "予約を送信する" }));
    expect(await screen.findByText("混み合っています")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "修正する" }));
    expect(screen.getByLabelText("お名前")).toHaveValue("山田 花子");
  });

  it("navigates dates, weeks and empty days", async () => {
    const calls = mockFetch((url) => ({ body: { slots: url.includes("2026-11-12") ? [] : [slot("10:00")] } }));
    const user = userEvent.setup();
    render(<BookingWizard store={STORE} today={TODAY} />);
    await user.click(screen.getByRole("radio", { name: "骨盤矯正" }));
    await user.click(screen.getByRole("button", { name: "次へ：担当を選ぶ" }));
    expect(screen.getByRole("radio", { name: "Bさん" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "次へ：日時を選ぶ" }));
    expect(screen.getByRole("button", { name: "‹ 前の週" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "11月12日（木）" }));
    expect(await screen.findByText("この日は空きがありません。別の日をお選びください。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "次の週 ›" }));
    await user.click(screen.getByRole("radio", { name: "11月18日（水）" }));
    await waitFor(() => expect(calls.at(-1)?.url).toContain("2026-11-18"));
    await user.click(screen.getByRole("button", { name: "‹ 前の週" }));
    await user.click(screen.getByRole("button", { name: "戻る" }));
    await user.click(screen.getByRole("radio", { name: "指名なし（おまかせ）" }));
    await user.click(screen.getByRole("button", { name: "戻る" }));
    expect(screen.getByRole("radio", { name: "骨盤矯正" })).toHaveAttribute("aria-checked", "true");
  });

  it("reuses the idempotency key when retrying after a network error", async () => {
    let attempt = 0;
    const calls = mockFetch((url) => {
      if (url.includes("availability")) return { body: { slots: [slot("10:30")] } };
      attempt += 1;
      if (attempt === 1) throw new TypeError("network");
      return { status: 201, body: {} };
    });
    let n = 0;
    const user = userEvent.setup();
    render(<BookingWizard store={STORE} today={TODAY} newKey={() => `key-${++n}`} />);
    await goToConfirm(user);
    await user.click(screen.getByRole("button", { name: "予約を送信する" }));
    expect(await screen.findByText(/通信に失敗しました/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "予約を送信する" }));
    expect(await screen.findByText("確認メールを送りました")).toBeInTheDocument();
    const keys = calls.filter((c) => c.url.endsWith("/bookings")).map((c) => JSON.parse(String(c.init?.body)).idempotency_key);
    expect(keys).toEqual(["key-1", "key-1"]);
  });

  it("shows availability errors", async () => {
    mockFetch(() => ({ status: 500, body: { message: "読み込めません" } }));
    const user = userEvent.setup();
    render(<BookingWizard store={STORE} today={TODAY} />);
    await user.click(screen.getByRole("radio", { name: "全身調整" }));
    await user.click(screen.getByRole("button", { name: "次へ：担当を選ぶ" }));
    await user.click(screen.getByRole("button", { name: "次へ：日時を選ぶ" }));
    expect(await screen.findByText("読み込めません")).toBeInTheDocument();
  });
});
