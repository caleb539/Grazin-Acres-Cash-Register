import { describe, expect, it } from 'vitest';
import { packageSizeMilli } from './packageSize';

describe('packageSizeMilli', () => {
  it.each([
    ['Large Bag Organic Popcorn (4 lbs)', 4000],
    ['Specials! Lamb Stew Meat (1lb)', 1000],
    ['Peanut Butter (.5 lb) (Freshly Ground)', 500],
    ['Beef Chuck Roast (2.5 lbs)', 2500],
    ['Lamb Heart (.25lbs)', 250],
    ['Half Lamb (20 Lbs.) Grassfed', 20000],
    ['Alaskan Salmon Whole Fillet (20 lbs', 20000],
    ['Bison Liver (8 oz)', 500],
    ['Baking Powder (4 oz.)', 250],
    ['Beef Kidney Suet (5 lbs) {For Soapmaking}', 5000],
  ])('%s -> %i', (name, expected) => {
    expect(packageSizeMilli(name, 'lb')).toBe(expected);
  });

  it('returns null when there is no size or no unit', () => {
    expect(packageSizeMilli('Ground Beef', 'lb')).toBeNull();
    expect(packageSizeMilli('Lamb Kidney (.25)', 'lb')).toBeNull();
    expect(packageSizeMilli('Organic Fine Coconut', 'lb')).toBeNull();
  });

  it('converts between lb and oz', () => {
    expect(packageSizeMilli('Butter (1 lb)', 'oz')).toBe(16000);
    expect(packageSizeMilli('Liver (5 oz)', 'lb')).toBe(313);
  });

  it('does not convert to unrelated units', () => {
    expect(packageSizeMilli('Milk (1 lb)', 'gal')).toBeNull();
  });
});
