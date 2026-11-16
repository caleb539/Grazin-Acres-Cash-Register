import { describe, expect, it } from 'vitest';
import { rankUsuals, usualRowsFromSales } from './usuals';
import type { LocalSale, Member, Product } from './types';

const prod = (id: string): Product => ({
  id, farmmatch_id: id, name: `P${id}`, category: 'X', sale_type: 'each', unit: 'ea', price_cents: 100, taxable: false, sort_order: 0,
});
const products = ['a', 'b', 'c', 'd'].map(prod);
const member = { id: 'm1' } as Member;
const other = { id: 'm2' } as Member;

const sale = (m: Member, at: string, pids: string[], extra: Partial<LocalSale> = {}) => ({
  customer: { kind: 'member', member: m },
  sold_at: at,
  lines: pids.map((product_id) => ({ product_id })),
  upload: 'uploaded',
  ...extra,
}) as unknown as LocalSale;

describe('usualRowsFromSales', () => {
  it('counts orders, not units, and ignores other customers and voids', () => {
    const rows = usualRowsFromSales([
      sale(member, '2026-11-01', ['a', 'a', 'b']),
      sale(member, '2026-11-05', ['a']),
      sale(member, '2026-11-06', ['c'], { voided: true }),
      sale(other, '2026-11-07', ['d']),
    ], 'm1');
    expect(rows.find((r) => r.product_id === 'a')).toEqual({ product_id: 'a', times_bought: 2, last_bought_at: '2026-11-05' });
    expect(rows.map((r) => r.product_id).sort()).toEqual(['a', 'b']);
  });
});

describe('rankUsuals', () => {
  it('ranks most-bought first, newest breaking ties, and skips products no longer sold', () => {
    const server = [
      { product_id: 'a', times_bought: 1, last_bought_at: '2026-10-01' },
      { product_id: 'b', times_bought: 3, last_bought_at: '2026-10-02' },
      { product_id: 'c', times_bought: 1, last_bought_at: '2026-10-09' },
      { product_id: 'gone', times_bought: 9, last_bought_at: '2026-10-09' },
    ];
    expect(rankUsuals(server, [], 'm1', products).map((u) => [u.product.id, u.times])).toEqual([['b', 3], ['c', 1], ['a', 1]]);
  });
  it('adds this iPad\'s sales that have not uploaded yet, without double counting uploaded ones', () => {
    const server = [{ product_id: 'a', times_bought: 1, last_bought_at: '2026-10-01' }];
    const local = [
      sale(member, '2026-10-01', ['a']), // already on the server
      sale(member, '2026-11-10', ['a', 'd'], { upload: 'queued' }),
    ];
    expect(rankUsuals(server, local, 'm1', products).map((u) => [u.product.id, u.times])).toEqual([['a', 2], ['d', 1]]);
  });
  it('limits the list', () => {
    const server = products.map((p, i) => ({ product_id: p.id, times_bought: i + 1, last_bought_at: '2026-10-01' }));
    expect(rankUsuals(server, [], 'm1', products, 2).map((u) => u.product.id)).toEqual(['d', 'c']);
  });
});
