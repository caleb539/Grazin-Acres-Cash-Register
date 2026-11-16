import { describe, expect, it } from 'vitest';
import { canAddRenewal, effectiveStatus, feeAddedByDefault, memberWarnings, WARNING_LABEL, warningDetail } from './membership';
import type { LocalSale, Member } from './types';

const member = (id: string, status: Member['membership_status']): Member => ({
  id, farmmatch_id: id, first_name: 'A', last_name: 'B', full_name: 'A B', email: null, phone: null,
  phone_digits: null, membership_type: null, renewal_date: '2026-01-01', has_card_on_file: false,
  membership_status: status,
});

const sale = (m: Member, fee: number, voided = false) =>
  ({ customer: { kind: 'member', member: m }, membership_fee_cents: fee, voided }) as unknown as LocalSale;

describe('effectiveStatus', () => {
  const expired = member('m1', 'expired');
  it('stays expired with no local renewal', () => {
    expect(effectiveStatus(expired, [])).toBe('expired');
    expect(effectiveStatus(expired, [sale(expired, 0)])).toBe('expired');
  });
  it('counts a renewal rung up on this iPad', () => {
    expect(effectiveStatus(expired, [sale(expired, 3000)])).toBe('renewed_in_store');
  });
  it('ignores voided renewals and other customers', () => {
    expect(effectiveStatus(expired, [sale(expired, 3000, true)])).toBe('expired');
    expect(effectiveStatus(expired, [sale(member('m2', 'expired'), 3000)])).toBe('expired');
  });
  it('handles sales saved before the fee existed', () => {
    const old = { customer: { kind: 'member', member: expired } } as unknown as LocalSale;
    expect(effectiveStatus(expired, [old])).toBe('expired');
  });
});

describe('fee rules', () => {
  it('adds the fee automatically only when expired', () => {
    expect(feeAddedByDefault('expired')).toBe(true);
    expect(feeAddedByDefault('expiring_soon')).toBe(false);
    expect(feeAddedByDefault('none')).toBe(false);
    expect(feeAddedByDefault('renewed_in_store')).toBe(false);
  });
  it('lets the cashier add a renewal unless already active or renewed', () => {
    expect(canAddRenewal('expiring_soon')).toBe(true);
    expect(canAddRenewal('none')).toBe(true);
    expect(canAddRenewal('active')).toBe(false);
    expect(canAddRenewal('renewed_in_store')).toBe(false);
  });
});

describe('memberWarnings', () => {
  it('returns the warnings list', () => {
    const m = { ...member('m1', 'active'), warnings: [{ kind: 'no_payment_method' as const, message: 'Add a card' }] };
    expect(memberWarnings(m)).toEqual([{ kind: 'no_payment_method', message: 'Add a card' }]);
  });
  it('falls back to the older single note', () => {
    expect(memberWarnings({ ...member('m1', 'active'), farmmatch_issue: 'Buyer is not a member' }))
      .toEqual([{ kind: 'account_incomplete', message: 'Buyer is not a member' }]);
  });
  it('shortens old long notes from a saved customer list', () => {
    const old = 'FarmMatch account incomplete: Buyer has no payment methods. Checkout halts on the ordering-deadline interstitial with red error';
    expect(memberWarnings({ ...member('m1', 'active'), warnings: [{ kind: 'account_incomplete', message: old }] }))
      .toEqual([{ kind: 'no_payment_method', message: 'Payment method' }]);
    const long = memberWarnings({ ...member('m1', 'active'), farmmatch_issue: 'FarmMatch account incomplete: ' + 'x'.repeat(80) })[0].message;
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('…')).toBe(true);
  });
  it('is empty when there is nothing', () => {
    expect(memberWarnings({ ...member('m1', 'active'), warnings: [], farmmatch_issue: '  ' })).toEqual([]);
  });
});

describe('warning text', () => {
  it('reads "Account incomplete" with what is missing', () => {
    const w = { kind: 'no_payment_method' as const, message: 'Payment method' };
    expect(WARNING_LABEL[w.kind]).toBe('Account incomplete');
    expect(warningDetail(w)).toBe('Missing: Payment method');
    expect(warningDetail({ kind: 'account_incomplete', message: 'Signed membership agreement' })).toBe('Missing: Signed membership agreement');
  });
  it('shows notes as written', () => {
    expect(warningDetail({ kind: 'other', message: 'Owes $12' })).toBe('Owes $12');
  });
});
