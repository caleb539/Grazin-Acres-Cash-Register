import { formatCents, formatQty } from '../lib/money';
import type { LocalSale, Settings } from '../lib/types';

const TENDER_LABEL = {
  cash: 'Cash',
  check: 'Check',
  card_on_file: 'Card on file (Farmmatch)',
} as const;

function customerName(s: LocalSale): string {
  return s.customer.kind === 'member'
    ? s.customer.member.full_name
    : `${s.customer.pending.first_name} ${s.customer.pending.last_name}`;
}

export function Receipt({ sale, settings }: { sale: LocalSale; settings: Settings }) {
  const soldDate = new Date(sale.sold_at);

  return (
    <div className="print-receipt" aria-hidden="true">
      <div className="receipt-header">
        <div className="receipt-store">{settings.store_name || "Grazin' Acres"}</div>
        <div className="receipt-meta">
          {soldDate.toLocaleDateString()} · {soldDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </div>
        <div className="receipt-meta">
          Receipt {sale.receipt_number}
          {sale.cashier_name ? ` · Cashier: ${sale.cashier_name}` : ''}
        </div>
        <div className="receipt-meta">Customer: {customerName(sale)}</div>
        {sale.voided && <div className="receipt-void">*** VOIDED ***</div>}
      </div>

      <hr className="receipt-rule" />

      <div className="receipt-lines">
        {sale.lines.map((l, i) => {
          const detail =
            l.sale_type === 'weight'
              ? `${formatQty(l.qtyMilli)} ${l.unit} @ ${formatCents(l.unit_price_cents)}/${l.unit}`
              : l.qtyMilli !== 1000
                ? `${formatQty(l.qtyMilli)} × ${formatCents(l.unit_price_cents)}`
                : null;
          return (
            <div key={i} className="receipt-item">
              <div className="receipt-row">
                <span className="receipt-item-name">
                  {l.sale_type === 'each' && l.qtyMilli === 1000 ? l.name : l.name}
                </span>
                <span className="receipt-item-total">{formatCents(l.line_total_cents)}</span>
              </div>
              {detail && <div className="receipt-item-sub">{detail}</div>}
            </div>
          );
        })}

        {(sale.membership_fee_cents ?? 0) > 0 && (
          <div className="receipt-item">
            <div className="receipt-row">
              <span className="receipt-item-name">Membership renewal</span>
              <span className="receipt-item-total">{formatCents(sale.membership_fee_cents)}</span>
            </div>
          </div>
        )}
      </div>

      <hr className="receipt-rule" />

      <div className="receipt-totals">
        {(sale.tax_cents > 0 || (sale.jar_credit_cents ?? 0) > 0) && (
          <div className="receipt-row">
            <span>Subtotal</span>
            <span>{formatCents(sale.subtotal_cents + (sale.membership_fee_cents ?? 0))}</span>
          </div>
        )}
        {sale.tax_cents > 0 && (
          <div className="receipt-row">
            <span>Tax</span>
            <span>{formatCents(sale.tax_cents)}</span>
          </div>
        )}
        {(sale.jar_credit_cents ?? 0) > 0 && (
          <div className="receipt-row">
            <span>Jar credit ({sale.jar_returns} {sale.jar_returns === 1 ? 'jar' : 'jars'})</span>
            <span>−{formatCents(sale.jar_credit_cents)}</span>
          </div>
        )}
        <div className="receipt-row receipt-grand-total">
          <span>Total</span>
          <span>{formatCents(sale.total_cents)}</span>
        </div>
      </div>

      <hr className="receipt-rule" />

      <div className="receipt-tender">
        <div className="receipt-row">
          <span>Paid ({TENDER_LABEL[sale.tender]})</span>
          <span>
            {sale.tender === 'cash'
              ? formatCents(sale.cash_tendered_cents ?? sale.total_cents)
              : formatCents(sale.total_cents)}
          </span>
        </div>
        {sale.tender === 'cash' && (
          <div className="receipt-row">
            <span>Change</span>
            <span>{formatCents(sale.change_cents ?? 0)}</span>
          </div>
        )}
        {sale.tender === 'check' && sale.check_number && (
          <div className="receipt-row">
            <span>Check #</span>
            <span>{sale.check_number}</span>
          </div>
        )}
      </div>

      {settings.receipt_footer && (
        <>
          <hr className="receipt-rule" />
          <div className="receipt-footer">{settings.receipt_footer}</div>
        </>
      )}
    </div>
  );
}
