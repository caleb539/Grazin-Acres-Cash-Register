import { describe, expect, it } from 'vitest';
import { departmentOf, searchProducts } from './productSearch';
import type { Product } from './types';

let n = 0;
const p = (name: string, category: string): Product => ({
  id: String(++n), farmmatch_id: String(n), name, category, sale_type: 'each', unit: 'ea',
  price_cents: 100, taxable: false, sort_order: 0,
});

const catalog = [
  p('Raw A2A2 Milk (half gallon)', 'Raw Milk'),
  p('Raw Jersey Milk (gallon)', 'Raw Milk'),
  p('Goat Milk (quart)', 'Goat Milk'),
  p('Eggs (1 doz)', 'Eggs'),
  p('Duck Eggs (half dozen)', 'Eggs'),
  p('Crème Fraîche (pint)', 'Crème Fraiche'),
  p('Strawberries & Cream Ice Cream (pint)', 'Ice Cream'),
  p('Ground Beef (1 lb)', 'Beef Cuts'),
  p('Lavender Bar Soap', 'Bar Soap'),
];
const names = (q: string) => searchProducts(catalog, q).map((x) => x.name);

describe('searchProducts', () => {
  it('matches words in any order', () => {
    expect(names('half gallon milk')).toEqual(['Raw A2A2 Milk (half gallon)']);
    expect(names('milk jersey')).toEqual(['Raw Jersey Milk (gallon)']);
  });
  it('tolerates singular/plural', () => {
    expect(names('egg')).toEqual(['Eggs (1 doz)', 'Duck Eggs (half dozen)']);
    expect(names('strawberry')).toEqual(['Strawberries & Cream Ice Cream (pint)']);
  });
  it('ignores accents and punctuation', () => {
    expect(names('creme fraiche')).toEqual(['Crème Fraîche (pint)']);
    expect(names('a2a2')).toEqual(['Raw A2A2 Milk (half gallon)']);
  });
  it('matches word beginnings while typing', () => {
    expect(names('gro')).toEqual(['Ground Beef (1 lb)']);
  });
  it('also searches category names', () => {
    expect(names('soap')).toEqual(['Lavender Bar Soap']);
  });
  it('puts the best matches first', () => {
    expect(names('milk')[0]).toBe('Goat Milk (quart)'); // shortest name with an exact word
    expect(names('milk')).toHaveLength(3);
  });
  it('finds nothing for nonsense', () => {
    expect(names('zzz')).toEqual([]);
    expect(names('   ')).toEqual([]);
  });
});

describe('departmentOf', () => {
  it.each([
    ['Weekly Specials', 'specials'], ['Raw Milk', 'dairy'], ['Ice Cream', 'dairy'], ['Crème Fraiche', 'dairy'],
    ['Butter Oil', 'dairy'], ['Egg Supplier Products', 'eggs'], ['Beef Suet & Hooves', 'meat'], ['Salmon and Cod', 'meat'],
    ['Chicken Stock', 'meat'], ['Turkey and Geese', 'meat'], ['Pork Lard', 'meat'], ['Baked Goods', 'bakery'],
    ['Baking Supplies', 'pantry'], ['Fermented Vegetables', 'pantry'], ['Rice & Sunflower Seeds', 'pantry'],
    ['Raw Kombucha', 'drinks'], ['Coffee', 'drinks'], ['Bar Soap', 'household'], ['Jar Returns', 'household'],
    ['Straw Bales & Mulch', 'household'], ['Dairy', 'dairy'], ['Pantry', 'pantry'], ['Meat', 'meat'], ['Something New', 'other'],
  ])('%s -> %s', (cat, dept) => expect(departmentOf(cat)).toBe(dept));
});
