const TZ = "Asia/Tokyo";
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function parts(date: Date) {
  const f = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: get("hour").padStart(2, "0"),
    minute: get("minute"),
    weekday: get("weekday"),
  };
}

/** 店舗の日付（YYYY-MM-DD）。 */
export function toDateKey(date: Date): string {
  const p = parts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** YYYY-MM-DD に日数を足す。 */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function weekdayOf(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function formatTime(iso: string): string {
  const p = parts(new Date(iso));
  return `${p.hour}:${p.minute}`;
}

export function formatDateTime(iso: string): string {
  const p = parts(new Date(iso));
  return `${p.month}月${p.day}日（${p.weekday}）${p.hour}:${p.minute}`;
}

export function formatDateKey(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${m}月${d}日（${weekdayOf(key)}）`;
}

export function formatPrice(price: number | null): string {
  return price == null ? "" : `${price.toLocaleString("ja-JP")}円`;
}

export function googleCalendarUrl(title: string, startIso: string, endIso: string, details: string): string {
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${fmt(startIso)}/${fmt(endIso)}`, details });
  return `https://calendar.google.com/calendar/render?${q}`;
}
