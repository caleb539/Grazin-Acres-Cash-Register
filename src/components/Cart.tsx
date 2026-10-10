import { formatCents, formatQty, lineTotalCents } from '../lib/money';
import type { CartLine, Customer } from '../lib/types';
import { formatDate, MembershipBadge } from './MembershipBadge';

interface Props {
  customer: Customer | null;
  lines: CartLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  onPickCustomer: () => void;
  onClearCustomer: () => void;
  onChangeQty: (key: string, deltaWhole: number) => void;
  onEditWeight: (line: CartLine) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onPay: () => void;
}

export function Cart(props: Props) {
  const { customer, lines, subtotalCents, taxCents, totalCents } = props;
  const member = customer?.kind === 'member' ? customer.member : null;
  const canPay = customer !== null && lines.length > 0;

  return (
    <section className="cart">
      <div className="cart-customer">
        {customer ? (
          <div className="customer-card">
            <div className="grow">
              <div className="customer-name">
                {customer.kind === 'member'
                  ? customer.member.full_name
                  : `${customer.pending.first_name} ${customer.pending.last_name}`}
              </div>
              {member ? <MembershipBadge member={member} /> : <span className="badge badge-pending">New signup · links at sync</span>}
            </div>
            <button type="button" className="btn btn-ghost" onClick={props.onPickCustomer}>Change</button>
            <button type="button" className="btn btn-ghost" onClick={props.onClearCustomer} aria-label="Remove customer">✕</button>
          </div>
        ) : (
          <button type="button" className="btn btn-lg btn-secondary full" onClick={props.onPickCustomer}>
            👤 Select customer
          </button>
        )}
        {member?.membership_status === 'expired' && (
          <div className="alert alert-bad">
            Membership expired {member.renewal_date && formatDate(member.renewal_date)}. Ask them to renew in Farmmatch.
          </div>
        )}
        {member?.membership_status === 'expiring_soon' && (
          <div className="alert alert-warn">Membership renews {member.renewal_date && formatDate(member.renewal_date)}. Remind them.</div>
        )}
      </div>

      <div className="cart-lines">
        {lines.length === 0 && <p className="muted center pad">Tap products to add them.</p>}
        {lines.map((l) => (
          <div key={l.key} className="line">
            <div className="line-info">
              <div className="line-name">{l.product.name}</div>
              <div className="muted small">
                {l.product.sale_type === 'weight'
                  ? `${formatQty(l.qtyMilli)} ${l.product.unit} × ${formatCents(l.unitPriceCents)}/${l.product.unit}`
                  : `${formatCents(l.unitPriceCents)} each`}
              </div>
            </div>
            {l.product.sale_type === 'weight' ? (
              <button type="button" className="btn btn-small" onClick={() => props.onEditWeight(l)}>Edit wt</button>
            ) : (
              <div className="stepper">
                <button type="button" className="step" onClick={() => props.onChangeQty(l.key, -1)} aria-label="Decrease">−</button>
                <span className="step-qty">{formatQty(l.qtyMilli)}</span>
                <button type="button" className="step" onClick={() => props.onChangeQty(l.key, 1)} aria-label="Increase">+</button>
              </div>
            )}
            <div className="line-total">{formatCents(lineTotalCents(l.qtyMilli, l.unitPriceCents))}</div>
            <button type="button" className="line-remove" onClick={() => props.onRemove(l.key)} aria-label={`Remove ${l.product.name}`}>✕</button>
          </div>
        ))}
      </div>

      <div className="cart-foot">
        {taxCents > 0 && (
          <>
            <div className="row between muted"><span>Subtotal</span><span>{formatCents(subtotalCents)}</span></div>
            <div className="row between muted"><span>Tax</span><span>{formatCents(taxCents)}</span></div>
          </>
        )}
        <div className="row between total-row"><span>Total</span><span>{formatCents(totalCents)}</span></div>
        <div className="row gap">
          <button type="button" className="btn btn-lg btn-ghost" onClick={props.onClear} disabled={lines.length === 0 && !customer}>
            Clear
          </button>
          <button type="button" className="btn btn-xl btn-primary grow" disabled={!canPay} onClick={props.onPay}>
            {!customer && lines.length > 0 ? 'Select customer to pay' : `Pay ${formatCents(totalCents)}`}
          </button>
        </div>
      </div>
    </section>
  );
}
