import { useState } from 'react';
import { formatCents, quickCashOptions } from '../lib/money';
import type { Customer, Tender } from '../lib/types';
import { Keypad } from './Keypad';
import { Modal } from './Modal';

export interface Payment {
  tender: Tender;
  cash_tendered_cents: number | null;
  change_cents: number | null;
  check_number: string | null;
}

interface Props {
  totalCents: number;
  customer: Customer;
  onPay: (p: Payment) => void;
  onCancel: () => void;
}

const TENDERS: { id: Tender; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'check', label: 'Check' },
  { id: 'card_on_file', label: 'Card on file' },
];

export function PaymentModal({ totalCents, customer, onPay, onCancel }: Props) {
  const [tender, setTender] = useState<Tender>('cash');
  const [cashText, setCashText] = useState(''); // digits, entered as cents (register style)
  const [checkNo, setCheckNo] = useState('');
  const [cardConfirmed, setCardConfirmed] = useState(false);

  const cash = cashText ? parseInt(cashText, 10) : 0;
  const change = cash - totalCents;
  const noCardOnFile =
    customer.kind === 'pending' || (customer.kind === 'member' && !customer.member.has_card_on_file);

  const onCashKey = (k: string) =>
    setCashText((t) => (k === '⌫' ? t.slice(0, -1) : (t + k).replace(/^0+/, '').slice(0, 7)));

  const canPay =
    (tender === 'cash' && cash >= totalCents) ||
    tender === 'check' ||
    (tender === 'card_on_file' && (!noCardOnFile || cardConfirmed));

  const pay = () => {
    if (!canPay) return;
    if (tender === 'cash') {
      onPay({ tender, cash_tendered_cents: cash, change_cents: change, check_number: null });
    } else {
      onPay({ tender, cash_tendered_cents: null, change_cents: null, check_number: tender === 'check' ? checkNo.trim() || null : null });
    }
  };

  return (
    <Modal title={`Total ${formatCents(totalCents)}`} onClose={onCancel} wide>
      <div className="tender-tabs" role="tablist">
        {TENDERS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tender === t.id}
            className={`tender-tab${tender === t.id ? ' active' : ''}`}
            onClick={() => setTender(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tender === 'cash' && (
        <div className="cash-layout">
          <div>
            <div className="readout">
              <div className="readout-label">Cash received</div>
              <div className="readout-main">{formatCents(cash)}</div>
              <div className={`readout-change${change >= 0 && cash > 0 ? ' ok' : ''}`}>
                {cash === 0 ? 'Enter amount or tap a quick amount'
                  : change >= 0 ? <>Change due <strong>{formatCents(change)}</strong></>
                  : <>Still owed {formatCents(-change)}</>}
              </div>
            </div>
            <div className="quick-cash">
              {quickCashOptions(totalCents).map((amt) => (
                <button key={amt} type="button" className="btn btn-quick" onClick={() => setCashText(String(amt))}>
                  {amt === totalCents ? 'Exact' : formatCents(amt)}
                </button>
              ))}
            </div>
          </div>
          <Keypad onKey={onCashKey} />
        </div>
      )}

      {tender === 'check' && (
        <div className="pad-y">
          <label className="field">
            <span>Check number (optional)</span>
            <input inputMode="numeric" value={checkNo} onChange={(e) => setCheckNo(e.target.value)} autoFocus />
          </label>
          <p className="muted">Check made out for <strong>{formatCents(totalCents)}</strong>.</p>
        </div>
      )}

      {tender === 'card_on_file' && (
        <div className="pad-y">
          <p>
            <strong>{formatCents(totalCents)}</strong> will be charged to the card on file in this
            customer's Farmmatch account when the week's sales are posted. Nothing is charged here.
          </p>
          {noCardOnFile && (
            <label className="warn-box">
              <input type="checkbox" checked={cardConfirmed} onChange={(e) => setCardConfirmed(e.target.checked)} />
              <span>
                {customer.kind === 'pending'
                  ? 'New signup: make sure they added a card to their Farmmatch account.'
                  : 'Farmmatch shows no card on file for this customer. Confirm they have one.'}
              </span>
            </label>
          )}
        </div>
      )}

      <div className="row gap pay-actions">
        <button type="button" className="btn btn-lg btn-ghost grow" onClick={onCancel}>Back</button>
        <button type="button" className="btn btn-lg btn-primary grow2" disabled={!canPay} onClick={pay}>
          {tender === 'cash' ? (cash >= totalCents ? `Complete · change ${formatCents(Math.max(change, 0))}` : 'Complete')
            : 'Complete sale'}
        </button>
      </div>
    </Modal>
  );
}
