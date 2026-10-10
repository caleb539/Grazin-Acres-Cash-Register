import { useMemo, useState } from 'react';
import { formatCents } from '../lib/money';
import type { Product } from '../lib/types';

interface Props {
  products: Product[];
  onPick: (p: Product) => void;
}

const ALL = '__all__';

export function ProductGrid({ products, onPick }: Props) {
  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const p of products) seen.add(p.category ?? 'Other');
    return [...seen];
  }, [products]);
  const [category, setCategory] = useState<string>(ALL);
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : category === ALL || (p.category ?? 'Other') === category))
      .sort((a, b) =>
        (a.category ?? '').localeCompare(b.category ?? '') || a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [products, category, query]);

  return (
    <section className="products">
      <div className="products-bar">
        <input
          className="search-input"
          type="search"
          placeholder="Search products"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="chips" role="tablist">
        {[ALL, ...categories].map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={!query && category === c}
            className={`chip-btn${!query && category === c ? ' active' : ''}`}
            onClick={() => { setCategory(c); setQuery(''); }}
          >
            {c === ALL ? 'All' : c}
          </button>
        ))}
      </div>
      <div className="grid">
        {shown.map((p) => (
          <button key={p.id} type="button" className={`tile${p.sale_type === 'weight' ? ' tile-weight' : ''}`} onClick={() => onPick(p)}>
            <span className="tile-name">{p.name}</span>
            <span className="tile-price">
              {formatCents(p.price_cents)}
              {p.sale_type === 'weight' && <span className="tile-unit">/{p.unit}</span>}
            </span>
            {p.sale_type === 'weight' && <span className="tile-tag">⚖ weigh</span>}
          </button>
        ))}
        {shown.length === 0 && <p className="muted center pad grid-empty">No products{query ? ` match “${query}”` : ''}.</p>}
      </div>
    </section>
  );
}
