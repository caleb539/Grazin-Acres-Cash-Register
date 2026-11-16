import type { LocalSale, Product } from './types';

/** A product a customer buys often, for the "usuals" row. */
export interface Usual {
  product: Product;
  /** Number of separate orders that included it. */
  times: number;
  lastAt: string;
}

export interface UsualRow {
  product_id: string;
  times_bought: number;
  last_bought_at: string;
}

export const USUALS_LIMIT = 8;

/** Sales on this iPad for one customer, counted the same way as the server view. */
export function usualRowsFromSales(sales: LocalSale[], memberId: string): UsualRow[] {
  const byProduct = new Map<string, UsualRow>();
  for (const s of sales) {
    if (s.voided || s.customer.kind !== 'member' || s.customer.member.id !== memberId) continue;
    for (const pid of new Set(s.lines.map((l) => l.product_id))) {
      const row = byProduct.get(pid) ?? { product_id: pid, times_bought: 0, last_bought_at: s.sold_at };
      row.times_bought += 1;
      if (s.sold_at > row.last_bought_at) row.last_bought_at = s.sold_at;
      byProduct.set(pid, row);
    }
  }
  return [...byProduct.values()];
}

/**
 * Server history plus this iPad's sales that haven't reached the server yet,
 * ranked most-bought first (most recent breaks ties), limited to products the
 * register still sells.
 */
export function rankUsuals(
  serverRows: UsualRow[],
  sales: LocalSale[],
  memberId: string,
  products: Product[],
  limit = USUALS_LIMIT,
): Usual[] {
  const notUploaded = sales.filter((s) => s.upload !== 'uploaded');
  const merged = new Map<string, UsualRow>();
  for (const r of [...serverRows, ...usualRowsFromSales(notUploaded, memberId)]) {
    const prev = merged.get(r.product_id);
    merged.set(r.product_id, prev
      ? { product_id: r.product_id, times_bought: prev.times_bought + r.times_bought,
          last_bought_at: prev.last_bought_at > r.last_bought_at ? prev.last_bought_at : r.last_bought_at }
      : { ...r });
  }
  const byId = new Map(products.map((p) => [p.id, p]));
  return [...merged.values()]
    .filter((r) => byId.has(r.product_id))
    .sort((a, b) => b.times_bought - a.times_bought || b.last_bought_at.localeCompare(a.last_bought_at))
    .slice(0, limit)
    .map((r) => ({ product: byId.get(r.product_id)!, times: r.times_bought, lastAt: r.last_bought_at }));
}
