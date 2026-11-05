import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookingWizard } from "@/components/booking/BookingWizard";
import { currentSite, loadStore } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { site, subdomain } = await currentSite();
  if (site === "tenant" && subdomain) {
    const store = await loadStore(subdomain);
    return { title: `${store.name} ご予約` };
  }
  return {};
}

export default async function Home() {
  const { site, subdomain } = await currentSite();

  if (site === "app") redirect("/bookings");

  if (site === "tenant" && subdomain) {
    const store = await loadStore(subdomain);
    return <BookingWizard store={store} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-3xl font-bold text-button">ヨヤクル</h1>
      <p className="text-sub">電話もチャットも、AIが予約受付。</p>
    </main>
  );
}
