import { LoginPage } from "@/components/admin/LoginPage";

export const metadata = { title: "ログイン" };

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <LoginPage error={error} />;
}
