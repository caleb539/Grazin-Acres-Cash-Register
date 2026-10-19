import { describe, expect, it } from 'vitest';
import { jarCreditCents, lineTotalCents, parseQtyMilli, quickCashOptions, taxCents, formatQty } from './money';

describe('lineTotalCents', () => {
  it('matches the database for the tested weighed sale', () => {
    expect(lineTotalCents(1370, 999)).toBe(1369); // 1.37 lb x $9.99 = 13.6863
  });
  it('rounds half up', () => {
    expect(lineTotalCents(1005, 100)).toBe(101); // 1.005 x $1.00 = 1.005
    expect(lineTotalCents(1500, 1)).toBe(2); // 1.5 cents
  });
  it('handles counts', () => {
    expect(lineTotalCents(2000, 850)).toBe(1700);
  });
});

describe('taxCents', () => {
  it('is zero at zero rate', () => expect(taxCents(12345, 0)).toBe(0));
  it('rounds half up at 5.5%', () => {
    expect(taxCents(1000, 0.055)).toBe(55);
    expect(taxCents(10, 0.05)).toBe(1); // 0.5 cents
  });
});

describe('parseQtyMilli', () => {
  it('parses decimals', () => {
    expect(parseQtyMilli('1.37')).toBe(1370);
    expect(parseQtyMilli('.5')).toBe(500);
    expect(parseQtyMilli('2')).toBe(2000);
    expect(parseQtyMilli('2.')).toBe(2000);
    expect(parseQtyMilli('0.125')).toBe(125);
  });
  it('rejects junk', () => {
    expect(parseQtyMilli('')).toBeNull();
    expect(parseQtyMilli('.')).toBeNull();
    expect(parseQtyMilli('1.2345')).toBeNull();
    expect(parseQtyMilli('abc')).toBeNull();
  });
});

describe('formatQty', () => {
  it('trims zeros', () => {
    expect(formatQty(1370)).toBe('1.37');
    expect(formatQty(2000)).toBe('2');
  });
});

describe('quickCashOptions', () => {
  it('offers exact, next dollar, and bills', () => {
    expect(quickCashOptions(3069)).toEqual([3069, 3100, 3500, 4000, 5000, 10000]);
  });
  it('does not duplicate when total is round', () => {
    expect(quickCashOptions(2000)).toEqual([2000, 5000, 10000]);
  });
});

describe('jarCreditCents', () => {
  it('credits $1 per jar', () => expect(jarCreditCents(3, 100, 1400)).toBe(300));
  it('caps at the order total', () => expect(jarCreditCents(20, 100, 1400)).toBe(1400));
  it('is zero with no jars or no order', () => {
    expect(jarCreditCents(0, 100, 1400)).toBe(0);
    expect(jarCreditCents(5, 100, 0)).toBe(0);
  });
});
