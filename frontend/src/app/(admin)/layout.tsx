import { notFound } from "next/navigation";
import { AdminProvider } from "@/components/admin/AdminContext";
import { currentSite } from "@/lib/site";

export const metadata = { robots: { index: false } };

/** 管理画面は app. のホストでだけ表示する。 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { site } = await currentSite();
  if (site !== "app") notFound();
  return <AdminProvider>{children}</AdminProvider>;
}
