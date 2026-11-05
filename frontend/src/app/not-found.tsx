// 存在しない・停止中の店舗でも店舗情報を出さない（TENANT-02）
export default function NotFound() {
  return (
    <>
      <h1>ページが見つかりません</h1>
      <p>URLをご確認ください。</p>
    </>
  );
}
