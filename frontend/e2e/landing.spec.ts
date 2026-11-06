import { expect, test } from "@playwright/test";

test("サービス紹介ページから先行導入に申し込める", async ({ page }) => {
  await page.goto("http://localhost:3000/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/施術中でも、\s*電話を取りこぼさない。/);
  await expect(page).toHaveTitle("ヨヤクル｜整体院・治療院向け AI予約受付");
  await page.getByRole("link", { name: "先行導入に申し込む" }).first().click();
  await page.getByLabel("お店の名前").fill("E2E整体院");
  await page.getByLabel("お名前").fill("試験 太郎");
  await page.getByLabel("メールアドレス").fill(`lead-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "送信する" }).click();
  await expect(page.getByText(/お申し込みありがとうございます/)).toBeVisible();
});
