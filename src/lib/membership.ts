import type { LocalSale, Member, MembershipStatus } from './types';

/**
 * The member's status as the register should treat it right now. The server
 * already reports 'renewed_in_store' after a renewal reaches it; this also
 * covers renewals rung up on this iPad that haven't uploaded or synced back
 * yet (offline, or before the next catalog refresh).
 */
export function effectiveStatus(member: Member, localSales: LocalSale[]): MembershipStatus {
  const s = member.membership_status;
  if (s === 'active' || s === 'renewed_in_store') return s;
  const renewedHere = localSales.some(
    (sale) =>
      !sale.voided &&
      (sale.membership_fee_cents ?? 0) > 0 &&
      sale.customer.kind === 'member' &&
      sale.customer.member.id === member.id,
  );
  return renewedHere ? 'renewed_in_store' : s;
}

/** Expired memberships get the renewal fee added automatically. */
export const feeAddedByDefault = (status: MembershipStatus) => status === 'expired';

/** Statuses where the cashier may add a renewal by hand. */
export const canAddRenewal = (status: MembershipStatus) =>
  status === 'expired' || status === 'expiring_soon' || status === 'none';
