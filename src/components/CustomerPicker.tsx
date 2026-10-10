import { useMemo, useState } from 'react';
import type { Customer, Member, PendingCustomer } from '../lib/types';
import { MembershipBadge } from './MembershipBadge';
import { Modal } from './Modal';

interface Props {
  members: Member[];
  onPick: (c: Customer) => void;
  onCancel: () => void;
}

const MAX_RESULTS = 40;

export function searchMembers(members: Member[], query: string): Member[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const digits = q.replace(/\D/g, '');
  const words = q.split(/\s+/).filter(Boolean);
  return members
    .filter((m) => {
      if (digits.length >= 3 && m.phone_digits?.includes(digits)) return true;
      const hay = `${m.full_name} ${m.email ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => (a.last_name ?? '').localeCompare(b.last_name ?? '') || a.full_name.localeCompare(b.full_name))
    .slice(0, MAX_RESULTS);
}

export function CustomerPicker({ members, onPick, onCancel }: Props) {
  const [query, setQuery] = useState('');
  const [signup, setSignup] = useState<PendingCustomer | null>(null);
  const results = useMemo(() => searchMembers(members, query), [members, query]);

  if (signup) {
    const valid = signup.first_name.trim() && signup.last_name.trim() && (signup.phone.trim() || signup.email.trim());
    const field = (k: keyof PendingCustomer, label: string, type = 'text') => (
      <label className="field">
        <span>{label}</span>
        <input
          type={type}
          value={signup[k]}
          autoComplete="off"
          onChange={(e) => setSignup({ ...signup, [k]: e.target.value })}
        />
      </label>
    );
    return (
      <Modal title="New Farmmatch signup" onClose={onCancel}>
        <p className="muted">
          Use this when the customer is creating their Farmmatch account today. The sale is
          linked to their account at the weekly sync.
        </p>
        <div className="form-grid">
          {field('first_name', 'First name')}
          {field('last_name', 'Last name')}
          {field('phone', 'Phone', 'tel')}
          {field('email', 'Email', 'email')}
        </div>
        <p className="muted small">Phone or email is required so the account can be matched.</p>
        <div className="row gap">
          <button type="button" className="btn btn-lg btn-ghost grow" onClick={() => setSignup(null)}>Back</button>
          <button
            type="button"
            className="btn btn-lg btn-primary grow"
            disabled={!valid}
            onClick={() => onPick({
              kind: 'pending',
              pending: {
                first_name: signup.first_name.trim(), last_name: signup.last_name.trim(),
                phone: signup.phone.trim(), email: signup.email.trim(),
              },
            })}
          >
            Use this customer
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Find customer" onClose={onCancel} wide>
      <input
        className="search-input"
        type="search"
        placeholder="Name, phone, or email"
        value={query}
        autoFocus
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="customer-results">
        {query.trim() === '' && <p className="muted center pad">Start typing to search {members.length} accounts.</p>}
        {query.trim() !== '' && results.length === 0 && (
          <p className="muted center pad">No matching Farmmatch account.</p>
        )}
        {results.map((m) => (
          <button key={m.id} type="button" className="customer-row" onClick={() => onPick({ kind: 'member', member: m })}>
            <div>
              <div className="customer-name">{m.full_name}</div>
              <div className="muted small">{[m.phone, m.email].filter(Boolean).join(' · ')}</div>
            </div>
            <MembershipBadge member={m} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-lg btn-secondary full"
        onClick={() => {
          const [first = '', ...rest] = /\d/.test(query) ? [] : query.trim().split(/\s+/);
          setSignup({ first_name: first, last_name: rest.join(' '), phone: /\d/.test(query) ? query.trim() : '', email: '' });
        }}
      >
        + New Farmmatch signup
      </button>
    </Modal>
  );
}
