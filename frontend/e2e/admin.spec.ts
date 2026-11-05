import { expect, test, type Page } from "@playwright/test";

const APP = "http://app.localhost:3000";
const PASSWORD = "e2e-demo-pass";

async function login(page: Page, email: string) {
  await page.goto(`${APP}/login`);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: "予約", exact: true })).toBeVisible();
}

/** 翌週以降で、日曜（定休日）でない日付。 */
function openDay(): string {
  const d = new Date(Date.now() + 9 * 3600_000 + 8 * 86400_000);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test("オーナーが電話の予約を登録し、取消できる", async ({ page }) => {
  await login(page, "owner@fushimi.example");
  await page.getByRole("link", { name: "＋ 追加" }).click();
  await page.getByLabel("日付").fill(openDay());
  await page.getByRole("radiogroup", { name: "開始時刻" }).getByRole("radio").first().click();
  await page.getByLabel("お名前").fill("電話のお客様");
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("店舗で登録")).toBeVisible();
  await expect(page.getByText("電話のお客様")).toBeVisible();
  await page.getByRole("button", { name: "予約を取消" }).click();
  await page.getByRole("button", { name: "取消する" }).click();
  await expect(page.getByText(/予約を取消しました/)).toBeVisible();
});

test("スタッフは自分の列と自分の休みだけを扱える", async ({ page }) => {
  await login(page, "staff@fushimi.example");
  await page.getByRole("link", { name: "カレンダー" }).click();
  await expect(page.getByRole("region", { name: "Bさん" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Aさん" })).toHaveCount(0);
  await page.getByRole("link", { name: "休み" }).click();
  await expect(page.getByLabel("担当").locator("option")).toHaveText(["Bさん（自分）"]);
  await page.getByLabel("日付").fill(openDay());
  await page.getByRole("button", { name: "追加する" }).click();
  await expect(page.getByRole("button", { name: /の登録を削除/ })).toHaveCount(1);
});

test("店舗のサブドメインでは管理画面を開けない", async ({ page }) => {
  const res = await page.goto("http://fushimi.localhost:3000/login");
  expect(res?.status()).toBe(404);
});

test("オーナーは設定を変更でき、スタッフは設定を変更できない", async ({ page }) => {
  await login(page, "owner@fushimi.example");
  await page.getByRole("link", { name: "設定" }).click();
  // AIで設定：ことばから設定案を作り、1つずつ確認して反映する（E2Eでは外部のAIを呼ばない偽物）
  await page.getByLabel("店舗の様子").fill("ベッド2台です");
  await page.getByRole("button", { name: "設定案を作る" }).click();
  await expect(page.getByText("設備「ベッド」を2に変更")).toBeVisible();
  await page.getByRole("button", { name: "反映する" }).click();
  await expect(page.getByText(/設定案の確認が終わりました/)).toBeVisible();
  await page.getByRole("tab", { name: "予約ルール" }).click();
  await expect(page.getByLabel("店舗名")).toHaveValue(/./);
  await page.getByRole("tab", { name: "設備" }).click();
  const name = `E2E設備${Date.now()}`;
  await page.getByLabel("設備の名前").fill(name);
  await page.getByRole("button", { name: "設備を追加" }).click();
  await expect(page.getByText("保存しました。")).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();
  await page.getByRole("tab", { name: "担当者" }).click();
  await page.getByRole("button", { name: "勤務" }).first().click();
  await expect(page.getByRole("heading", { name: "週の勤務" })).toBeVisible();
  await page.getByRole("button", { name: "ログアウト" }).click();

  await login(page, "staff@fushimi.example");
  await page.getByRole("link", { name: "設定" }).click();
  await expect(page.getByText("設定はオーナーのみ変更できます。")).toBeVisible();
});
