import { describe, expect, it } from 'vitest';
import { bulkTiers, tierLabel, unitPriceFor } from './pricing';
import type { Product } from './types';

const eggs: Product = {
  id: 'e', farmmatch_id: '36463', name: 'Eggs (1 doz)', category: 'Eggs', sale_type: 'each', unit: 'ea',
  price_cents: 650, taxable: false, sort_order: 0,
  tiers: [{ min_milli: 1000, price_cents: 650 }, { min_milli: 6000, price_cents: 600 }, { min_milli: 10000, price_cents: 550 }],
};
const lamb: Product = {
  id: 'l', farmmatch_id: '37054', name: 'Ground Lamb', category: 'Lamb', sale_type: 'weight', unit: 'lb',
  price_cents: 1530, taxable: false, sort_order: 0,
  tiers: [{ min_milli: 1000, price_cents: 1530 }, { min_milli: 6000, price_cents: 1500 }],
};

describe('unitPriceFor', () => {
  it('uses the base price below the first break', () => {
    expect(unitPriceFor(eggs, 1000)).toBe(650);
    expect(unitPriceFor(eggs, 5000)).toBe(650);
  });
  it('uses the highest tier reached', () => {
    expect(unitPriceFor(eggs, 6000)).toBe(600);
    expect(unitPriceFor(eggs, 9000)).toBe(600);
    expect(unitPriceFor(eggs, 10000)).toBe(550);
    expect(unitPriceFor(eggs, 40000)).toBe(550);
  });
  it('tiers weighed items by weight, including between FarmMatch ranges', () => {
    expect(unitPriceFor(lamb, 5500)).toBe(1530); // 5.5 lb: not yet 6
    expect(unitPriceFor(lamb, 6000)).toBe(1500);
    expect(unitPriceFor(lamb, 6250)).toBe(1500);
  });
  it('falls back to the base price with no tiers', () => {
    expect(unitPriceFor({ ...eggs, tiers: undefined }, 20000)).toBe(650);
    expect(unitPriceFor({ ...eggs, tiers: [] }, 20000)).toBe(650);
  });
});

describe('bulkTiers / tierLabel', () => {
  it('lists only real discounts', () => {
    expect(bulkTiers(eggs).map((t) => [tierLabel(eggs, t), t.price_cents])).toEqual([['6+', 600], ['10+', 550]]);
    expect(tierLabel(lamb, bulkTiers(lamb)[0])).toBe('6+ lb');
  });
});
