import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cart } from './components/Cart';
import { CustomerPicker } from './components/CustomerPicker';
import { Login } from './components/Login';
import { Modal } from './components/Modal';
import { type Payment, PaymentModal } from './components/PaymentModal';
import { ProductGrid } from './components/ProductGrid';
import { SaleComplete } from './components/SaleComplete';
import { SalesHistory } from './components/SalesHistory';
import { WeightPad } from './components/WeightPad';
import { hasSession, signOut } from './lib/backend';
import { getCashier, getDeviceId, nextReceiptNumber, setCashier } from './lib/local';
import { lineTotalCents, taxCents } from './lib/money';
import { packageSizeMilli } from './lib/packageSize';
import type { CartLine, Customer, LocalSale, Product } from './lib/types';
import { useRegister } from './lib/useRegister';

type Mode = 'loading' | 'login' | 'live' | 'demo';

export default function App() {
  const [mode, setMode] = useState<Mode>('loading');

  useEffect(() => {
    void hasSession().then((ok) => setMode(ok ? 'live' : 'login'));
  }, []);

  if (mode === 'loading') return <div className="splash">Loading…</div>;
  if (mode === 'login') return <Login onSignedIn={() => setMode('live')} onDemo={() => setMode('demo')} />;
  return (
    <Register
      key={mode}
      demo={mode === 'demo'}
      onExit={async () => {
        if (mode === 'live') await signOut();
        setMode('login');
      }}
    />
  );
}

type Overlay =
  | { kind: 'customer' }
  | { kind: 'weight'; product: Product; editKey?: string; initialMilli?: number }
  | { kind: 'pay' }
  | { kind: 'done'; sale: LocalSale }
  | { kind: 'history' }
  | { kind: 'cashier' }
  | { kind: 'menu' }
  | null;

function Register({ demo, onExit }: { demo: boolean; onExit: () => void }) {
  const data = useRegister(demo);
  const { catalog } = data;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [cashier, setCashierState] = useState(getCashier);
  const [overlay, setOverlay] = useState<Overlay>(() => (getCashier() ? null : { kind: 'cashier' }));

  const settings = catalog?.settings;
  const totals = useMemo(() => {
    let subtotal = 0;
    let taxable = 0;
    for (const l of lines) {
      const t = lineTotalCents(l.qtyMilli, l.unitPriceCents);
      subtotal += t;
      if (l.product.taxable) taxable += t;
    }
    const tax = taxCents(taxable, settings?.tax_rate ?? 0);
    return { subtotal, tax, total: subtotal + tax };
  }, [lines, settings]);

  const addProduct = useCallback((p: Product) => {
    if (p.sale_type === 'weight') {
      setOverlay({ kind: 'weight', product: p });
      return;
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === p.id);
      if (existing) return prev.map((l) => (l === existing ? { ...l, qtyMilli: l.qtyMilli + 1000 } : l));
      return [...prev, { key: crypto.randomUUID(), product: p, qtyMilli: 1000, unitPriceCents: p.price_cents }];
    });
  }, []);

  const onWeight = (qtyMilli: number) => {
    if (overlay?.kind !== 'weight') return;
    const { product, editKey } = overlay;
    setLines((prev) =>
      editKey
        ? prev.map((l) => (l.key === editKey ? { ...l, qtyMilli } : l))
        : [...prev, { key: crypto.randomUUID(), product, qtyMilli, unitPriceCents: product.price_cents }]);
    setOverlay(null);
  };

  const changeQty = (key: string, delta: number) =>
    setLines((prev) => prev
      .map((l) => (l.key === key ? { ...l, qtyMilli: l.qtyMilli + delta * 1000 } : l))
      .filter((l) => l.qtyMilli > 0));

  const clearSale = () => { setLines([]); setCustomer(null); };

  const completeSale = (payment: Payment) => {
    if (!customer) return;
    const sale: LocalSale = {
      id: crypto.randomUUID(),
      receipt_number: nextReceiptNumber(),
      device_id: getDeviceId(),
      cashier_name: cashier,
      sold_at: new Date().toISOString(),
      customer,
      lines: lines.map((l) => ({
        product_id: l.product.id,
        name: l.product.name,
        sale_type: l.product.sale_type,
        unit: l.product.unit,
        qtyMilli: l.qtyMilli,
        unit_price_cents: l.unitPriceCents,
        line_total_cents: lineTotalCents(l.qtyMilli, l.unitPriceCents),
        taxable: l.product.taxable,
      })),
      subtotal_cents: totals.subtotal,
      tax_cents: totals.tax,
      total_cents: totals.total,
      ...payment,
      upload: demo ? 'demo' : 'queued',
    };
    data.addSale(sale);
    clearSale();
    setOverlay({ kind: 'done', sale });
  };

  if (!catalog) {
    return (
      <div className="splash">
        {data.refreshError ? (
          <div className="center">
            <p>Couldn't download products and members.</p>
            <p className="error small">{data.refreshError}</p>
            <button type="button" className="btn btn-primary" onClick={() => void data.refreshCatalog()}>Try again</button>
          </div>
        ) : 'Loading products…'}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <span>{catalog.settings.store_name}</span>
          {demo && <span className="chip chip-warn">DEMO</span>}
        </div>
        <div className="topbar-right">
          <SyncStatus data={data} demo={demo} onOpenHistory={() => setOverlay({ kind: 'history' })} />
          <button type="button" className="btn btn-ghost" onClick={() => setOverlay({ kind: 'history' })}>Today's sales</button>
          <button type="button" className="btn btn-ghost" onClick={() => setOverlay({ kind: 'cashier' })}>
            👤 {cashier || 'Cashier'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setOverlay({ kind: 'menu' })} aria-label="Menu">☰</button>
        </div>
      </header>

      <main className="main">
        <ProductGrid products={catalog.products} onPick={addProduct} />
        <Cart
          customer={customer}
          lines={lines}
          subtotalCents={totals.subtotal}
          taxCents={totals.tax}
          totalCents={totals.total}
          onPickCustomer={() => setOverlay({ kind: 'customer' })}
          onClearCustomer={() => setCustomer(null)}
          onChangeQty={changeQty}
          onEditWeight={(l) => setOverlay({ kind: 'weight', product: l.product, editKey: l.key, initialMilli: l.qtyMilli })}
          onRemove={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
          onClear={clearSale}
          onPay={() => setOverlay({ kind: 'pay' })}
        />
      </main>

      {overlay?.kind === 'customer' && (
        <CustomerPicker
          members={catalog.members}
          onPick={(c) => { setCustomer(c); setOverlay(null); }}
          onCancel={() => setOverlay(null)}
        />
      )}
      {overlay?.kind === 'weight' && (
        <WeightPad
          product={overlay.product}
          initialMilli={overlay.initialMilli}
          suggestedMilli={overlay.editKey ? null : packageSizeMilli(overlay.product.name, overlay.product.unit)}
          onDone={onWeight}
          onCancel={() => setOverlay(null)}
        />
      )}
      {overlay?.kind === 'pay' && customer && (
        <PaymentModal totalCents={totals.total} customer={customer} onPay={completeSale} onCancel={() => setOverlay(null)} />
      )}
      {overlay?.kind === 'done' && <SaleComplete sale={overlay.sale} onNext={() => setOverlay(null)} />}
      {overlay?.kind === 'history' && (
        <SalesHistory sales={data.sales} onVoid={data.voidSale} onClose={() => setOverlay(null)} />
      )}
      {overlay?.kind === 'cashier' && (
        <CashierPrompt
          initial={cashier}
          onSave={(name) => { setCashier(name); setCashierState(name); setOverlay(null); }}
          onCancel={cashier ? () => setOverlay(null) : undefined}
        />
      )}
      {overlay?.kind === 'menu' && (
        <Modal title="Menu" onClose={() => setOverlay(null)}>
          <div className="menu-list">
            {!demo && (
              <button type="button" className="btn btn-lg btn-ghost full" disabled={data.refreshing}
                onClick={() => void data.refreshCatalog()}>
                {data.refreshing ? 'Updating…' : 'Update products & members now'}
              </button>
            )}
            {!demo && (
              <p className="muted small center">
                Last updated {new Date(catalog.refreshed_at).toLocaleString()} · {catalog.products.length} products · {catalog.members.length} accounts
              </p>
            )}
            {data.refreshError && <p className="error small center">{data.refreshError}</p>}
            {data.errorCount > 0 && (
              <button type="button" className="btn btn-lg btn-ghost full" onClick={data.retryErrors}>
                Retry {data.errorCount} sale{data.errorCount > 1 ? 's' : ''} with errors
              </button>
            )}
            <button type="button" className="btn btn-lg btn-ghost full" onClick={onExit}
              disabled={!demo && data.waitingCount + data.errorCount > 0}>
              {demo ? 'Exit demo' : 'Sign out'}
            </button>
            {!demo && data.waitingCount + data.errorCount > 0 && (
              <p className="muted small center">Can't sign out while sales are waiting to upload.</p>
            )}
            <p className="muted small center">Register {getDeviceId()}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SyncStatus({ data, demo, onOpenHistory }: { data: ReturnType<typeof useRegister>; demo: boolean; onOpenHistory: () => void }) {
  if (demo) return null;
  if (data.errorCount > 0) {
    return <button type="button" className="chip chip-bad" onClick={onOpenHistory}>{data.errorCount} upload error{data.errorCount > 1 ? 's' : ''}</button>;
  }
  if (!data.online) {
    return <span className="chip chip-warn">Offline{data.waitingCount ? ` · ${data.waitingCount} waiting` : ''}</span>;
  }
  if (data.waitingCount > 0) return <span className="chip chip-warn">Uploading {data.waitingCount}…</span>;
  return <span className="chip chip-ok">● Online</span>;
}

function CashierPrompt({ initial, onSave, onCancel }: { initial: string; onSave: (n: string) => void; onCancel?: () => void }) {
  const [name, setName] = useState(initial);
  return (
    <Modal title="Who's at the register?" onClose={onCancel}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
        <label className="field">
          <span>Cashier name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
        </label>
        <button type="submit" className="btn btn-lg btn-primary full" disabled={!name.trim()}>Start</button>
      </form>
    </Modal>
  );
}
