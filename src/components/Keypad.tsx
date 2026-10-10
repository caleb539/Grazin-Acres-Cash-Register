interface Props {
  onKey: (key: string) => void;
  /** Show a decimal point key (weights). Cash entry uses "00" instead. */
  decimal?: boolean;
}

export function Keypad({ onKey, decimal }: Props) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimal ? '.' : '00', '0', '⌫'];
  return (
    <div className="keypad">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          className={`key${k === '⌫' ? ' key-back' : ''}`}
          onClick={() => onKey(k)}
          aria-label={k === '⌫' ? 'Backspace' : k}
        >
          {k}
        </button>
      ))}
    </div>
  );
}
