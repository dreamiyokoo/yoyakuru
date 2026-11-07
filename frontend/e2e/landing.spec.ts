import { expect, test } from "@playwright/test";

test("サービス紹介ページからGoogleで登録し、お支払いへ進む", async ({ page }) => {
  await page.goto("http://localhost:3000/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/施術中でも、\s*電話を取りこぼさない。/);
  await expect(page).toHaveTitle("ヨヤクル｜整体院・治療院向け AI予約受付");
  await page.getByRole("link", { name: "申し込む" }).first().click();
  await expect(page).toHaveURL("http://app.localhost:3000/signup");

  const sub = `e2e${Date.now().toString(36)}`;
  await page.getByLabel("お店の名前").fill("E2E整体院");
  await page.getByLabel("予約ページのURL").fill(sub);
  // Googleの認証は使わず、e2e の設定が用意する疑似ログインで入る
  await page.context().addCookies([{ name: "e2e_google_email", value: `${sub}@example.com`, url: "http://app.localhost:3000" }]);
  await page.getByRole("button", { name: "Googleで登録する" }).click();

  // 支払いが済むまでは使えない。E2E では Stripe を設定しないので「準備中」になる
  await expect(page.getByRole("heading", { name: "お支払いを登録して、利用を始めましょう" })).toBeVisible();
  await page.getByRole("button", { name: "お支払いを登録する" }).click();
  await expect(page.getByText("お支払いの受付を準備中です。しばらくお待ちください")).toBeVisible();

  // 予約ページも、支払いが済むまで公開しない
  const res = await page.request.get(`http://localhost:8000/api/v1/public/tenants/${sub}/`);
  expect(res.status()).toBe(404);
});
