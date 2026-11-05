import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const MAIL_DIR = process.env.E2E_MAIL_DIR ?? "/tmp/yoyakuru-e2e-mail";

/** ファイルに書き出されたメールから、指定した宛先・種類のリンクのトークンを取り出す。 */
async function tokenFromMail(email: string, kind: "confirm" | "cancel"): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const files = fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).map((f) => path.join(MAIL_DIR, f)) : [];
    for (const file of files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)) {
      const raw = fs.readFileSync(file, "utf8").replace(/=\r?\n/g, "");
      if (!raw.includes(email)) continue;
      const m = raw.match(new RegExp(`/${kind}\\?token=(?:3D)?([A-Za-z0-9_-]{20,})`));
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`mail not found for ${email}`);
}

/** 取消の締切（前日まで）に余裕があるよう、翌週以降の最初の空き枠を選ぶ。 */
async function chooseFirstOpenSlot(page: Page) {
  await page.getByRole("button", { name: "次の週 ›" }).click();
  for (let week = 0; week < 3; week++) {
    const days = page.getByRole("radiogroup", { name: "日付" }).getByRole("radio");
    for (let i = 0; i < 7; i++) {
      const day = days.nth(i);
      if (await day.isDisabled()) continue;
      await day.click();
      const slots = page.getByRole("radiogroup", { name: "時間" }).getByRole("radio");
      const empty = page.getByText("この日は空きがありません");
      await expect(slots.first().or(empty)).toBeVisible();
      if (await slots.count()) {
        await slots.first().click();
        return;
      }
    }
    await page.getByRole("button", { name: "次の週 ›" }).click();
  }
  throw new Error("no open slot");
}

test("お客様が予約し、メールで確定し、取消できる", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "伏見整体院　ご予約" })).toBeVisible();
  await page.getByRole("radio", { name: "初めて" }).click();
  await page.getByRole("radio", { name: "全身調整" }).click();
  await page.getByRole("button", { name: "次へ：担当を選ぶ" }).click();
  await page.getByRole("radio", { name: "指名なし（おまかせ）" }).click();
  await page.getByRole("button", { name: "次へ：日時を選ぶ" }).click();
  await chooseFirstOpenSlot(page);
  await page.getByRole("button", { name: "次へ：お客様情報" }).click();
  await page.getByLabel("お名前").fill("山田 花子");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "確認へ" }).click();
  await expect(page.getByText("全身調整（90分）")).toBeVisible();
  await page.getByRole("button", { name: "予約を送信する" }).click();
  await expect(page.getByRole("heading", { name: "確認メールを送りました" })).toBeVisible();

  const token = await tokenFromMail(email, "confirm");
  await page.goto(`/confirm?token=${token}`);
  await expect(page.getByText("ご予約が確定しました")).toBeVisible();
  // API はどのホストでも同じ。テスト側（Node.js）は *.localhost を解決できないため localhost で呼ぶ
  const ics = await page.request.get(`http://localhost:3000/api/v1/public/bookings/${token}/ics`);
  expect(ics.status()).toBe(200);
  expect(await ics.text()).toContain("BEGIN:VEVENT");

  const cancelToken = await tokenFromMail(email, "cancel");
  await page.goto(`/cancel?token=${cancelToken}`);
  await page.getByRole("button", { name: "予約を取消する" }).click();
  await expect(page.getByText("ご予約を取消しました")).toBeVisible();
});

test("無効なリンクと存在しない店舗を案内する", async ({ page }) => {
  await page.goto("/confirm?token=invalid-token");
  await expect(page.getByText("予約が見つかりません")).toBeVisible();
  const res = await page.goto("http://no-such-store.localhost:3000/");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("ページが見つかりません")).toBeVisible();
});
