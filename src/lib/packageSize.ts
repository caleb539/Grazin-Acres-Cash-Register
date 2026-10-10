import { parseQtyMilli } from './money';

// FarmMatch product names carry the usual package size, e.g. "Popcorn (4 lbs)",
// "Beef Liver (1.5 lbs)", "Bison Liver (8 oz)". The register uses it to pre-fill
// the weight pad; the cashier still changes it to the label weight if different.

const SIZE_RE = /(\d+(?:\.\d+)?|\.\d+)\s*(lbs?|oz)\b/i;

/** Package size from the product name, in thousandths of the product's unit; null if none. */
export function packageSizeMilli(name: string, unit: string): number | null {
  const m = SIZE_RE.exec(name);
  if (!m) return null;
  const qty = parseQtyMilli(m[1]);
  if (qty === null || qty <= 0) return null;
  const from = m[2].toLowerCase().startsWith('lb') ? 'lb' : 'oz';
  const to = unit.toLowerCase().replace(/s$/, '');
  if (from === to) return qty;
  if (from === 'oz' && to === 'lb') return Math.round(qty / 16);
  if (from === 'lb' && to === 'oz') return qty * 16;
  return null;
}
