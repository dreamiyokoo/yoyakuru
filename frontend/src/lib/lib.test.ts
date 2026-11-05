import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "@/test-utils";
import { ApiError, cancelBooking, confirmBooking, createHold, fetchAvailability, fetchBooking, fetchStore, icsUrl } from "./api";
import { addDays, formatDateKey, formatDateTime, formatPrice, formatTime, googleCalendarUrl, toDateKey, weekdayOf } from "./format";

afterEach(() => vi.unstubAllGlobals());

describe("format", () => {
  it("formats in Japan time", () => {
    const iso = "2026-11-11T01:30:00Z";
    expect(formatTime(iso)).toBe("10:30");
    expect(formatDateTime(iso)).toBe("11月11日（水）10:30");
    expect(toDateKey(new Date("2026-11-10T16:00:00Z"))).toBe("2026-11-11");
  });
  it("handles date keys", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(weekdayOf("2026-11-15")).toBe("日");
    expect(formatDateKey("2026-11-11")).toBe("11月11日（水）");
  });
  it("formats price and calendar url", () => {
    expect(formatPrice(5000)).toBe("5,000円");
    expect(formatPrice(null)).toBe("");
    const url = googleCalendarUrl("予約", "2026-11-11T01:30:00Z", "2026-11-11T02:30:00Z", "担当");
    expect(url).toContain("dates=20261111T013000Z%2F20261111T023000Z");
  });
});

describe("api", () => {
  it("calls endpoints", async () => {
    const calls = mockFetch(() => ({ body: { ok: true } }));
    await fetchStore("fushimi", "http://b");
    await fetchAvailability("fushimi", { service: 1, date: "2026-11-11", customer_type: "first", staff: 10 });
    await fetchAvailability("fushimi", { service: 1, date: "2026-11-11", customer_type: "repeat" });
    await createHold("fushimi", {} as never);
    await confirmBooking("t");
    await fetchBooking("t");
    await cancelBooking("t");
    expect(calls.map((c) => c.url)).toEqual([
      "http://b/api/v1/public/tenants/fushimi/",
      "/api/v1/public/tenants/fushimi/availability?service=1&date=2026-11-11&customer_type=first&staff=10",
      "/api/v1/public/tenants/fushimi/availability?service=1&date=2026-11-11&customer_type=repeat",
      "/api/v1/public/tenants/fushimi/bookings",
      "/api/v1/public/bookings/confirm",
      "/api/v1/public/bookings/t",
      "/api/v1/public/bookings/t/cancel",
    ]);
    expect(icsUrl("a/b")).toBe("/api/v1/public/bookings/a%2Fb/ics");
  });
  it("maps errors", async () => {
    mockFetch(() => ({ status: 409, body: { code: "slot_unavailable", message: "埋まりました" } }));
    await expect(confirmBooking("t")).rejects.toMatchObject({ status: 409, code: "slot_unavailable", message: "埋まりました" });
    mockFetch(() => ({ status: 500, body: "x" }));
    await expect(confirmBooking("t")).rejects.toMatchObject({ status: 500, code: "error" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const err = await confirmBooking("t").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("network");
  });
  it("tolerates a non-json error body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 502 })));
    await expect(fetchBooking("t")).rejects.toMatchObject({ status: 502 });
  });
});
