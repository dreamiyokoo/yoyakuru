// 存在しない・停止中の店舗でも店舗情報を出さない（TENANT-02）
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="text-xl font-bold">ページが見つかりません</h1>
      <p className="text-sub">URLをご確認ください。</p>
    </main>
  );
}
