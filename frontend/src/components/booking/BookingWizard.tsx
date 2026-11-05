"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, createHold, fetchAvailability } from "@/lib/api";
import { addDays, formatDateKey, formatDateTime, formatPrice, formatTime, toDateKey, weekdayOf } from "@/lib/format";
import type { CustomerType, Slot, Store } from "@/lib/types";
import { Button } from "../ui/Button";
import { ChoiceCard, Chip } from "../ui/Choice";
import { Field } from "../ui/Field";
import { Notice, Summary } from "../ui/Notice";
import { Screen } from "../ui/Screen";

type Step = "service" | "staff" | "datetime" | "info" | "confirm" | "sent";
const STEP_NUMBER: Record<string, number> = { service: 1, staff: 2, datetime: 3, info: 4 };
const STEP_LABEL: Record<string, string> = { service: "メニュー", staff: "担当", datetime: "日時", info: "お客様情報" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  store: Store;
  today?: string;
  newKey?: () => string;
}

export function BookingWizard({ store, today = toDateKey(new Date()), newKey = () => crypto.randomUUID() }: Props) {
  const [step, setStep] = useState<Step>("service");
  const [customerType, setCustomerType] = useState<CustomerType>("repeat");
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [staffId, setStaffId] = useState<number | null>(null);
  const [weekStart, setWeekStart] = useState(today);
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [taken, setTaken] = useState<Slot[] | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  const service = store.services.find((s) => s.id === serviceId) ?? null;
  const staffOptions = useMemo(() => store.staff.filter((s) => serviceId !== null && s.service_ids.includes(serviceId)), [store.staff, serviceId]);
  const staffName = (id: number | null) => store.staff.find((s) => s.id === id)?.display_name ?? "";
  const duration = service ? (customerType === "first" && service.first_visit_duration_minutes) || service.duration_minutes : 0;

  const back = () => {
    const order: Step[] = ["service", "staff", "datetime", "info", "confirm"];
    const i = order.indexOf(step);
    if (i > 0) setStep(order[i - 1]);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "お名前を入力してください";
    if (!EMAIL_RE.test(form.email.trim())) e.email = "メールアドレスを正しく入力してください";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!service || !slot) return;
    setSubmitting(true);
    setSubmitError("");
    idempotencyKey.current ??= newKey();
    try {
      await createHold(store.subdomain, {
        service: service.id,
        staff: staffId,
        starts_at: slot.starts_at,
        customer_type: customerType,
        customer_name: form.name.trim(),
        customer_email: form.email.trim(),
        customer_phone: form.phone.trim(),
        note: form.note.trim(),
        idempotency_key: idempotencyKey.current,
      });
      setStep("sent");
    } catch (e) {
      idempotencyKey.current = null;
      if (e instanceof ApiError && e.status === 409) {
        const res = await fetchAvailability(store.subdomain, { service: service.id, date, customer_type: customerType, staff: staffId }).catch(
          () => ({ slots: [] as Slot[] }),
        );
        setTaken(res.slots.filter((s) => s.starts_at > slot.starts_at).slice(0, 3));
      } else {
        setSubmitError(e instanceof ApiError ? e.message : "送信に失敗しました");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const stepInfo = STEP_NUMBER[step] ? { current: STEP_NUMBER[step], total: 4, label: STEP_LABEL[step] } : undefined;

  if (step === "sent") {
    return (
      <Screen title="確認メールを送りました">
        <Notice>
          <p className="font-bold">まだ予約は確定していません。</p>
          <p className="mt-1">{form.email} に届いたメールのリンクを、15分以内に開いてください。開くと予約が確定します。</p>
        </Notice>
        <Summary rows={summaryRows()} />
        <p className="text-xs text-sub">メールが届かない場合は、迷惑メールのフォルダをご確認ください。</p>
      </Screen>
    );
  }

  if (taken !== null && slot) {
    return (
      <Screen title="日時を選ぶ" onBack={() => { setTaken(null); setStep("datetime"); }} step={{ current: 3, total: 4, label: "日時" }}
        footer={
          <Button variant="secondary" onClick={() => { setTaken(null); setSlot(null); setStep("datetime"); }}>
            日付を選び直す
          </Button>
        }
      >
        <Notice tone="warn">選んだ枠（{formatDateTime(slot.starts_at)}）は、ほかの方のご予約で埋まりました。</Notice>
        {taken.length ? <h2 className="text-sm font-bold">近い空き枠</h2> : <p className="text-sm">この日の空き枠はありません。</p>}
        <div role="radiogroup" aria-label="近い空き枠" className="flex flex-col gap-2">
          {taken.map((s) => (
            <ChoiceCard key={s.starts_at} name={formatDateTime(s.starts_at)} selected={false} onSelect={() => { setSlot(s); setTaken(null); setStep("confirm"); }}>
              <span className="font-bold">{formatDateTime(s.starts_at)}</span>
            </ChoiceCard>
          ))}
        </div>
        <p className="text-xs text-sub">選んだメニュー・担当はそのまま残ります。</p>
      </Screen>
    );
  }

  function summaryRows(): [string, string][] {
    if (!service || !slot) return [];
    return [
      ["メニュー", `${service.name}（${duration}分）`],
      ["担当", staffId ? staffName(staffId) : "指名なし"],
      ["日時", formatDateTime(slot.starts_at)],
      ["お名前", form.name],
      ["メール", form.email],
      ...(service.price != null ? ([["料金", `${formatPrice(service.price)}（当日払い）`]] as [string, string][]) : []),
    ];
  }

  return (
    <Screen
      title={step === "confirm" ? "予約内容の確認" : `${store.name}　ご予約`}
      onBack={step === "service" ? undefined : back}
      step={stepInfo}
      footer={footerFor()}
    >
      {step === "service" && (
        <>
          <h2 className="text-sm font-bold">ご来店は初めてですか？</h2>
          <div role="radiogroup" aria-label="ご来店" className="flex gap-2">
            <Chip selected={customerType === "first"} onSelect={() => setCustomerType("first")}>初めて</Chip>
            <Chip selected={customerType === "repeat"} onSelect={() => setCustomerType("repeat")}>2回目以降</Chip>
          </div>
          <h2 className="text-sm font-bold">メニューを選んでください</h2>
          <div role="radiogroup" aria-label="メニュー" className="flex flex-col gap-2">
            {store.services.map((s) => {
              const minutes = (customerType === "first" && s.first_visit_duration_minutes) || s.duration_minutes;
              return (
                <ChoiceCard key={s.id} name={s.name} selected={serviceId === s.id} onSelect={() => { setServiceId(s.id); setStaffId(null); setSlot(null); }}>
                  <span className="flex justify-between font-bold">
                    <span>{s.name}</span>
                    <span>{formatPrice(s.price)}</span>
                  </span>
                  <span className="text-sm text-sub">{minutes}分</span>
                </ChoiceCard>
              );
            })}
          </div>
          <p className="text-xs text-sub">料金は税込です。</p>
        </>
      )}

      {step === "staff" && (
        <>
          <h2 className="text-sm font-bold">担当者を選んでください</h2>
          <div role="radiogroup" aria-label="担当" className="flex flex-col gap-2">
            <ChoiceCard name="指名なし（おまかせ）" selected={staffId === null} onSelect={() => { setStaffId(null); setSlot(null); }}>
              <span className="font-bold">指名なし（おまかせ）</span>
              <span className="block text-sm text-sub">空いている担当者をご案内します</span>
            </ChoiceCard>
            {staffOptions.map((s) => (
              <ChoiceCard key={s.id} name={s.display_name} selected={staffId === s.id} onSelect={() => { setStaffId(s.id); setSlot(null); }}>
                <span className="font-bold">{s.display_name}</span>
                {s.title ? <span className="block text-sm text-sub">{s.title}</span> : null}
              </ChoiceCard>
            ))}
          </div>
        </>
      )}

      {step === "datetime" && service && (
        <DateTimePicker
          slug={store.subdomain}
          serviceId={service.id}
          customerType={customerType}
          staffId={staffId}
          today={today}
          windowDays={store.booking_window_days}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          date={date}
          onDateChange={(d) => { setDate(d); setSlot(null); }}
          slot={slot}
          onSlotChange={setSlot}
        />
      )}

      {step === "info" && (
        <>
          <Field label="お名前" value={form.name} onChange={(name) => setForm({ ...form, name })} autoComplete="name" error={errors.name} required />
          <Field
            label="メールアドレス"
            type="email"
            value={form.email}
            onChange={(email) => setForm({ ...form, email })}
            autoComplete="email"
            hint="確認メールのリンクを開くと予約が確定します"
            error={errors.email}
            required
          />
          <Field label="電話番号（任意）" type="tel" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} autoComplete="tel" />
          <Field
            label="ご要望（任意）"
            value={form.note}
            onChange={(note) => setForm({ ...form, note })}
            multiline
            hint="症状や病歴は入力しないでください。来店時に伺います。"
          />
        </>
      )}

      {step === "confirm" && (
        <>
          <Summary rows={summaryRows()} />
          <Notice>送信すると15分間、枠を仮押さえします。確認メールのリンクを15分以内に開くと、予約が確定します。</Notice>
          {submitError ? <Notice tone="warn">{submitError}</Notice> : null}
        </>
      )}
    </Screen>
  );

  function footerFor() {
    switch (step) {
      case "service":
        return <Button disabled={!serviceId} onClick={() => setStep("staff")}>次へ：担当を選ぶ</Button>;
      case "staff":
        return <Button onClick={() => setStep("datetime")}>次へ：日時を選ぶ</Button>;
      case "datetime":
        return <Button disabled={!slot} onClick={() => setStep("info")}>次へ：お客様情報</Button>;
      case "info":
        return <Button onClick={() => validate() && setStep("confirm")}>確認へ</Button>;
      default:
        return (
          <>
            <Button disabled={submitting} onClick={submit}>{submitting ? "送信中…" : "予約を送信する"}</Button>
            <Button variant="secondary" onClick={() => setStep("info")}>修正する</Button>
          </>
        );
    }
  }
}

interface PickerProps {
  slug: string;
  serviceId: number;
  customerType: CustomerType;
  staffId: number | null;
  today: string;
  windowDays: number;
  weekStart: string;
  onWeekChange: (d: string) => void;
  date: string;
  onDateChange: (d: string) => void;
  slot: Slot | null;
  onSlotChange: (s: Slot) => void;
}

function DateTimePicker(p: PickerProps) {
  const [state, setState] = useState<{ key: string; slots: Slot[] | null; error: string }>({ key: "", slots: null, error: "" });
  const key = `${p.serviceId}|${p.customerType}|${p.staffId}|${p.date}`;
  const lastDay = addDays(p.today, p.windowDays);
  const days = Array.from({ length: 7 }, (_, i) => addDays(p.weekStart, i));

  useEffect(() => {
    let active = true;
    fetchAvailability(p.slug, { service: p.serviceId, date: p.date, customer_type: p.customerType, staff: p.staffId })
      .then((res) => active && setState({ key, slots: res.slots, error: "" }))
      .catch((e: unknown) => active && setState({ key, slots: [], error: e instanceof ApiError ? e.message : "読み込みに失敗しました" }));
    return () => {
      active = false;
    };
  }, [key, p.slug, p.serviceId, p.date, p.customerType, p.staffId]);

  const loading = state.key !== key;
  return (
    <>
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="min-h-11 rounded-md border border-line px-3 text-sm disabled:opacity-40"
          disabled={p.weekStart <= p.today}
          onClick={() => p.onWeekChange(addDays(p.weekStart, -7))}
        >
          ‹ 前の週
        </button>
        <span className="text-sm font-bold">{formatDateKey(p.weekStart).replace(/（.）/, "")}〜</span>
        <button
          type="button"
          className="min-h-11 rounded-md border border-line px-3 text-sm disabled:opacity-40"
          disabled={addDays(p.weekStart, 7) > lastDay}
          onClick={() => p.onWeekChange(addDays(p.weekStart, 7))}
        >
          次の週 ›
        </button>
      </div>
      <div role="radiogroup" aria-label="日付" className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const selected = d === p.date;
          const disabled = d < p.today || d > lastDay;
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={formatDateKey(d)}
              disabled={disabled}
              onClick={() => p.onDateChange(d)}
              className={`flex min-h-14 flex-col items-center justify-center rounded-lg border text-sm disabled:opacity-40 ${
                selected ? "border-button bg-button text-white" : "border-line"
              }`}
            >
              <span className="text-xs">{weekdayOf(d)}</span>
              <span className="font-bold">{Number(d.slice(8))}</span>
            </button>
          );
        })}
      </div>
      <h2 className="text-sm font-bold">{formatDateKey(p.date)}の空き</h2>
      {loading ? <p className="text-sm text-sub">読み込み中…</p> : null}
      {!loading && state.error ? <Notice tone="warn">{state.error}</Notice> : null}
      {!loading && !state.error && state.slots?.length === 0 ? (
        <p className="text-sm text-sub">この日は空きがありません。別の日をお選びください。</p>
      ) : null}
      {!loading && state.slots?.length ? (
        <div role="radiogroup" aria-label="時間" className="grid grid-cols-3 gap-2">
          {state.slots.map((s) => {
            const selected = p.slot?.starts_at === s.starts_at;
            return (
              <button
                key={s.starts_at}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => p.onSlotChange(s)}
                className={`min-h-11 rounded-lg border text-base ${selected ? "border-button bg-button font-bold text-white" : "border-line"}`}
              >
                {formatTime(s.starts_at)}
              </button>
            );
          })}
        </div>
      ) : null}
      <p className="text-xs text-sub">表示されていない時間は、予約済みか受付の締切を過ぎています。</p>
    </>
  );
}
