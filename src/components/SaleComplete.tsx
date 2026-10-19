import { formatCents } from '../lib/money';
import type { LocalSale } from '../lib/types';
import { Modal } from './Modal';

const TENDER_LABEL = { cash: 'Cash', check: 'Check', card_on_file: 'Card on file (Farmmatch)' } as const;

export function SaleComplete({ sale, onPrint, onNext }: { sale: LocalSale; onPrint: () => void; onNext: () => void }) {
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
        {(sale.membership_fee_cents ?? 0) > 0 && (
          <div className="muted">Includes {formatCents(sale.membership_fee_cents)} membership renewal</div>
        )}
        {(sale.jar_credit_cents ?? 0) > 0 && (
          <div className="muted">
            Includes {formatCents(sale.jar_credit_cents)} jar credit ({sale.jar_returns} {sale.jar_returns === 1 ? 'jar' : 'jars'})
          </div>
        )}
        <div className="muted small pad-y">Receipt {sale.receipt_number}</div>
        <div className="row gap">
          <button type="button" className="btn btn-lg btn-ghost grow" onClick={onPrint}>
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
