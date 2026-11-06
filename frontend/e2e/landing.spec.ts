import { expect, test } from "@playwright/test";
import { totp } from "./totp";

test("サービス紹介ページから登録し、二段階認証の後にお支払いへ進む", async ({ page }) => {
  await page.goto("http://localhost:3000/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/施術中でも、\s*電話を取りこぼさない。/);
  await expect(page).toHaveTitle("ヨヤクル｜整体院・治療院向け AI予約受付");
  await page.getByRole("link", { name: "申し込む" }).first().click();
  await expect(page).toHaveURL("http://app.localhost:3000/signup");

  const sub = `e2e${Date.now().toString(36)}`;
  await page.getByLabel("お店の名前").fill("E2E整体院");
  await page.getByLabel("予約ページのURL").fill(sub);
  await page.getByLabel("お名前").fill("試験 太郎");
  await page.getByLabel("メールアドレス").fill(`${sub}@example.com`);
  await page.getByLabel("パスワード").fill("e2e-signup-pass-1");
  await page.getByRole("button", { name: "登録する" }).click();

  // オーナーは二段階認証が必須
  await page.getByRole("button", { name: "設定を始める" }).click();
  const secret = (await page.locator(".font-mono").first().textContent())!.trim();
  await page.getByLabel("認証アプリに表示された6桁").fill(totp(secret));
  await page.getByRole("button", { name: "確認して有効にする" }).click();
  await page.getByRole("button", { name: "保存しました" }).click();

  // 支払いが済むまでは使えない。E2E では Stripe を設定しないので「準備中」になる
  await expect(page.getByRole("heading", { name: "お支払いを登録して、利用を始めましょう" })).toBeVisible();
  await page.getByRole("button", { name: "お支払いを登録する" }).click();
  await expect(page.getByText("お支払いの受付を準備中です。しばらくお待ちください")).toBeVisible();

  // 予約ページも、支払いが済むまで公開しない
  const res = await page.request.get(`http://localhost:8000/api/v1/public/tenants/${sub}/`);
  expect(res.status()).toBe(404);
});
