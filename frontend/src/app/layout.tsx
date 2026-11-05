import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ヨヤクル",
  description: "電話もチャットも、AIが予約受付。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem" }}>
        {children}
      </body>
    </html>
  );
}
