import type { ReactNode } from "react";
import { LeadForm } from "./LeadForm";

/** サービス紹介ページ（LP）。Figma「LP PC（1440）／スマホ（375）」の構成に合わせる。 */
export function LandingPage() {
  return (
    <div className="bg-card text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="font-display text-xl font-bold text-button">ヨヤクル</span>
          <CtaLink small>先行導入に申し込む</CtaLink>
        </div>
      </header>

      <main>
        <section className="bg-surface">
          <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-14 md:grid-cols-2 md:py-20">
            <div className="flex flex-col gap-5">
              <p className="text-sm font-bold text-accent">整体院・治療院向け　AI予約受付</p>
              <h1 className="font-display text-3xl font-bold leading-tight md:text-4xl lg:text-5xl">
                <span className="whitespace-nowrap">施術中でも、</span>
                <br />
                <span className="whitespace-nowrap">電話を取りこぼさない。</span>
              </h1>
              <p className="leading-relaxed text-sub">
                AIが電話とチャットで予約を受け付け、ひとつの予約台帳にまとめます。スタッフとベッドの空きを同時に確認するので、二重予約の心配もありません。
              </p>
              <div className="flex flex-wrap gap-3">
                <CtaLink>先行導入に申し込む</CtaLink>
                <a href="#features" className="inline-flex min-h-12 items-center rounded-xl border-[1.5px] border-button bg-card px-6 font-bold text-button">
                  できることを見る
                </a>
              </div>
            </div>
            <PhoneMock />
          </div>
        </section>

        <Section eyebrow="お悩み" title="こんなこと、ありませんか？" tone="plain">
          <div className="grid gap-4 md:grid-cols-3">
            {["施術中は電話に出られず、予約を逃している", "予約が電話・LINE・紙に散らばっている", "予約の受付と確認に、毎日時間を取られている"].map((t) => (
              <div key={t} className="flex items-start gap-3 rounded-2xl border border-line p-5">
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger/10 font-bold text-danger">
                  !
                </span>
                <p className="font-bold">{t}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="features" eyebrow="ヨヤクルでできること" title="受付を、まるごとAIに。" tone="surface">
          <div className="grid gap-4 md:grid-cols-3">
            <Feature icon="電" title="AIが電話に出る" soon>
              空き状況を確認して、その場で予約を確定。相談は折り返しの依頼として受け付けます。
            </Feature>
            <Feature icon="予" title="Web・チャットで24時間予約">
              選ぶだけで予約が完了。営業時間やアクセスの質問には、AIが答えます。
            </Feature>
            <Feature icon="台" title="ひとつの予約台帳">
              電話もWebも同じ台帳で管理。スタッフとベッドの空きを同時に確認し、二重予約を防ぎます。
            </Feature>
          </div>
        </Section>

        <Section eyebrow="かんたん導入" title="はじめ方は3ステップ" tone="plain">
          <ol className="grid gap-4 md:grid-cols-3">
            {[
              ["AIと会話して初期設定", "スタッフ・ベッド・メニューを話すだけで、設定案ができます。"],
              ["予約ページの公開と電話の転送", "今の電話番号はそのまま。お店の電話からAI専用番号へ転送します。"],
              ["あとはAIが受付", "予約は自動で台帳へ。折り返しが必要なものだけ通知します。"],
            ].map(([title, body], i) => (
              <li key={title} className="rounded-2xl border border-line p-5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-button font-bold text-white">{i + 1}</span>
                <h3 className="mt-3 font-bold">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-sub">{body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section eyebrow="主な機能" title="整体院の予約に必要なものを" tone="surface">
          <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {[
              ["指名あり・指名なしの予約"],
              ["ベッドの数に合わせた受付"],
              ["会員登録なしで予約できる"],
              ["LINE・Googleでもかんたん入力", "soon"],
              ["予約をスマホのカレンダーに追加"],
              ["休み・シフトの管理"],
            ].map(([t, soon]) => (
              <li key={t} className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 font-bold">
                <span aria-hidden className="text-accent">
                  ✓
                </span>
                <span>
                  {t}
                  {soon ? <Soon /> : null}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section eyebrow="試してみる" title="AI電話を体験してみる" tone="plain">
          <div className="flex flex-col gap-2 rounded-2xl border border-line p-6 md:max-w-xl">
            <p className="text-sub">架空の整体院に電話をかけて、予約の流れを試せます。</p>
            <p className="text-sm font-bold">体験用の番号</p>
            <p className="font-display text-2xl font-bold">050-XXXX-XXXX（準備中）</p>
          </div>
        </Section>

        <Section eyebrow="料金" title="先行導入の店舗を募集中" tone="surface">
          <div className="rounded-2xl bg-card p-6 leading-relaxed md:max-w-2xl">
            <p>料金は、先行導入の店舗のご意見を伺いながら決めています。正式な料金は、公開時にお知らせします。</p>
            <p className="mt-3 font-bold">先行導入は、少数の店舗に限って行います。</p>
          </div>
        </Section>

        <Section eyebrow="FAQ" title="よくある質問" tone="plain">
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["今の電話番号は変わりますか？", "変わりません。お店の電話から、AI専用の番号へ転送します。"],
              ["ご年配のお客様でも使えますか？", "電話はこれまでどおりかけるだけです。Webでは会員登録なしで予約できます。"],
              ["AIが答えられないときは？", "折り返しの依頼として受け付け、店舗にお知らせします。"],
              ["契約の条件は？", "正式公開の時にお知らせします。先行導入の条件は、個別にご相談します。"],
            ].map(([q, a]) => (
              <details key={q} className="group rounded-2xl border border-line p-5" open>
                <summary className="cursor-pointer list-none font-bold">Q. {q}</summary>
                <p className="mt-2 text-sm leading-relaxed text-sub">{a}</p>
              </details>
            ))}
          </div>
        </Section>

        <Section id="apply" eyebrow="お申し込み" title="先行導入に申し込む" tone="surface">
          <div className="rounded-2xl bg-card p-6 md:max-w-xl">
            <LeadForm />
          </div>
        </Section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-8 text-sm text-sub md:flex-row md:justify-between">
          <span className="font-display font-bold text-button">ヨヤクル</span>
          <span>プライバシーポリシー（準備中）</span>
          <span>© 株式会社ドリーミ</span>
        </div>
      </footer>
    </div>
  );
}

function Section({ id, eyebrow, title, tone, children }: { id?: string; eyebrow: string; title: string; tone: "plain" | "surface"; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={tone === "surface" ? "bg-surface" : "bg-card"}>
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-14 md:py-20">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold text-accent">{eyebrow}</p>
          <h2 id={id ? `${id}-title` : undefined} className="font-display text-2xl font-bold md:text-3xl">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </section>
  );
}

function Feature({ icon, title, soon, children }: { icon: string; title: string; soon?: boolean; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-card p-6">
      <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl bg-button font-display text-lg font-bold text-white">
        {icon}
      </span>
      <h3 className="mt-4 text-lg font-bold">
        {title}
        {soon ? <Soon /> : null}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-sub">{children}</p>
    </div>
  );
}

function CtaLink({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <a
      href="#apply"
      className={`inline-flex items-center rounded-xl bg-button font-bold text-white transition-colors hover:bg-button-hover ${small ? "min-h-11 px-4 text-sm" : "min-h-12 px-6"}`}
    >
      {children}
    </a>
  );
}

/** 予約画面のイメージ（画像を使わず、実際の画面の部品で描く）。 */
function PhoneMock() {
  return (
    <div aria-hidden className="mx-auto w-64 rounded-[2rem] border-8 border-ink bg-card p-4 shadow-xl">
      <p className="text-xs font-bold text-sub">伏見整体院　ご予約</p>
      <p className="mt-3 text-sm font-bold">日時を選んでください</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
        {["10:00", "10:30", "11:00", "14:00", "14:30", "15:00"].map((t, i) => (
          <span key={t} className={`rounded-lg border py-2 ${i === 3 ? "border-button bg-button font-bold text-white" : "border-line"}`}>
            {t}
          </span>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-surface p-3 text-xs">
        <p className="font-bold">AI</p>
        <p className="mt-1 text-sub">駐車場は店舗の前に2台分あります。</p>
      </div>
      <span className="mt-4 block rounded-xl bg-button py-2 text-center text-sm font-bold text-white">次へ</span>
    </div>
  );
}

/** まだ提供していない機能の印（先行導入の期間中に順次提供）。 */
function Soon() {
  return <span className="ml-2 rounded-full bg-muted px-2 py-0.5 align-middle text-xs font-bold text-sub">準備中</span>;
}
