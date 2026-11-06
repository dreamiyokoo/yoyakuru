import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookingWizard } from "@/components/booking/BookingWizard";
import { LandingPage } from "@/components/lp/LandingPage";
import { currentSite, loadStore } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { site, subdomain } = await currentSite();
  if (site === "tenant" && subdomain) {
    const store = await loadStore(subdomain);
    return { title: `${store.name} ご予約` };
  }
  if (site === "app") return {};
  const description = "施術中でも、電話を取りこぼさない。AIが電話とチャットで予約を受け付け、ひとつの予約台帳にまとめます。整体院・治療院向けの予約受付サービス。";
  return {
    metadataBase: new URL(`https://${process.env.NEXT_PUBLIC_BASE_DOMAIN ?? "dreami.blog"}`),
    title: { absolute: "ヨヤクル｜整体院・治療院向け AI予約受付" },
    description,
    openGraph: {
      title: "ヨヤクル｜整体院・治療院向け AI予約受付",
      description,
      type: "website",
      locale: "ja_JP",
      images: [{ url: "/og/default.png", width: 1200, height: 630, alt: "ヨヤクル" }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function Home() {
  const { site, subdomain } = await currentSite();

  if (site === "app") redirect("/bookings");

  if (site === "tenant" && subdomain) {
    const store = await loadStore(subdomain);
    return <BookingWizard store={store} />;
  }

  // 体験用店舗の予約ページ（例：https://fushimi.dreami.blog/）。未設定なら「準備中」と表示する
  return <LandingPage demoUrl={process.env.DEMO_STORE_URL || undefined} />;
}
