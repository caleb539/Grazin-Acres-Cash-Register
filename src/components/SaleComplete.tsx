import { formatCents } from '../lib/money';
import type { LocalSale } from '../lib/types';
import { Modal } from './Modal';

const TENDER_LABEL = { cash: 'Cash', check: 'Check', card_on_file: 'Card on file (Farmmatch)' } as const;

export function SaleComplete({ sale, onNext }: { sale: LocalSale; onNext: () => void }) {
  return (
    <Modal title="Sale complete">
      <div className="complete">
        {sale.tender === 'cash' ? (
          <>
            <div className="readout-label">Change due</div>
            <div className="change-big">{formatCents(sale.change_cents ?? 0)}</div>
            <div className="muted">
              {formatCents(sale.cash_tendered_cents ?? 0)} received · total {formatCents(sale.total_cents)}
            </div>
          </>
        ) : (
          <>
            <div className="readout-label">{TENDER_LABEL[sale.tender]}</div>
            <div className="change-big">{formatCents(sale.total_cents)}</div>
            {sale.check_number && <div className="muted">Check #{sale.check_number}</div>}
          </>
        )}
        <div className="muted small pad-y">Receipt {sale.receipt_number}</div>
        <div className="row gap">
          <button type="button" className="btn btn-lg btn-ghost grow" disabled title="Receipt printer setup comes next">
            Print receipt
          </button>
          <button type="button" className="btn btn-lg btn-primary grow2" onClick={onNext} autoFocus>
            New sale
          </button>
        </div>
      </div>
    </Modal>
  );
}
