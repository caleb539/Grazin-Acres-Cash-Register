import { useMemo, useState } from 'react';
import { formatCents } from '../lib/money';
import { bulkTiers, tierLabel } from '../lib/pricing';
import { DEPARTMENTS, departmentOf, searchProducts } from '../lib/productSearch';
import type { Product } from '../lib/types';
import type { Usual } from '../lib/usuals';

interface Props {
  products: Product[];
  onPick: (p: Product) => void;
  /** The picked customer's most-bought items, shown first. */
  usuals?: Usual[];
  customerFirstName?: string | null;
}

const ALL = '__all__';

function byShelfOrder(a: Product, b: Product): number {
  return (a.category ?? '').localeCompare(b.category ?? '') || a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

export function ProductGrid({ products, onPick, usuals = [], customerFirstName }: Props) {
  const [dept, setDept] = useState<string>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';

  // department id -> its categories (with counts), only departments that have products
  const tree = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const p of products) {
      const cat = p.category ?? 'Other';
      const d = departmentOf(cat);
      if (!map.has(d)) map.set(d, new Map());
      const cats = map.get(d)!;
      cats.set(cat, (cats.get(cat) ?? 0) + 1);
    }
    return map;
  }, [products]);

  const departments = DEPARTMENTS.filter((d) => tree.has(d.id));
  const subcats = dept === ALL ? [] : [...(tree.get(dept)?.entries() ?? [])].sort((a, b) => a[0].localeCompare(b[0]));

  const shown = useMemo(() => {
    if (searching) return searchProducts(products, query);
    return products
      .filter((p) => dept === ALL || departmentOf(p.category) === dept)
      .filter((p) => category === ALL || (p.category ?? 'Other') === category)
      .sort(byShelfOrder);
  }, [products, query, searching, dept, category]);

  const pickDept = (id: string) => { setDept(id); setCategory(ALL); setQuery(''); };
  const showCategoryOnTile = searching || category === ALL;

  return (
    <section className="products">
      <div className="search-wrap">
        <input
          className="search-input"
          type="text"
          inputMode="search"
          placeholder="🔍  Search products (e.g. half gallon milk)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {searching && (
          <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">✕</button>
        )}
      </div>

      {searching ? (
        <div className="search-status">
          <span>
            <strong>{shown.length}</strong> {shown.length === 1 ? 'result' : 'results'} for “{query.trim()}”
          </span>
          <button type="button" className="btn btn-small" onClick={() => setQuery('')}>✕ Clear search</button>
        </div>
      ) : (
        <>
          <div className="dept-row" role="tablist" aria-label="Departments">
            <button
              type="button"
              role="tab"
              aria-selected={dept === ALL}
              className={`dept-btn${dept === ALL ? ' active' : ''}`}
              onClick={() => pickDept(ALL)}
            >
              All
            </button>
            {departments.map((d) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={dept === d.id}
                className={`dept-btn${dept === d.id ? ' active' : ''}`}
                onClick={() => pickDept(d.id)}
              >
                <span aria-hidden="true">{d.icon}</span> {d.label}
              </button>
            ))}
          </div>
          {subcats.length > 1 && (
            <div className="chips" role="tablist" aria-label="Categories">
              <button
                type="button"
                role="tab"
                aria-selected={category === ALL}
                className={`chip-btn${category === ALL ? ' active' : ''}`}
                onClick={() => setCategory(ALL)}
              >
                All {DEPARTMENTS.find((d) => d.id === dept)?.label}
              </button>
              {subcats.map(([c, count]) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={category === c}
                  className={`chip-btn${category === c ? ' active' : ''}`}
                  onClick={() => setCategory(c)}
                >
                  {c} <span className="chip-count">{count}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {!searching && usuals.length > 0 && (
        <div className="usuals">
          <div className="usuals-head">⭐ {customerFirstName ? `${customerFirstName}'s` : 'Their'} usuals</div>
          <div className="usuals-row">
            {usuals.map((u) => (
              <Tile key={u.product.id} p={u.product} showCategory={false} onPick={onPick} badge={`bought ${u.times}×`} />
            ))}
          </div>
        </div>
      )}

      <div className="grid">
        {shown.map((p) => <Tile key={p.id} p={p} showCategory={showCategoryOnTile} onPick={onPick} />)}
        {shown.length === 0 && (
          <div className="muted center pad grid-empty">
            {searching ? (
              <>
                <p>Nothing matches “{query.trim()}”.</p>
                <p className="small">Try fewer words, or part of a word, like “sausage” or “yog”.</p>
              </>
            ) : 'No products here.'}
          </div>
        )}
      </div>
    </section>
  );
}

function Tile({ p, showCategory, onPick, badge }: { p: Product; showCategory: boolean; onPick: (p: Product) => void; badge?: string }) {
  return (
    <button type="button" className={`tile${p.sale_type === 'weight' ? ' tile-weight' : ''}`} onClick={() => onPick(p)}>
      {badge && <span className="tile-badge">{badge}</span>}
      {showCategory && <span className="tile-cat">{p.category}</span>}
      <span className="tile-name">{p.name}</span>
      <span className="tile-price">
        {formatCents(p.price_cents)}
        {p.sale_type === 'weight' && <span className="tile-unit">/{p.unit}</span>}
      </span>
      {bulkTiers(p).length > 0 && (
        <span className="tile-tiers">
          {bulkTiers(p).map((t) => `${tierLabel(p, t)} ${formatCents(t.price_cents)}`).join(' · ')}
        </span>
      )}
      {p.sale_type === 'weight' && <span className="tile-tag">⚖ weigh</span>}
    </button>
  );
}
