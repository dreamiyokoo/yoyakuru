import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "@/test-utils";
import { LandingPage } from "./LandingPage";

afterEach(() => vi.unstubAllGlobals());

describe("LandingPage", () => {
  it("shows the sections and marks features that are not ready", () => {
    render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("施術中でも、電話を取りこぼさない。");
    for (const h of ["こんなこと、ありませんか？", "受付を、まるごとAIに。", "電話もWebも、ひとつの台帳で。", "はじめ方は3ステップ", "よくある質問", "先行導入に申し込む"])
      expect(screen.getByRole("heading", { name: h })).toBeInTheDocument();
    // AI電話（できること・体験）、LINE・Google入力、体験用の予約ページ（URL未設定）
    expect(screen.getAllByText("準備中")).toHaveLength(4);
    expect(screen.getByRole("img", { name: /画面イメージ/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /ちがい/ })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "先行導入に申し込む" })[0]).toHaveAttribute("href", "#apply");
  });

  it("links to the demo store when its URL is set", () => {
    render(<LandingPage demoUrl="https://fushimi.example.test/" />);
    expect(screen.getByRole("link", { name: "予約ページを開く" })).toHaveAttribute("href", "https://fushimi.example.test/");
    expect(screen.getAllByText("準備中")).toHaveLength(3);
  });

  it("validates and sends an application", async () => {
    let n = 0;
    const calls = mockFetch(() => (++n === 1 ? { status: 429, body: { detail: "しばらくしてからお試しください" } } : { status: 201, body: {} }));
    render(<LandingPage />);
    await userEvent.click(screen.getByRole("button", { name: "送信する" }));
    expect(screen.getByText("お店の名前を入力してください")).toBeInTheDocument();
    expect(screen.getByText("メールアドレスを正しく入力してください")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await userEvent.type(screen.getByLabelText("お店の名前"), "伏見整体院");
    await userEvent.type(screen.getByLabelText("お名前"), "伏見 太郎");
    await userEvent.type(screen.getByLabelText("メールアドレス"), "f@example.com");
    await userEvent.selectOptions(screen.getByLabelText("業種"), "美容院・サロン");
    await userEvent.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByText("しばらくしてからお試しください")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByText(/お申し込みありがとうございます/)).toBeInTheDocument();
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({ store_name: "伏見整体院", industry: "美容院・サロン", website: "" });
  });
});
