import type { ReactNode } from "react";
import { ArrowRight, Calendar, Chat, Check, ChevronDown, Clock, Layers, Minus, Phone, PhoneOff } from "./icons";

/**
 * サービス紹介ページ（LP）。
 * design-system/yoyakuru/pages/landing.md の構成・色・書体に合わせる。
 * demoUrl：チャット予約を試せる体験用店舗のURL（未設定なら「準備中」と表示）。
 */
export function LandingPage({ demoUrl, signupUrl, priceLabel }: { demoUrl?: string; signupUrl: string; priceLabel?: string }) {
  return (
    <div className="bg-card text-ink">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <a href="#top" className="flex items-center" aria-label="ヨヤクル トップへ">
            {/* eslint-disable-next-line @next/next/no-img-element -- 文字を含むSVGロゴは最適化の対象外 */}
            <img src="/brand/logo.svg" alt="ヨヤクル" width={131} height={36} className="h-9 w-auto" />
          </a>
          <nav aria-label="ページ内" className="hidden items-center gap-6 text-sm font-bold text-sub md:flex">
            <a href="#features" className="transition-colors duration-200 hover:text-button">できること</a>
            <a href="#compare" className="transition-colors duration-200 hover:text-button">ちがい</a>
            <a href="#demo" className="transition-colors duration-200 hover:text-button">体験</a>
            <a href="#faq" className="transition-colors duration-200 hover:text-button">よくある質問</a>
          </nav>
          <CtaLink href={signupUrl} small>
            申し込む
          </CtaLink>
        </div>
      </header>

      <main id="top">
        <Hero signupUrl={signupUrl} />

        <Section eyebrow="お悩み" title="こんなこと、ありませんか？" tone="plain">
          <div className="grid gap-4 md:grid-cols-3">
            {(
              [
                [PhoneOff, "施術中は電話に出られない", "鳴っている電話に出られず、新しいお客様を逃しているかもしれません。"],
                [Layers, "予約があちこちに散らばる", "電話・LINE・紙の台帳。確認するたびに見比べる手間がかかります。"],
                [Clock, "受付と確認に時間を取られる", "営業時間や駐車場の問い合わせに、毎日何度も答えています。"],
              ] as const
            ).map(([Icon, title, body]) => (
              <div key={title} className="flex gap-4 rounded-2xl border border-line bg-card p-6">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger">
                  <Icon />
                </span>
                <div>
                  <h3 className="text-lg font-bold">{title}</h3>
                  <p className="mt-1 leading-relaxed text-sub">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="features" eyebrow="ヨヤクルでできること" title="受付を、まるごとAIに。" tone="surface">
          <div className="grid gap-5 md:grid-cols-3">
            <Feature icon={<Phone />} title="AIが電話に出る" soon>
              空き状況を確認して、その場で予約を確定。相談は折り返しの依頼として受け付けます。
            </Feature>
            <Feature icon={<Chat />} title="Web・チャットで24時間予約">
              選ぶだけで予約が完了。営業時間やアクセスの質問には、AIが答えます。
            </Feature>
            <Feature icon={<Calendar />} title="ひとつの予約台帳">
              電話もWebも同じ台帳で管理。スタッフとベッドの空きを同時に確認し、二重予約を防ぎます。
            </Feature>
          </div>
        </Section>

        <Section id="compare" eyebrow="ほかのサービスとのちがい" title="電話もWebも、ひとつの台帳で。" tone="plain">
          <Comparison />
        </Section>

        <Section eyebrow="かんたん導入" title="はじめ方は3ステップ" tone="surface">
          <ol className="grid gap-5 md:grid-cols-3">
            {[
              ["AIと会話して初期設定", "スタッフ・ベッド・メニューを話すだけで、設定案ができます。"],
              ["予約ページの公開と電話の転送", "今の電話番号はそのまま。お店の電話からAI専用番号へ転送します。"],
              ["あとはAIが受付", "予約は自動で台帳へ。折り返しが必要なものだけお知らせします。"],
            ].map(([title, body], i) => (
              <li key={title} className="relative rounded-2xl bg-card p-6 shadow-sm">
                <span className="font-display text-4xl font-bold text-primary/30">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-2 text-lg font-bold">{title}</h3>
                <p className="mt-1 leading-relaxed text-sub">{body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section eyebrow="主な機能" title="整体院の予約に必要なものを" tone="plain">
          <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {[
              ["指名あり・指名なしの予約"],
              ["ベッドの数に合わせた受付"],
              ["会員登録なしで予約できる"],
              ["LINE・Googleでもかんたん入力", "soon"],
              ["予約をスマホのカレンダーに追加"],
              ["休み・シフトの管理"],
            ].map(([t, soon]) => (
              <li key={t} className="flex items-center gap-3 rounded-xl border border-line px-4 py-4 font-bold">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Check className="h-4 w-4" />
                </span>
                <span>
                  {t}
                  {soon ? <Soon /> : null}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="demo" eyebrow="試してみる" title="架空の整体院で、予約を体験" tone="surface">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-2xl bg-card p-6 shadow-sm">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-button text-white">
                <Phone />
              </span>
              <h3 className="text-lg font-bold">
                AI電話で予約する
                <Soon />
              </h3>
              <p className="leading-relaxed text-sub">体験用の番号に電話をかけて、AIとの会話で予約する流れを試せます。</p>
              <p className="mt-auto font-display text-xl font-bold text-sub">番号は公開準備中です</p>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl bg-card p-6 shadow-sm">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-button text-white">
                <Chat />
              </span>
              <h3 className="text-lg font-bold">
                Web・チャットで予約する
                {demoUrl ? null : <Soon />}
              </h3>
              <p className="leading-relaxed text-sub">お客様が見る予約ページです。日時を選んだり、チャットで質問したりできます。</p>
              {demoUrl ? (
                <a
                  href={demoUrl}
                  target="_blank"
                  rel="noopener"
                  className="mt-auto inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-[1.5px] border-button px-6 font-bold text-button transition-colors duration-200 hover:bg-surface"
                >
                  予約ページを開く
                  <ArrowRight className="h-5 w-5" />
                </a>
              ) : (
                <p className="mt-auto font-display text-xl font-bold text-sub">体験ページは公開準備中です</p>
              )}
            </div>
          </div>
        </Section>

        <Section id="price" eyebrow="料金" title="月額制で、すぐに始められます" tone="plain">
          <div className="flex flex-col gap-5 rounded-2xl border-2 border-primary/40 bg-surface p-6 md:flex-row md:items-center md:justify-between md:p-8">
            <div className="flex flex-col gap-2 leading-relaxed">
              {priceLabel ? <p className="font-display text-3xl font-bold text-button">{priceLabel}</p> : null}
              <p>スタッフの人数で料金は増えません。お支払いはクレジットカードで、いつでも解約できます。</p>
              {priceLabel ? null : <p className="text-sub">料金は、お申し込みの画面でご確認いただけます。</p>}
            </div>
            <CtaLink href={signupUrl}>申し込む</CtaLink>
          </div>
        </Section>

        <Section id="faq" eyebrow="FAQ" title="よくある質問" tone="surface">
          <div className="flex flex-col gap-3 md:max-w-3xl">
            {[
              ["今の電話番号は変わりますか？", "変わりません。お店の電話から、AI専用の番号へ転送します。"],
              ["ご年配のお客様でも使えますか？", "電話はこれまでどおりかけるだけです。Webでは会員登録なしで予約できます。"],
              ["AIが答えられないときは？", "折り返しの依頼として受け付け、店舗にお知らせします。"],
              ["契約の期間や解約は？", "月額制です。管理画面の「アカウント」から、いつでも解約の手続きができます。"],
            ].map(([q, a]) => (
              <details key={q} className="group rounded-2xl bg-card px-5 shadow-sm">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 font-bold [&::-webkit-details-marker]:hidden">
                  <span>
                    <span className="mr-2 text-primary">Q.</span>
                    {q}
                  </span>
                  <ChevronDown className="h-5 w-5 shrink-0 text-sub transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <p className="pb-5 leading-relaxed text-sub">{a}</p>
              </details>
            ))}
          </div>
        </Section>

        <section id="apply" aria-labelledby="apply-title" className="bg-ink text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:items-center md:py-24">
            <div className="flex flex-col gap-4">
              <p className="text-sm font-bold text-line">お申し込み</p>
              <h2 id="apply-title" className="font-display text-3xl font-bold leading-tight md:text-4xl">
                今日から、AIに受付を任せる
              </h2>
              <p className="leading-relaxed text-white/85">
                登録からお支払いまで、画面の案内に沿って数分で終わります。お店の設定は、AIと会話するだけで進められます。
              </p>
            </div>
            <div className="flex flex-col gap-5 rounded-2xl bg-card p-6 text-ink shadow-xl md:p-8">
              <ol className="flex flex-col gap-3">
                {["お店の名前とメールアドレスで登録", "ログインを守る二段階認証を設定", "クレジットカードでお支払いを登録"].map((t, i) => (
                  <li key={t} className="flex items-center gap-3 font-bold">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-button text-sm text-white">{i + 1}</span>
                    {t}
                  </li>
                ))}
              </ol>
              <CtaLink href={signupUrl}>登録して始める</CtaLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-ink text-white/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 border-t border-white/15 px-4 py-8 text-sm md:flex-row md:items-center md:justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element -- 文字を含むSVGロゴは最適化の対象外 */}
          <img src="/brand/logo-white.svg" alt="ヨヤクル" width={116} height={32} className="h-8 w-auto" />
          <span>プライバシーポリシー（準備中）</span>
          <span>© 株式会社ドリーミ</span>
        </div>
      </footer>
    </div>
  );
}

function Hero({ signupUrl }: { signupUrl: string }) {
  return (
    <section className="relative overflow-hidden bg-surface">
      <div aria-hidden className="absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-line/40 blur-3xl" />
      <div aria-hidden className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 pb-14 pt-10 md:py-16 lg:grid-cols-[1fr_460px] lg:py-20">
        <div className="flex flex-col gap-6">
          <p className="inline-flex w-fit items-center gap-2 rounded-full bg-card px-4 py-1.5 text-sm font-bold text-accent shadow-sm">
            <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />
            整体院・治療院向け　AI予約受付
          </p>
          <h1 className="font-display text-[1.625rem] font-bold leading-[1.3] min-[360px]:text-[1.75rem] min-[380px]:text-[2rem] md:text-[2.5rem] lg:text-[2.625rem] xl:text-5xl xl:leading-[1.25]">
            <span className="whitespace-nowrap">施術中でも、</span>
            <br />
            <span className="whitespace-nowrap">
              電話を<span className="text-primary">取りこぼさない。</span>
            </span>
          </h1>
          <p className="text-lg leading-relaxed text-sub">
            AIが電話とチャットで予約を受け付け、ひとつの予約台帳にまとめます。スタッフとベッドの空きを同時に確認するので、二重予約の心配もありません。
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <CtaLink href={signupUrl}>申し込む</CtaLink>
            <a
              href="#demo"
              className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-[1.5px] border-button bg-card px-6 font-bold text-button transition-colors duration-200 hover:bg-surface"
            >
              予約の流れを体験する
            </a>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold text-sub">
            {["今の電話番号のまま", "会員登録なしで予約", "二重予約を防ぐ"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-accent" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        {/* 画像は2倍の解像度で用意済み（合計約120KB）。本番の next dev ＋トンネル環境では
            /_next/image の最適化が失敗したため、public から直接配信する */}
        <picture className="mx-auto block w-full max-w-[327px] md:max-w-[460px]">
          <source media="(min-width: 768px)" srcSet="/lp/hero-pc.png" width={460} height={420} />
          <img
            src="/lp/hero-sp.png"
            alt="ヨヤクルの予約台帳と予約ページの画面イメージ"
            width={327}
            height={220}
            fetchPriority="high"
            className="h-auto w-full rounded-3xl shadow-xl shadow-ink/10"
          />
        </picture>
      </div>
    </section>
  );
}

function Comparison() {
  const rows: [string, ReactNode, ReactNode, ReactNode][] = [
    ["電話の受付", <No key="a" label="人が対応" />, <Yes key="b" label="AIが対応" />, <Yes key="c" label="AIが対応（準備中）" />],
    ["Web・チャット予約", <Yes key="a" label="あり" />, <No key="b" label="別のサービス" />, <Yes key="c" label="あり" />],
    ["予約台帳", <No key="a" label="電話分は手入力" />, <No key="b" label="別に確認" />, <Yes key="c" label="ひとつにまとまる" />],
    ["ベッドとスタッフの空き", <No key="a" label="サービスによる" />, <No key="b" label="サービスによる" />, <Yes key="c" label="同時に確認" />],
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <table className="w-full table-fixed border-collapse text-left text-sm md:text-base">
        <caption className="sr-only">一般的な予約システム・一般的なAI電話とヨヤクルのちがい</caption>
        <thead>
          <tr className="bg-surface">
            <th scope="col" className="w-[28%] p-3 md:p-4">
              <span className="sr-only">項目</span>
            </th>
            <th scope="col" className="p-3 font-bold text-sub md:p-4">
              <span className="block text-xs font-normal">一般的な</span>予約システム
            </th>
            <th scope="col" className="p-3 font-bold text-sub md:p-4">
              <span className="block text-xs font-normal">一般的な</span>AI電話
            </th>
            <th scope="col" className="bg-button p-3 font-display font-bold text-white md:p-4">
              ヨヤクル
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b, c]) => (
            <tr key={label} className="border-t border-line">
              <th scope="row" className="p-3 font-bold md:p-4">
                {label}
              </th>
              <td className="p-3 md:p-4">{a}</td>
              <td className="p-3 md:p-4">{b}</td>
              <td className="bg-surface p-3 md:p-4">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Yes({ label }: { label: string }) {
  return (
    <span className="flex flex-col items-start gap-1 md:flex-row md:items-center md:gap-2">
      <Check className="h-5 w-5 shrink-0 text-accent" />
      <span className="font-bold">{label}</span>
    </span>
  );
}

function No({ label }: { label: string }) {
  return (
    <span className="flex flex-col items-start gap-1 text-sub md:flex-row md:items-center md:gap-2">
      <Minus className="h-5 w-5 shrink-0" />
      <span>{label}</span>
    </span>
  );
}

function Section({ id, eyebrow, title, tone, children }: { id?: string; eyebrow: string; title: string; tone: "plain" | "surface"; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={`scroll-mt-16 ${tone === "surface" ? "bg-surface" : "bg-card"}`}>
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 md:py-24">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-bold tracking-wider text-accent">{eyebrow}</p>
          <h2 id={id ? `${id}-title` : undefined} className="font-display text-[1.75rem] font-bold leading-snug md:text-4xl">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </section>
  );
}

function Feature({ icon, title, soon, children }: { icon: ReactNode; title: string; soon?: boolean; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-card p-6 shadow-sm transition-shadow duration-200 hover:shadow-md md:p-8">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-button text-white">{icon}</span>
      <h3 className="mt-5 text-lg font-bold">
        {title}
        {soon ? <Soon /> : null}
      </h3>
      <p className="mt-2 leading-relaxed text-sub">{children}</p>
    </div>
  );
}

function CtaLink({ href, children, small }: { href: string; children: ReactNode; small?: boolean }) {
  return (
    <a
      href={href}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-button font-bold text-white shadow-sm transition-colors duration-200 hover:bg-button-hover ${small ? "min-h-11 px-4 text-sm" : "min-h-12 px-6"}`}
    >
      {children}
      {small ? null : <ArrowRight className="h-5 w-5" />}
    </a>
  );
}

/** まだ提供していない機能の印（順次提供）。 */
function Soon() {
  return <span className="ml-2 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 align-middle text-xs font-bold text-sub">準備中</span>;
}
