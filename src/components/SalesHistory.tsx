import { useMemo, useState } from 'react';
import { formatCents, formatQty } from '../lib/money';
import type { LocalSale } from '../lib/types';
import { Modal } from './Modal';

interface Props {
  sales: LocalSale[];
  onVoid: (sale: LocalSale, reason: string) => Promise<string | null>;
  onClose: () => void;
}

const TENDER = { cash: 'Cash', check: 'Check', card_on_file: 'Card on file' } as const;

function customerName(s: LocalSale): string {
  return s.customer.kind === 'member'
    ? s.customer.member.full_name
    : `${s.customer.pending.first_name} ${s.customer.pending.last_name} (new signup)`;
}

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

export function SalesHistory({ sales, onVoid, onClose }: Props) {
  const today = useMemo(
    () => sales.filter((s) => isToday(s.sold_at)).sort((a, b) => b.sold_at.localeCompare(a.sold_at)),
    [sales],
  );
  const [open, setOpen] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const live = today.filter((s) => !s.voided);
  const totals = (['cash', 'check', 'card_on_file'] as const).map((t) => ({
    t, cents: live.filter((s) => s.tender === t).reduce((n, s) => n + s.total_cents, 0),
  }));

  return (
    <Modal title="Today's sales" onClose={onClose} wide>
      <div className="totals-strip">
        {totals.map(({ t, cents }) => (
          <div key={t}><span className="muted small">{TENDER[t]}</span><strong>{formatCents(cents)}</strong></div>
        ))}
        <div><span className="muted small">Sales</span><strong>{live.length}</strong></div>
      </div>

      {today.length === 0 && <p className="muted center pad">No sales yet today.</p>}
      <div className="history-list">
        {today.map((s) => (
          <div key={s.id} className={`history-item${s.voided ? ' voided' : ''}`}>
            <button type="button" className="history-row" onClick={() => setOpen(open === s.id ? null : s.id)}>
              <span className="muted small mono">{new Date(s.sold_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              <span className="grow">{customerName(s)}</span>
              <span className="muted small">{TENDER[s.tender]}</span>
              <strong>{formatCents(s.total_cents)}</strong>
              <UploadChip sale={s} />
            </button>
            {open === s.id && (
              <div className="history-detail">
                <div className="muted small">Receipt {s.receipt_number} · {s.cashier_name || 'no cashier'}</div>
                {s.lines.map((l, i) => (
                  <div key={i} className="row between small">
                    <span>{l.sale_type === 'weight' ? `${formatQty(l.qtyMilli)} ${l.unit}` : `${formatQty(l.qtyMilli)} ×`} {l.name}</span>
                    <span>{formatCents(l.line_total_cents)}</span>
                  </div>
                ))}
                {(s.membership_fee_cents ?? 0) > 0 && (
                  <div className="row between small">
                    <span>Membership renewal</span>
                    <span>{formatCents(s.membership_fee_cents)}</span>
                  </div>
                )}
                {(s.jar_credit_cents ?? 0) > 0 && (
                  <div className="row between small">
                    <span>Jar returns ({s.jar_returns})</span>
                    <span>−{formatCents(s.jar_credit_cents)}</span>
                  </div>
                )}
                {s.upload_error && <div className="error small">Upload error: {s.upload_error}</div>}
                {!s.voided && voiding !== s.id && (
                  <button type="button" className="btn btn-danger-ghost" onClick={() => { setVoiding(s.id); setReason(''); setError(null); }}>
                    Void sale
                  </button>
                )}
                {voiding === s.id && (
                  <div className="void-box">
                    <label className="field">
                      <span>Reason for void</span>
                      <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                    </label>
                    {error && <div className="error small">{error}</div>}
                    <div className="row gap">
                      <button type="button" className="btn btn-ghost grow" onClick={() => setVoiding(null)}>Keep sale</button>
                      <button
                        type="button"
                        className="btn btn-danger grow"
                        disabled={!reason.trim() || busy}
                        onClick={async () => {
                          setBusy(true);
                          const err = await onVoid(s, reason.trim());
                          setBusy(false);
                          if (err) setError(err); else setVoiding(null);
                        }}
                      >
                        {busy ? 'Voiding…' : 'Void sale'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function UploadChip({ sale }: { sale: LocalSale }) {
  if (sale.voided) return <span className="chip chip-muted">Voided</span>;
  switch (sale.upload) {
    case 'uploaded': return <span className="chip chip-ok">Saved</span>;
    case 'queued': return <span className="chip chip-warn">Waiting</span>;
    case 'error': return <span className="chip chip-bad">Error</span>;
    case 'demo': return <span className="chip chip-muted">Demo</span>;
  }
}
