-- A flag the cashier sees when this customer is selected at the register.
-- Set by the weekly FarmMatch posting when an order can't be entered because of a problem on the
-- customer's FarmMatch account (e.g. "Buyer is not a member": profile/onboarding incomplete).
-- It is plain text shown to the cashier; null/empty means no problem. sync_members never touches it.

alter table public.members add column farmmatch_issue text;

-- Same view as before with one extra column at the end (create or replace can only append columns).
create or replace view public.member_lookup with (security_invoker = true) as
select
  m.id,
  m.farmmatch_id,
  m.first_name,
  m.last_name,
  trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')) as full_name,
  m.email,
  m.phone,
  m.phone_digits,
  m.membership_type,
  m.renewal_date,
  m.has_card_on_file,
  case
    when exists (
      select 1 from public.sales s
      where s.member_id = m.id and s.status = 'completed' and s.membership_fee_cents > 0
        and (m.renewal_date is null or m.renewal_date <= s.sold_at::date + st.expiring_soon_days)
    ) then 'renewed_in_store'
    when m.renewal_date is null then 'none'
    when m.renewal_date < current_date then 'expired'
    when m.renewal_date <= current_date + st.expiring_soon_days then 'expiring_soon'
    else 'active'
  end as membership_status,
  m.farmmatch_issue
from public.members m
cross join public.settings st
where m.active;

-- The posting agent sets or clears the flag by FarmMatch customer id. Empty/null clears it.
create or replace function public.set_member_farmmatch_issue(p_farmmatch_id text, p_issue text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.members
     set farmmatch_issue = nullif(btrim(coalesce(p_issue, '')), ''),
         updated_at = now()
   where farmmatch_id = p_farmmatch_id;
  if not found then
    raise exception 'No member with farmmatch_id %', p_farmmatch_id;
  end if;
end $$;

revoke all on function public.set_member_farmmatch_issue(text, text) from public, anon, authenticated;
grant execute on function public.set_member_farmmatch_issue(text, text) to service_role;
