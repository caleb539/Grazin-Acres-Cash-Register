import type { LocalSale, Member, MemberWarning, MembershipStatus, WarningKind } from './types';

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

const MAX_WARNING = 60;

/**
 * Keep warnings to "what's missing", even for older long notes still in a saved
 * customer list (the database enforces the same rules for new ones).
 */
export function tidyWarning(w: MemberWarning): MemberWarning {
  let message = w.message.replace(/^\s*(farmmatch account incomplete\s*[:-]\s*)?(missing\s*[:-]\s*)?/i, '').trim();
  let kind = w.kind;
  if (kind !== 'other' && /no payment methods?/i.test(message)) {
    kind = 'no_payment_method';
    message = 'Payment method';
  }
  if (message.length > MAX_WARNING) message = `${message.slice(0, MAX_WARNING - 1).trimEnd()}…`;
  return { ...w, kind, message: message || (kind === 'no_payment_method' ? 'Payment method' : 'Account setup') };
}

/** The customer's account warnings. Falls back to the older single farmmatch_issue note. */
export function memberWarnings(member: Member): MemberWarning[] {
  if (member.warnings && member.warnings.length) return member.warnings.map(tidyWarning);
  const issue = member.farmmatch_issue?.trim();
  return issue ? [tidyWarning({ kind: 'account_incomplete', message: issue })] : [];
}

export const WARNING_LABEL: Record<WarningKind, string> = {
  no_payment_method: 'Account incomplete',
  account_incomplete: 'Account incomplete',
  other: 'Note on account',
};

/** The line under the title: "Missing: Payment method" (notes are shown as written). */
export function warningDetail(w: MemberWarning): string {
  return w.kind === 'other' ? w.message : `Missing: ${w.message}`;
}
