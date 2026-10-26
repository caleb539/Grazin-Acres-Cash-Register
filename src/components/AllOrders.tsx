import { useEffect, useMemo, useState } from 'react';
import { fetchOrders, ORDERS_LIMIT, type PostingStatus, type ServerOrder } from '../lib/backend';
import { formatCents, formatQty } from '../lib/money';
import type { LocalSale } from '../lib/types';

type Period = 'today' | '7' | '30' | 'all';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: 'all', label: 'All time' },
];

const TENDER = { cash: 'Cash', check: 'Check', card_on_file: 'Card on file' } as const;

function since(period: Period): Date | undefined {
  if (period === 'all') return undefined;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period !== 'today') d.setDate(d.getDate() - (Number(period) - 1));
  return d;
}

function customerName(s: LocalSale): string {
  return s.customer.kind === 'member'
    ? s.customer.member.full_name
    : `${s.customer.pending.first_name} ${s.customer.pending.last_name} (new signup)`;
}

/** Demo mode has no server; show this iPad's stored sales with the same filters. */
function filterLocal(sales: LocalSale[], period: Period, search: string): ServerOrder[] {
  const from = since(period)?.getTime() ?? 0;
  const q = search.trim().toLowerCase();
  return sales
    .filter((s) => Date.parse(s.sold_at) >= from)
    .filter((s) => !q || s.receipt_number.toLowerCase().includes(q.replace(/\s+/g, '')) || customerName(s).toLowerCase().includes(q))
    .sort((a, b) => b.sold_at.localeCompare(a.sold_at))
    .map((s) => ({ ...s, posting_status: s.voided ? 'not_needed' : 'unposted', farmmatch_order_ref: null, void_reason: null }));
}

interface Props {
  demo: boolean;
  localSales: LocalSale[];
  onPrint: (sale: LocalSale) => void;
}

export function AllOrders({ demo, localSales, onPrint }: Props) {
  const [period, setPeriod] = useState<Period>('7');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState<ServerOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Wait for typing to pause before searching.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (demo) {
      setOrders(filterLocal(localSales, period, query));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOrders({ since: since(period), search: query })
      .then((o) => { if (!cancelled) setOrders(o); })
      .catch((e) => {
        if (cancelled) return;
        setError(navigator.onLine ? `Couldn't load orders: ${e instanceof Error ? e.message : e}` : 'Connect to the internet to see all orders.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [demo, localSales, period, query, reload]);

  const live = useMemo(() => orders.filter((o) => !o.voided), [orders]);
  const totals = (['cash', 'check', 'card_on_file'] as const).map((t) => ({
    t, cents: live.filter((o) => o.tender === t).reduce((n, o) => n + o.total_cents, 0),
  }));
  const notPosted = live.filter((o) => o.posting_status === 'unposted' || o.posting_status === 'failed').length;

  return (
    <div className="all-orders">
      <div className="orders-filters">
        <div className="chips" role="tablist">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={period === p.id}
              className={`chip-btn${period === p.id ? ' active' : ''}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          className="search-input"
          type="search"
          placeholder="Search customer or receipt #"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="totals-strip">
        {totals.map(({ t, cents }) => (
          <div key={t}><span className="muted small">{TENDER[t]}</span><strong>{formatCents(cents)}</strong></div>
        ))}
        <div><span className="muted small">Orders</span><strong>{live.length}</strong></div>
      </div>
      {!demo && notPosted > 0 && (
        <div className="alert alert-warn small">
          {notPosted} {notPosted === 1 ? 'order hasn\'t' : 'orders haven\'t'} been posted to FarmMatch yet.
        </div>
      )}

      {error && (
        <div className="alert alert-bad alert-row">
          <span>{error}</span>
          <button type="button" className="btn btn-small" onClick={() => setReload((n) => n + 1)}>Try again</button>
        </div>
      )}
      {loading && <p className="muted center pad">Loading orders…</p>}
      {!loading && !error && orders.length === 0 && (
        <p className="muted center pad">No orders{query ? ` match “${query}”` : ''} in this period.</p>
      )}
      {!loading && orders.length >= ORDERS_LIMIT && (
        <p className="muted small center">Showing the newest {ORDERS_LIMIT}. Pick a shorter period or search to narrow it down.</p>
      )}

      <div className="history-list">
        {!loading && orders.map((o) => (
          <div key={o.id} className={`history-item${o.voided ? ' voided' : ''}`}>
            <button type="button" className="history-row" onClick={() => setOpen(open === o.id ? null : o.id)}>
              <span className="muted small mono order-when">
                {new Date(o.sold_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                {' '}
                {new Date(o.sold_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
              <span className="grow">{customerName(o)}</span>
              <span className="muted small">{TENDER[o.tender]}</span>
              <strong>{formatCents(o.total_cents)}</strong>
              {demo ? <span className="chip chip-muted">{o.voided ? 'Voided' : 'Demo'}</span> : <PostingChip order={o} />}
            </button>
            {open === o.id && (
              <div className="history-detail">
                <div className="muted small">
                  Receipt {o.receipt_number} · register {o.device_id} · {o.cashier_name || 'no cashier'}
                </div>
                {o.lines.map((l, i) => (
                  <div key={i} className="row between small">
                    <span>{l.sale_type === 'weight' ? `${formatQty(l.qtyMilli)} ${l.unit}` : `${formatQty(l.qtyMilli)} ×`} {l.name}</span>
                    <span>{formatCents(l.line_total_cents)}</span>
                  </div>
                ))}
                {o.membership_fee_cents > 0 && (
                  <div className="row between small"><span>Membership renewal</span><span>{formatCents(o.membership_fee_cents)}</span></div>
                )}
                {o.jar_credit_cents > 0 && (
                  <div className="row between small"><span>Jar returns ({o.jar_returns})</span><span>−{formatCents(o.jar_credit_cents)}</span></div>
                )}
                {o.tender === 'cash' && o.cash_tendered_cents !== null && (
                  <div className="muted small">Paid {formatCents(o.cash_tendered_cents)} cash · change {formatCents(o.change_cents ?? 0)}</div>
                )}
                {o.check_number && <div className="muted small">Check #{o.check_number}</div>}
                {o.voided && <div className="muted small">Voided{o.void_reason ? `: ${o.void_reason}` : ''}</div>}
                {o.farmmatch_order_ref && <div className="muted small">FarmMatch order {o.farmmatch_order_ref}</div>}
                <div className="row gap">
                  <button type="button" className="btn btn-ghost" onClick={() => onPrint(o)}>Print receipt</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const POSTING: Record<PostingStatus, [string, string]> = {
  unposted: ['Not posted yet', 'chip-warn'],
  posted: ['Posted', 'chip-ok'],
  failed: ['Posting failed', 'chip-bad'],
  needs_reversal: ['Needs reversal', 'chip-bad'],
  reversed: ['Reversed', 'chip-muted'],
  not_needed: ['Voided', 'chip-muted'],
};

function PostingChip({ order }: { order: ServerOrder }) {
  const [label, cls] = POSTING[order.posting_status] ?? ['?', 'chip-muted'];
  return <span className={`chip ${cls}`}>{label}</span>;
}
