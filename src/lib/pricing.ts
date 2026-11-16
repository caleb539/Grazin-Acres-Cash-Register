import { formatQty } from './money';
import type { PriceTier, Product } from './types';

/** The tier that applies at this quantity: the one with the highest minimum the quantity reaches. */
export function tierFor(product: Product, qtyMilli: number): PriceTier | null {
  let best: PriceTier | null = null;
  for (const t of product.tiers ?? []) {
    if (qtyMilli >= t.min_milli && (!best || t.min_milli > best.min_milli)) best = t;
  }
  return best;
}

/**
 * Price per unit at this quantity. Like FarmMatch's volume pricing, the tier
 * price applies to every unit on the line (10 dozen eggs at the 10+ price).
 */
export function unitPriceFor(product: Product, qtyMilli: number): number {
  return tierFor(product, qtyMilli)?.price_cents ?? product.price_cents;
}

/** Price breaks below the base price, cheapest-to-reach first, e.g. for "6+ $6.00" hints. */
export function bulkTiers(product: Product): PriceTier[] {
  return (product.tiers ?? [])
    .filter((t) => t.price_cents < product.price_cents && t.min_milli > 1000)
    .sort((a, b) => a.min_milli - b.min_milli);
}

/** "10+" or "6+ lb" */
export function tierLabel(product: Product, t: PriceTier): string {
  return `${formatQty(t.min_milli)}+${product.sale_type === 'weight' ? ` ${product.unit}` : ''}`;
}
