// Supabase access: sign-in, catalog download, sale upload, void.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Catalog } from './local';
import { milliToNumber } from './money';
import type { LocalSale, Member, Product, Settings } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

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
  const [products, members, settingsRes] = await Promise.all([
    // register_products = active products minus register_hide_rules (preorders etc.)
    fetchAll<Product>('register_products',
      'id, farmmatch_id, name, category, sale_type, unit, price_cents, taxable, sort_order'),
    fetchAll<Member>('member_lookup', '*'),
    db().from('settings').select('store_name, tax_rate, expiring_soon_days, receipt_footer').single(),
  ]);
  if (settingsRes.error) throw new Error(settingsRes.error.message);
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
