import { expect, test, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const APP = "http://app.localhost:3000";
const PASSWORD = "e2e-demo-pass";

const TOTP_SECRET = "JBSWY3DPEHPK3PXP"; // playwright.config.ts の DEMO_TOTP_SECRET と同じ

/** 認証アプリと同じ6桁のコード（RFC 6238）。 */
function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = crypto.createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

let lastStep = 0;

/** 前回と違う30秒の区切りの6桁を待って返す（同じコードは使い回せない）。 */
async function freshCode(page: Page): Promise<string> {
  let now = Date.now();
  while (Math.floor(now / 30000) <= lastStep) {
    await page.waitForTimeout(1000);
    now = Date.now();
  }
  lastStep = Math.floor(now / 30000);
  return totp(TOTP_SECRET, now);
}

async function login(page: Page, email: string) {
  await page.goto(`${APP}/login`);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン" }).click();
  if (email.startsWith("owner")) {
    await page.getByLabel("確認コード").fill(await freshCode(page));
    await page.getByRole("button", { name: "確認する" }).click();
  }
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
  // 自分の予約を配信するカレンダーURLを発行し、取り込めることを確かめる
  const feed = page.getByRole("region", { name: "カレンダーアプリに表示" });
  await feed.getByRole("button", { name: /URLを(発行|再発行)/ }).first().click();
  const url = await feed.getByLabel("カレンダーのURL").inputValue();
  const ics = await page.request.get(url.replace("app.localhost", "localhost"));
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  expect(await ics.text()).toContain("X-WR-CALNAME:");
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
  test.setTimeout(120_000); // 二段階認証のコードを2回待つ（同じ30秒の区切りのコードは使えない）
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
  // アカウント：今のコードで本人を確かめ、回復コードを作り直す
  await page.getByRole("link", { name: "アカウント" }).click();
  await expect(page.getByText("二段階認証：設定済み")).toBeVisible();
  await page.getByLabel("認証アプリの6桁（または回復コード）").fill(await freshCode(page));
  await page.getByRole("button", { name: "回復コードを作り直す" }).click();
  await expect(page.getByText(/古い回復コードは使えなくなりました/)).toBeVisible();
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

test("オーナーがスタッフを招待し、招待されたひとがパスワードを決めて参加できる", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const email = `invited-${Date.now()}@example.com`;
  await login(page, "owner@fushimi.example");
  await page.getByRole("link", { name: "設定" }).click();
  await page.getByRole("tab", { name: "メンバー" }).click();
  await page.getByLabel("招待するひとのメールアドレス").fill(email);
  await page.getByLabel("担当者の表示名").fill("E2E担当");
  await page.getByRole("button", { name: "招待メールを送る" }).click();
  await expect(page.getByText(`${email} に招待メールを送りました。`)).toBeVisible();

  const invited = await (await browser.newContext()).newPage();
  await invited.goto(`${APP}/invite?token=${await inviteToken(email)}`);
  await expect(invited.getByText(/伏見整体院/)).toBeVisible();
  await invited.getByLabel("お名前").fill("招待 太郎");
  await invited.getByLabel("パスワードを決める").fill("e2e-invited-pass-2026");
  await invited.getByRole("button", { name: "参加する" }).click();
  await expect(invited.getByRole("heading", { name: "予約", exact: true })).toBeVisible();
  await invited.getByRole("link", { name: "カレンダー" }).click();
  await expect(invited.getByRole("region", { name: "E2E担当" })).toBeVisible(); // 自分の列だけ
});
