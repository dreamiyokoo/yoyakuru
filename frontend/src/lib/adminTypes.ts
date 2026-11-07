import type { Service, Staff } from "./types";

export type Role = "owner" | "staff";

export interface Membership {
  subdomain: string;
  name: string;
  role: Role;
  staff_id: number | null;
  /** 月額の支払いが済んでいない（お支払い以外の管理画面は使えない） */
  billing_required: boolean;
  /** Stripe で支払い情報を管理する店舗（セルフ登録の店舗） */
  billing_managed: boolean;
}

export interface Billing {
  status: string;
  usable: boolean;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  manageable: boolean;
  configured: boolean;
  /** 料金の表記（例：月額1,980円（税込））。分からなければ空 */
  price_label: string;
}

export interface Me {
  email: string;
  name: string;
  /** 本人のGoogleカレンダーを接続しているか。切れていると、予約枠が出ない */
  calendar_connected: boolean;
  memberships: Membership[];
}

export interface AdminBooking {
  id: number;
  status: "hold" | "confirmed" | "cancelled" | "expired";
  starts_at: string;
  ends_at: string;
  hold_expires_at: string | null;
  service: number;
  service_name: string;
  staff: number;
  staff_name: string;
  customer_type: "first" | "repeat";
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  note: string;
  channel: "web" | "chat" | "phone" | "admin";
  auto_assigned: boolean;
  party_size: number;
  created_at: string;
  events?: { action: string; channel: string; actor_name: string; created_at: string }[];
}

export interface Options {
  tenant: { subdomain: string; name: string };
  role: Role;
  staff_id: number | null;
  services: Service[];
  staff: Staff[];
  /** Googleカレンダーが未接続・接続切れで、予約枠に出ていない担当者 */
  calendar_issues: { staff_id: number; name: string }[];
}
