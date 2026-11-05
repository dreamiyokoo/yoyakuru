import { CancelView } from "@/components/booking/CancelView";
import { requireTenant } from "@/lib/site";

export const metadata = { title: "予約の取消", robots: { index: false } };

export default async function CancelPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  await requireTenant();
  const { token } = await searchParams;
  return <CancelView token={token ?? ""} />;
}
