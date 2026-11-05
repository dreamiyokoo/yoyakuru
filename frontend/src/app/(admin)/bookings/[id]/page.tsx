import { notFound } from "next/navigation";
import { BookingDetailPage } from "@/components/admin/BookingDetailPage";

export const metadata = { title: "予約の詳細" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <BookingDetailPage id={Number(id)} />;
}
