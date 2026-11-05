export type CustomerType = "first" | "repeat";

export interface Service {
  id: number;
  name: string;
  category: string;
  description: string;
  price: number | null;
  duration_minutes: number;
  first_visit_duration_minutes: number | null;
  capacity: number;
}

export interface Staff {
  id: number;
  display_name: string;
  title: string;
  service_ids: number[];
}

export interface Store {
  subdomain: string;
  name: string;
  phone: string;
  address: string;
  slot_interval_minutes: number;
  booking_window_days: number;
  services: Service[];
  staff: Staff[];
}

export interface Slot {
  starts_at: string;
  ends_at: string;
  staff_ids: number[];
}

export type BookingStatus = "hold" | "confirmed" | "cancelled" | "expired";

export interface PublicBooking {
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  hold_expires_at: string | null;
  service_name: string;
  staff_name: string;
  store_name: string;
  store_phone: string;
  customer_name: string;
  auto_assigned: boolean;
  cancel_deadline?: string;
}

export interface HoldRequest {
  service: number;
  staff: number | null;
  starts_at: string;
  customer_type: CustomerType;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  note: string;
  idempotency_key: string;
}
