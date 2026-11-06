import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";

// 日本語フォントはサブセットの事前読み込みができないため preload を切り、必要な文字だけ読み込ませる
const notoSans = Noto_Sans_JP({ weight: ["400", "700"], display: "swap", preload: false, variable: "--font-noto" });
const zenKaku = Zen_Kaku_Gothic_New({ weight: ["700"], display: "swap", preload: false, variable: "--font-zen" });

export const metadata: Metadata = {
  title: { default: "ヨヤクル", template: "%s | ヨヤクル" },
  description: "電話もチャットも、AIが予約受付。",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${notoSans.variable} ${zenKaku.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
