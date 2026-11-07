import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const APP = "http://app.localhost:3000";

/** Googleの認証は使わず、e2e の設定が用意する疑似ログイン（決めたメールアドレスで入る）を使う。 */
async function login(page: Page, email: string) {
  await page.context().addCookies([{ name: "e2e_google_email", value: email, url: APP }]);
  await page.goto(`${APP}/login`);
  await page.getByRole("button", { name: "Googleでログイン" }).click();
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
  await page.getByRole("link", { name: "追加" }).click();
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

test("スタッフは自分の予約だけを扱え、カレンダー・休みの画面はない", async ({ page }) => {
  await login(page, "staff@fushimi.example");
  await expect(page.getByRole("navigation", { name: "管理メニュー" }).getByRole("link")).toHaveText(["予約", "設定"]);
  await page.getByRole("link", { name: "追加" }).click();
  await expect(page.getByLabel("担当")).toContainText("Bさん");
  await expect(page.getByLabel("担当").locator("option")).toHaveCount(1); // 自分の分だけ
});

test("登録のないGoogleアカウントではログインできない", async ({ page }) => {
  await page.context().addCookies([{ name: "e2e_google_email", value: "stranger@example.com", url: APP }]);
  await page.goto(`${APP}/login`);
  await page.getByRole("button", { name: "Googleでログイン" }).click();
  await expect(page.getByText(/このGoogleアカウントは登録されていません/)).toBeVisible();
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
  // 直前の変更（設備の追加）を履歴から取り消す
  await page.getByRole("tab", { name: "履歴" }).click();
  await expect(page.getByText("設備の追加").first()).toBeVisible();
  await page.getByRole("button", { name: "直前の変更を取り消す" }).click();
  await expect(page.getByText("保存しました。")).toBeVisible();
  await page.getByRole("tab", { name: "設備" }).click();
  await expect(page.getByLabel("設備の名前")).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
  await page.getByRole("tab", { name: "担当者" }).click();
  await page.getByRole("button", { name: "勤務" }).first().click();
  await expect(page.getByRole("heading", { name: "週の勤務" })).toBeVisible();
  // アカウント：Googleカレンダーの接続の状態を確かめる
  await page.getByRole("link", { name: "アカウント" }).click();
  await expect(page.getByText("Googleカレンダー：接続済み")).toBeVisible();
  await page.getByRole("button", { name: "ログアウト" }).click();

  await login(page, "staff@fushimi.example");
  await page.getByRole("link", { name: "設定" }).click();
  await expect(page.getByText("設定はオーナーのみ変更できます。")).toBeVisible();
});

/** ファイルに書き出された招待メールから、トークンを取り出す。 */
async function inviteToken(email: string): Promise<string> {
  const dir = process.env.E2E_MAIL_DIR ?? "/tmp/yoyakuru-e2e-mail";
  for (let i = 0; i < 50; i++) {
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const raw = fs.readFileSync(path.join(dir, f), "utf8").replace(/=\r?\n/g, "");
      if (!raw.includes(email)) continue;
      const m = raw.match(/\/invite\?token=(?:3D)?([A-Za-z0-9_-]{20,})/);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`invitation mail not found for ${email}`);
}

test("オーナーがスタッフを招待し、招待されたひとがGoogleで参加できる", async ({ page, browser }) => {
  const email = `invited-${Date.now()}@example.com`;
  await login(page, "owner@fushimi.example");
  await page.getByRole("link", { name: "設定" }).click();
  await page.getByRole("tab", { name: "メンバー" }).click();
  await page.getByLabel("招待するひとのメールアドレス").fill(email);
  await page.getByLabel("担当者の表示名").fill("E2E担当");
  await page.getByRole("button", { name: "招待メールを送る" }).click();
  await expect(page.getByText(`${email} に招待メールを送りました。`)).toBeVisible();

  const context = await browser.newContext();
  await context.addCookies([{ name: "e2e_google_email", value: email, url: APP }]);
  const invited = await context.newPage();
  await invited.goto(`${APP}/invite?token=${await inviteToken(email)}`);
  await expect(invited.getByText(/伏見整体院/)).toBeVisible();
  await invited.getByRole("button", { name: "Googleで参加する" }).click();
  await expect(invited.getByRole("heading", { name: "予約", exact: true })).toBeVisible();
  await invited.getByRole("link", { name: "アカウント" }).click();
  await expect(invited.getByText("Googleカレンダー：接続済み")).toBeVisible();
});
