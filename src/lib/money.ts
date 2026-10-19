// All money is integer cents; quantities are integer thousandths ("milli").
// Integer-only math so totals match the database's numeric rounding exactly
// (Postgres round() on numeric rounds half away from zero; all our values are >= 0).

export function lineTotalCents(qtyMilli: number, unitPriceCents: number): number {
  return Math.floor((qtyMilli * unitPriceCents + 500) / 1000);
}

/** tax_rate arrives as a decimal like 0.055; settings column is numeric(6,5). */
export function taxCents(taxableCents: number, taxRate: number): number {
  const rate = Math.round(taxRate * 100000);
  return Math.floor((taxableCents * rate + 50000) / 100000);
}

/** Parse "1.37" / ".5" / "2" into thousandths without floating point. Returns null if invalid. */
export function parseQtyMilli(text: string): number | null {
  const m = /^(\d*)(?:\.(\d{0,3}))?$/.exec(text.trim());
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return null;
  const whole = m[1] === '' ? 0 : parseInt(m[1], 10);
  const frac = parseInt((m[2] ?? '').padEnd(3, '0'), 10);
  return whole * 1000 + frac;
}

export function milliToNumber(qtyMilli: number): number {
  return qtyMilli / 1000;
}

export function formatQty(qtyMilli: number): string {
  if (qtyMilli % 1000 === 0) return String(qtyMilli / 1000);
  return (qtyMilli / 1000).toFixed(3).replace(/0+$/, '');
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/** Bills a customer is likely to hand over for this total, smallest first. */
export function quickCashOptions(totalCents: number): number[] {
  const opts = new Set<number>([totalCents]);
  const nextDollar = Math.ceil(totalCents / 100) * 100;
  if (nextDollar > totalCents) opts.add(nextDollar);
  for (const bill of [500, 1000, 2000, 5000, 10000]) {
    const amt = Math.ceil(totalCents / bill) * bill;
    if (amt >= totalCents) opts.add(amt);
  }
  return [...opts].sort((a, b) => a - b).slice(0, 6);
}

/** Jar return credit: jars x rate, never more than the order (so the total can't go below $0). */
export function jarCreditCents(jars: number, rateCents: number, orderCents: number): number {
  return Math.min(Math.max(0, jars) * rateCents, Math.max(0, orderCents));
}
