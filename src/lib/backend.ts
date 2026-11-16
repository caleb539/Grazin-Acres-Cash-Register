// Supabase access: sign-in, catalog download, sale upload, void.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Catalog } from './local';
import { milliToNumber } from './money';
import type { LocalSale, Member, PriceTier, Product, Settings } from './types';
import type { UsualRow } from './usuals';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
export const isConfigured = supabase !== null;

function db(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await db().auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  await db().auth.signOut();
}

export async function hasSession(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return data.session !== null;
}

const PAGE = 1000;

async function fetchAll<T>(table: string, select: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db().from(table).select(select).order('id').range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...(data as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

export async function downloadCatalog(): Promise<Catalog> {
  const [products, members, settingsRes, tiers] = await Promise.all([
    // register_products = active products minus register_hide_rules (preorders etc.)
    fetchAll<Product>('register_products',
      'id, farmmatch_id, name, category, sale_type, unit, price_cents, taxable, sort_order'),
    fetchAll<Member>('member_lookup', '*'),
    db().from('settings').select('store_name, tax_rate, expiring_soon_days, receipt_footer, jar_credit_cents, membership_fee_cents').single(),
    fetchAll<{ product_id: string; min_qty: number | string; unit_price_cents: number }>(
      'product_price_tiers', 'id, product_id, min_qty, unit_price_cents'),
  ]);
  if (settingsRes.error) throw new Error(settingsRes.error.message);
  // Quantity price breaks (synced from FarmMatch), attached to each product.
  const byProduct = new Map<string, PriceTier[]>();
  for (const t of tiers) {
    const list = byProduct.get(t.product_id) ?? [];
    list.push({ min_milli: Math.round(Number(t.min_qty) * 1000), price_cents: t.unit_price_cents });
    byProduct.set(t.product_id, list);
  }
  for (const p of products) {
    const list = byProduct.get(p.id);
    if (list) p.tiers = list.sort((a, b) => a.min_milli - b.min_milli);
  }
  const settings = settingsRes.data as Settings;
  settings.tax_rate = Number(settings.tax_rate);
  return { products, members, settings, refreshed_at: new Date().toISOString() };
}

export class PermanentUploadError extends Error {}

/** PostgREST returns a SQLSTATE code for database-side rejections; network failures have none. */
function classify(error: { message: string; code?: string }): Error {
  const code = error.code ?? '';
  const transient = code === '' || code.startsWith('PGRST3') /* auth/JWT */ || code === '57014';
  return transient ? new Error(error.message) : new PermanentUploadError(error.message);
}

/**
 * Upload one sale. Idempotent on the server (same sale id twice is a no-op).
 * Returns the updated sale (e.g. with pending_customer_id filled in).
 * Throws PermanentUploadError if the server rejected it, Error if it should be retried.
 */
export async function uploadSale(sale: LocalSale): Promise<LocalSale> {
  let s = sale;
  if (s.customer.kind === 'pending' && !s.pending_customer_id) {
    const pc = s.customer.pending;
    const { data, error } = await db().rpc('add_pending_customer', {
      p_first_name: pc.first_name, p_last_name: pc.last_name, p_phone: pc.phone, p_email: pc.email,
    });
    if (error) throw classify(error);
    s = { ...s, pending_customer_id: data as string };
  }

  const payload = {
    id: s.id,
    receipt_number: s.receipt_number,
    device_id: s.device_id,
    cashier_name: s.cashier_name,
    sold_at: s.sold_at,
    member_id: s.customer.kind === 'member' ? s.customer.member.id : null,
    pending_customer_id: s.customer.kind === 'pending' ? s.pending_customer_id : null,
    tender: s.tender,
    cash_tendered_cents: s.cash_tendered_cents,
    check_number: s.check_number,
    tax_cents: s.tax_cents,
    membership_fee_cents: s.membership_fee_cents ?? 0,
    jar_returns: s.jar_returns ?? 0,
    jar_credit_cents: s.jar_credit_cents ?? 0,
    total_cents: s.total_cents,
    lines: s.lines.map((l) => ({
      product_id: l.product_id,
      quantity: milliToNumber(l.qtyMilli),
      unit_price_cents: l.unit_price_cents,
      line_total_cents: l.line_total_cents,
    })),
  };
  const { error } = await db().rpc('record_sale', { p_sale: payload });
  if (error) {
    const e = classify(error);
    // Carry the pending id forward so a retry doesn't create a second signup.
    (e as Error & { sale?: LocalSale }).sale = s;
    throw e;
  }
  return s;
}

export async function voidSaleOnServer(saleId: string, reason: string): Promise<void> {
  const { error } = await db().rpc('void_sale', { p_sale_id: saleId, p_reason: reason });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// All orders (every device, every day), read back from the database.
// ---------------------------------------------------------------------------

export type PostingStatus = 'unposted' | 'posted' | 'failed' | 'needs_reversal' | 'reversed' | 'not_needed';

/** A sale as stored on the server, shaped like LocalSale so the same receipt/detail code can show it. */
export interface ServerOrder extends LocalSale {
  posting_status: PostingStatus;
  farmmatch_order_ref: string | null;
  void_reason: string | null;
}

export const ORDERS_LIMIT = 1000;

const ORDER_SELECT = `
  id, receipt_number, device_id, cashier_name, sold_at, tender, check_number,
  subtotal_cents, tax_cents, membership_fee_cents, jar_returns, jar_credit_cents, total_cents,
  cash_tendered_cents, change_cents, status, void_reason, posting_status, farmmatch_order_ref,
  member:members(id, farmmatch_id, first_name, last_name, email, phone),
  pending:pending_customers(first_name, last_name, phone, email),
  sale_lines(line_no, product_id, product_name, sale_type, unit, quantity, unit_price_cents, line_total_cents, taxable)`;

function toOrder(r: any): ServerOrder {
  const m = r.member;
  const customer: LocalSale['customer'] = m
    ? {
        kind: 'member',
        member: {
          id: m.id, farmmatch_id: m.farmmatch_id, first_name: m.first_name, last_name: m.last_name,
          full_name: `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim(), email: m.email, phone: m.phone,
          phone_digits: null, membership_type: null, renewal_date: null, has_card_on_file: false,
          membership_status: 'none',
        },
      }
    : {
        kind: 'pending',
        pending: {
          first_name: r.pending?.first_name ?? '?', last_name: r.pending?.last_name ?? '',
          phone: r.pending?.phone ?? '', email: r.pending?.email ?? '',
        },
      };
  const lines = [...(r.sale_lines ?? [])]
    .sort((a, b) => a.line_no - b.line_no)
    .map((l) => ({
      product_id: l.product_id,
      name: l.product_name,
      sale_type: l.sale_type,
      unit: l.unit,
      qtyMilli: Math.round(Number(l.quantity) * 1000),
      unit_price_cents: l.unit_price_cents,
      line_total_cents: l.line_total_cents,
      taxable: l.taxable,
    }));
  return {
    id: r.id, receipt_number: r.receipt_number, device_id: r.device_id, cashier_name: r.cashier_name ?? '',
    sold_at: r.sold_at, customer, lines,
    subtotal_cents: r.subtotal_cents, tax_cents: r.tax_cents, membership_fee_cents: r.membership_fee_cents ?? 0,
    jar_returns: r.jar_returns ?? 0, jar_credit_cents: r.jar_credit_cents ?? 0, total_cents: r.total_cents,
    tender: r.tender, cash_tendered_cents: r.cash_tendered_cents, change_cents: r.change_cents,
    check_number: r.check_number, upload: 'uploaded', voided: r.status === 'voided',
    posting_status: r.posting_status, farmmatch_order_ref: r.farmmatch_order_ref, void_reason: r.void_reason,
  };
}

/**
 * Orders newest first. `since` limits to orders on or after that time; `search`
 * matches a receipt number or a customer's first/last name. At most ORDERS_LIMIT rows.
 */
export async function fetchOrders(opts: { since?: Date; search?: string } = {}): Promise<ServerOrder[]> {
  let q = db().from('sales').select(ORDER_SELECT).order('sold_at', { ascending: false }).limit(ORDERS_LIMIT);
  if (opts.since) q = q.gte('sold_at', opts.since.toISOString());

  const term = opts.search?.trim().replace(/[,()*%]/g, ' ').trim();
  if (term) {
    const words = term.split(/\s+/);
    // Customer names live on members; find matching ids first, then match receipts or those ids.
    let mq = db().from('members').select('id').limit(500);
    for (const w of words) mq = mq.or(`first_name.ilike.*${w}*,last_name.ilike.*${w}*`);
    const { data: mems, error: mErr } = await mq;
    if (mErr) throw new Error(mErr.message);
    const ids = (mems ?? []).map((x: any) => x.id);
    const clauses = [`receipt_number.ilike.*${term.replace(/\s+/g, '')}*`];
    if (ids.length) clauses.push(`member_id.in.(${ids.join(',')})`);
    q = q.or(clauses.join(','));
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(toOrder);
}

/** A customer's register purchase history, summarised per product (see member_top_products). */
export async function fetchUsualRows(memberId: string): Promise<UsualRow[]> {
  const { data, error } = await db()
    .from('member_top_products')
    .select('product_id, times_bought, last_bought_at')
    .eq('member_id', memberId)
    .order('times_bought', { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  return (data ?? []) as UsualRow[];
}
