import { describe, expect, it } from 'vitest';
import { canAddRenewal, effectiveStatus, feeAddedByDefault } from './membership';
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
