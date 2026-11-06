import { InvitePage } from "@/components/admin/InvitePage";

export const metadata = { title: "招待" };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <InvitePage token={token} />;
}
