import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";

const SIGNUP = "https://app.example.test/signup";

describe("LandingPage", () => {
  it("shows the sections and sends people to sign up", () => {
    render(<LandingPage signupUrl={SIGNUP} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("施術中でも、電話を取りこぼさない。");
    for (const h of ["こんなこと、ありませんか？", "受付を、まるごとAIに。", "電話もWebも、ひとつの台帳で。", "はじめ方は3ステップ", "月額制で、すぐに始められます", "よくある質問", "今日から、AIに受付を任せる"])
      expect(screen.getByRole("heading", { name: h })).toBeInTheDocument();
    // AI電話（できること・体験）、LINE・Google入力、体験用の予約ページ（URL未設定）
    expect(screen.getAllByText("準備中")).toHaveLength(4);
    expect(screen.getByRole("img", { name: /画面イメージ/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /ちがい/ })).toBeInTheDocument();
    for (const link of [...screen.getAllByRole("link", { name: /申し込む/ }), screen.getByRole("link", { name: /登録して始める/ })])
      expect(link).toHaveAttribute("href", SIGNUP);
    expect(screen.queryByText(/先行導入/)).toBeNull();
    expect(screen.getByText("料金は、お申し込みの画面でご確認いただけます。")).toBeInTheDocument();
  });

  it("shows the price and the demo store when they are set", () => {
    render(<LandingPage signupUrl={SIGNUP} demoUrl="https://fushimi.example.test/" priceLabel="月額1,980円（税込）" />);
    expect(screen.getByRole("link", { name: "予約ページを開く" })).toHaveAttribute("href", "https://fushimi.example.test/");
    expect(screen.getAllByText("準備中")).toHaveLength(3);
    expect(screen.getByText("月額1,980円（税込）")).toBeInTheDocument();
    expect(screen.queryByText("料金は、お申し込みの画面でご確認いただけます。")).toBeNull();
  });
});
