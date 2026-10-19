import type { Member } from '../lib/types';

const LABEL: Record<Member['membership_status'], string> = {
  active: 'Active',
  expiring_soon: 'Renews soon',
  expired: 'Expired',
  none: 'No membership',
  renewed_in_store: 'Renewed in store',
};

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function MembershipBadge({ member }: { member: Member }) {
  const s = member.membership_status;
  return (
    <span className={`badge badge-${s}`}>
      {LABEL[s]}
      {member.renewal_date && s !== 'none' && s !== 'renewed_in_store' && <> · {formatDate(member.renewal_date)}</>}
    </span>
  );
}
