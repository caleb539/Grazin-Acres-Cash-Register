export type SaleType = 'each' | 'weight';
export type Tender = 'cash' | 'check' | 'card_on_file';
export type MembershipStatus = 'active' | 'expiring_soon' | 'expired' | 'none' | 'renewed_in_store';

export interface Product {
  id: string;
  farmmatch_id: string;
  name: string;
  category: string | null;
  sale_type: SaleType;
  unit: string;
  price_cents: number;
  taxable: boolean;
  sort_order: number;
  /** Quantity price breaks from FarmMatch, lowest min first. Empty/missing = one price. */
  tiers?: PriceTier[];
}

/** From this quantity (in thousandths of the product's unit) up, every unit costs price_cents. */
export interface PriceTier {
  min_milli: number;
  price_cents: number;
}

export interface Member {
  id: string;
  farmmatch_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  phone_digits: string | null;
  membership_type: string | null;
  renewal_date: string | null;
  has_card_on_file: boolean;
  membership_status: MembershipStatus;
  /** Set when FarmMatch can't take this customer's orders (e.g. account/sign-up incomplete). Shown to the cashier. */
  farmmatch_issue?: string | null;
  /** Warnings the FarmMatch agent wrote on this customer's profile for the cashier. */
  warnings?: MemberWarning[];
}

export type WarningKind = 'no_payment_method' | 'account_incomplete' | 'other';

export interface MemberWarning {
  kind: WarningKind;
  message: string;
  updated_at?: string;
}

export interface Settings {
  store_name: string;
  tax_rate: number;
  expiring_soon_days: number;
  receipt_footer: string;
  /** Credit per returned jar, in cents (default 100 = $1). */
  jar_credit_cents: number;
  /** Membership renewal fee, in cents (default 3000 = $30). */
  membership_fee_cents: number;
}

export interface PendingCustomer {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
}

export type Customer =
  | { kind: 'member'; member: Member }
  | { kind: 'pending'; pending: PendingCustomer };

export interface CartLine {
  key: string;
  product: Product;
  qtyMilli: number;
  unitPriceCents: number;
}

/** A finished sale as stored on the iPad (history + upload queue). */
export interface LocalSale {
  id: string;
  receipt_number: string;
  device_id: string;
  cashier_name: string;
  sold_at: string;
  customer: Customer;
  lines: {
    product_id: string;
    name: string;
    sale_type: SaleType;
    unit: string;
    qtyMilli: number;
    unit_price_cents: number;
    line_total_cents: number;
    taxable: boolean;
  }[];
  subtotal_cents: number;
  tax_cents: number;
  membership_fee_cents: number;
  jar_returns: number;
  jar_credit_cents: number;
  total_cents: number;
  tender: Tender;
  cash_tendered_cents: number | null;
  change_cents: number | null;
  check_number: string | null;
  // upload state
  // queued/error: not on the server yet. not_sent: voided before it was ever uploaded.
  upload: 'queued' | 'uploaded' | 'error' | 'demo' | 'not_sent';
  upload_error?: string;
  pending_customer_id?: string; // server id once the in-store signup is created
  voided?: boolean;
}
