import { useState } from 'react';
import { formatCents, formatQty, lineTotalCents, parseQtyMilli } from '../lib/money';
import type { Product } from '../lib/types';
import { Keypad } from './Keypad';
import { Modal } from './Modal';

interface Props {
  product: Product;
  /** Editing an existing line: its current weight. */
  initialMilli?: number;
  /** New line: package size from the product name, pre-filled but replaceable. */
  suggestedMilli?: number | null;
  onDone: (qtyMilli: number) => void;
  onCancel: () => void;
}

export function WeightPad({ product, initialMilli, suggestedMilli, onDone, onCancel }: Props) {
  const start = initialMilli ?? suggestedMilli ?? null;
  const [text, setText] = useState(start ? formatQty(start) : '');
  // While the pre-filled value is untouched, the first key replaces it rather than appending.
  const [prefilled, setPrefilled] = useState(start !== null);
  const qty = parseQtyMilli(text);
  const valid = qty !== null && qty > 0;
  const showHint = prefilled && !initialMilli && suggestedMilli;

  const onKey = (k: string) => {
    const wasPrefilled = prefilled;
    setPrefilled(false);
    setText((t) => {
      if (wasPrefilled) return k === '⌫' ? '' : k === '.' ? '0.' : k;
      if (k === '⌫') return t.slice(0, -1);
      if (k === '.' && t.includes('.')) return t;
      const next = t + k;
      return parseQtyMilli(next) === null && next !== '.' ? t : next.length > 8 ? t : next;
    });
  };

  return (
    <Modal title={product.name} onClose={onCancel}>
      <div className="weight-pad">
        <div className={`readout${prefilled ? ' readout-prefilled' : ''}`}>
          <div className="readout-main">
            {text || '0'} <span className="unit">{product.unit}</span>
          </div>
          <div className="readout-sub">
            × {formatCents(product.price_cents)}/{product.unit} ={' '}
            <strong>{formatCents(valid ? lineTotalCents(qty, product.price_cents) : 0)}</strong>
          </div>
        </div>
        {showHint && (
          <p className="hint">Usual package size. If the label weight is different, type it in.</p>
        )}
        <Keypad decimal onKey={onKey} />
        <div className="row gap">
          <button type="button" className="btn btn-lg btn-ghost grow" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="btn btn-lg btn-primary grow"
            disabled={!valid}
            onClick={() => valid && onDone(qty)}
          >
            {initialMilli ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
