import { formatCents, formatQty, lineTotalCents } from '../lib/money';
import { canAddRenewal } from '../lib/membership';
import type { CartLine, Customer, MembershipStatus } from '../lib/types';
import { formatDate, MembershipBadge } from './MembershipBadge';

interface Props {
  customer: Customer | null;
  lines: CartLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  /** Status after local renewals are counted (null for new signups / no customer). */
  membershipStatus: MembershipStatus | null;
  membershipFeeCents: number;
  feeRateCents: number;
  onSetFee: (on: boolean) => void;
  jarReturns: number;
  jarRateCents: number;
  jarCreditCents: number;
  onChangeJars: (delta: number) => void;
  onPickCustomer: () => void;
  onClearCustomer: () => void;
  onChangeQty: (key: string, deltaWhole: number) => void;
  onEditWeight: (line: CartLine) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onPay: () => void;
}

export function Cart(props: Props) {
  const { customer, lines, subtotalCents, taxCents, totalCents, jarReturns, jarRateCents, jarCreditCents } = props;
  // More jars than the order is worth: the credit stops at the order total.
  const jarsCapped = jarReturns * jarRateCents > jarCreditCents;
  const jarsCredited = jarRateCents > 0 ? Math.floor(jarCreditCents / jarRateCents) : 0;
  const member = customer?.kind === 'member' ? customer.member : null;
  const status = props.membershipStatus;
  const feeCents = props.membershipFeeCents;
  const renewalDate = member?.renewal_date ? formatDate(member.renewal_date) : null;
  const addRenewal = (
    <button type="button" className="btn btn-small" onClick={() => props.onSetFee(true)}>
      + Add renewal {formatCents(props.feeRateCents)}
    </button>
  );
  const canPay = customer !== null && (lines.length > 0 || feeCents > 0);

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
              {member
                ? <MembershipBadge member={{ ...member, membership_status: status ?? member.membership_status }} />
                : <span className="badge badge-pending">New signup · links at sync</span>}
            </div>
            <button type="button" className="btn btn-ghost" onClick={props.onPickCustomer}>Change</button>
            <button type="button" className="btn btn-ghost" onClick={props.onClearCustomer} aria-label="Remove customer">✕</button>
          </div>
        ) : (
          <button type="button" className="btn btn-lg btn-secondary full" onClick={props.onPickCustomer}>
            👤 Select customer
          </button>
        )}
        {status === 'expired' && (
          <div className={`alert ${feeCents > 0 ? 'alert-warn' : 'alert-bad'} alert-row`}>
            <span>
              Membership expired{renewalDate && ` ${renewalDate}`}.{' '}
              {feeCents > 0 ? `${formatCents(feeCents)} renewal added to this order.` : 'Not renewing today.'}
            </span>
            {feeCents === 0 && addRenewal}
          </div>
        )}
        {status === 'expiring_soon' && feeCents === 0 && (
          <div className="alert alert-warn alert-row">
            <span>Membership renews{renewalDate && ` ${renewalDate}`}.</span>
            {addRenewal}
          </div>
        )}
        {status === 'none' && feeCents === 0 && (
          <div className="alert alert-warn alert-row">
            <span>No membership on file.</span>
            {addRenewal}
          </div>
        )}
        {status === 'renewed_in_store' && (
          <div className="alert alert-ok">Renewed at the register. FarmMatch updates at the weekly posting.</div>
        )}
      </div>

      <div className="cart-lines">
        {feeCents > 0 && (
          <div className="line line-fee">
            <div className="line-info">
              <div className="line-name">Membership renewal</div>
              <div className="muted small">{status === 'expired' ? 'Added because the membership expired' : 'Added by cashier'}</div>
            </div>
            <span />
            <div className="line-total">{formatCents(feeCents)}</div>
            {status !== null && canAddRenewal(status) && (
              <button type="button" className="line-remove" onClick={() => props.onSetFee(false)} aria-label="Remove membership renewal">✕</button>
            )}
          </div>
        )}
        {lines.length === 0 && feeCents === 0 && <p className="muted center pad">Tap products to add them.</p>}
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
        <div className="jar-row">
          <div className="grow">
            <div className="jar-label">Jar returns</div>
            <div className="muted small">{formatCents(jarRateCents)} credit per jar</div>
          </div>
          <div className="stepper">
            <button type="button" className="step" onClick={() => props.onChangeJars(-1)} disabled={jarReturns === 0} aria-label="Fewer jars">−</button>
            <span className="step-qty">{jarReturns}</span>
            <button type="button" className="step" onClick={() => props.onChangeJars(1)} aria-label="More jars">+</button>
          </div>
          <div className="line-total jar-credit">{jarCreditCents > 0 ? `−${formatCents(jarCreditCents)}` : ''}</div>
        </div>
        {jarsCapped && (
          <div className="alert alert-warn small">
            Credit stops at the order total: {jarsCredited} of {jarReturns} jars credited.
          </div>
        )}
        {(taxCents > 0 || jarCreditCents > 0 || feeCents > 0) && (
          <div className="row between muted"><span>Subtotal</span><span>{formatCents(subtotalCents)}</span></div>
        )}
        {taxCents > 0 && <div className="row between muted"><span>Tax</span><span>{formatCents(taxCents)}</span></div>}
        {feeCents > 0 && (
          <div className="row between muted"><span>Membership renewal</span><span>{formatCents(feeCents)}</span></div>
        )}
        {jarCreditCents > 0 && (
          <div className="row between muted"><span>Jar credit ({jarReturns} {jarReturns === 1 ? 'jar' : 'jars'})</span><span>−{formatCents(jarCreditCents)}</span></div>
        )}
        <div className="row between total-row"><span>Total</span><span>{formatCents(totalCents)}</span></div>
        <div className="row gap">
          <button type="button" className="btn btn-lg btn-ghost" onClick={props.onClear} disabled={lines.length === 0 && !customer && jarReturns === 0}>
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
