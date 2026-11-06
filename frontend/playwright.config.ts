import { defineConfig, devices } from "@playwright/test";

const backendPort = 8000;
const frontendPort = 3000;
const mailDir = process.env.E2E_MAIL_DIR ?? "/tmp/yoyakuru-e2e-mail";

// 店舗のサブドメインで動かす。Chromium は *.localhost を自分自身として解決する
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://fushimi.localhost:${frontendPort}`,
    ...devices["iPhone 13"],
    browserName: "chromium",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: `cd ../backend && python manage.py migrate --noinput && python manage.py seed_demo --reset && python manage.py runserver ${backendPort} --noreload`,
      url: `http://localhost:${backendPort}/health`,
      reuseExistingServer: !process.env.CI,
      env: { DJANGO_SETTINGS_MODULE: "config.settings.e2e", E2E_MAIL_DIR: mailDir, DEMO_USER_PASSWORD: "e2e-demo-pass", DEMO_TOTP_SECRET: "JBSWY3DPEHPK3PXP" },
      timeout: 120_000,
    },
    {
      command: `npm run build && npm run start -- -p ${frontendPort}`,
      url: `http://localhost:${frontendPort}/`,
      reuseExistingServer: !process.env.CI,
      env: { BACKEND_INTERNAL_URL: `http://localhost:${backendPort}`, NEXT_PUBLIC_BASE_DOMAIN: "localhost" },
      timeout: 240_000,
    },
  ],
});
