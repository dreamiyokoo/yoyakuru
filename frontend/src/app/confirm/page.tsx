import { ConfirmView } from "@/components/booking/ConfirmView";
import { requireTenant } from "@/lib/site";

export const metadata = { title: "ご予約の確認", robots: { index: false } };

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  await requireTenant();
  const { token } = await searchParams;
  return <ConfirmView token={token ?? ""} />;
}
