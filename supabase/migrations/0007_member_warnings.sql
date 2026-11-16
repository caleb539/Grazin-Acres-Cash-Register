-- Warnings the FarmMatch agent writes onto a customer's profile for the cashier,
-- e.g. "no payment method in FarmMatch, ask them to add a card". One row per
-- (customer, kind); the agent sets and clears each kind on its own. Generalises
-- members.farmmatch_issue (0006), which becomes the 'account_incomplete' kind.
-- sync_members never touches these.

create table public.member_warnings (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members (id) on delete cascade,
  kind        text not null check (kind in ('no_payment_method', 'account_incomplete', 'other')),
  message     text not null check (btrim(message) <> ''),
  source      text not null default 'agent',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (member_id, kind)
);
create index member_warnings_member_idx on public.member_warnings (member_id);

-- Carry over anything already written with set_member_farmmatch_issue.
insert into public.member_warnings (member_id, kind, message)
select id, 'account_incomplete', btrim(farmmatch_issue)
from public.members
where nullif(btrim(coalesce(farmmatch_issue, '')), '') is not null;

-- The text the cashier sees when the agent doesn't supply its own.
create function public._default_warning_message(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'no_payment_method' then 'No payment method in FarmMatch. Ask them to add a card to their FarmMatch account.'
    when 'account_incomplete' then 'FarmMatch account is incomplete. Ask them to finish setting up their FarmMatch account.'
    else 'Check this customer''s FarmMatch account.'
  end
$$;

-- Agent: set (or update) one warning on a customer, by FarmMatch customer id.
create function public.set_member_warning(p_farmmatch_id text, p_kind text, p_message text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member_id uuid;
  v_message text := coalesce(nullif(btrim(coalesce(p_message, '')), ''), public._default_warning_message(p_kind));
begin
  if p_kind not in ('no_payment_method', 'account_incomplete', 'other') then
    raise exception 'Unknown warning kind "%" (use no_payment_method, account_incomplete or other)', p_kind;
  end if;
  select id into v_member_id from public.members where farmmatch_id = p_farmmatch_id;
  if v_member_id is null then
    raise exception 'No member with farmmatch_id %', p_farmmatch_id;
  end if;

  insert into public.member_warnings (member_id, kind, message)
  values (v_member_id, p_kind, v_message)
  on conflict (member_id, kind) do update set message = excluded.message, updated_at = now();

  -- Keep the card-on-file flag consistent so the payment screen agrees.
  if p_kind = 'no_payment_method' then
    update public.members set has_card_on_file = false where id = v_member_id;
  end if;
  if p_kind = 'account_incomplete' then
    update public.members set farmmatch_issue = v_message where id = v_member_id;
  end if;

  return jsonb_build_object('farmmatch_id', p_farmmatch_id, 'kind', p_kind, 'message', v_message);
end $$;

-- Agent: clear one warning kind, or all of them when p_kind is null.
create function public.clear_member_warning(p_farmmatch_id text, p_kind text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member_id uuid;
  v_cleared integer;
  v_had_no_payment boolean;
begin
  select id into v_member_id from public.members where farmmatch_id = p_farmmatch_id;
  if v_member_id is null then
    raise exception 'No member with farmmatch_id %', p_farmmatch_id;
  end if;

  select exists (select 1 from public.member_warnings where member_id = v_member_id and kind = 'no_payment_method')
    into v_had_no_payment;
  delete from public.member_warnings where member_id = v_member_id and (p_kind is null or kind = p_kind);
  get diagnostics v_cleared = row_count;

  -- Clearing "no payment method" means the agent saw a card on the account.
  if v_had_no_payment and (p_kind is null or p_kind = 'no_payment_method') then
    update public.members set has_card_on_file = true where id = v_member_id;
  end if;
  if p_kind is null or p_kind = 'account_incomplete' then
    update public.members set farmmatch_issue = null where id = v_member_id;
  end if;

  return jsonb_build_object('farmmatch_id', p_farmmatch_id, 'cleared', v_cleared);
end $$;

-- 0006's function keeps working: it now writes the 'account_incomplete' warning.
create or replace function public.set_member_farmmatch_issue(p_farmmatch_id text, p_issue text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if nullif(btrim(coalesce(p_issue, '')), '') is null then
    perform public.clear_member_warning(p_farmmatch_id, 'account_incomplete');
  else
    perform public.set_member_warning(p_farmmatch_id, 'account_incomplete', p_issue);
  end if;
end $$;

-- Register view: same columns as before plus the warnings list at the end.
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
  m.farmmatch_issue,
  coalesce((
    select jsonb_agg(jsonb_build_object('kind', w.kind, 'message', w.message, 'updated_at', w.updated_at)
                     order by w.kind)
    from public.member_warnings w where w.member_id = m.id
  ), '[]'::jsonb) as warnings
from public.members m
cross join public.settings st
where m.active;

alter table public.member_warnings enable row level security;
revoke all on public.member_warnings from anon, authenticated;
grant select on public.member_warnings to authenticated;
create policy register_read on public.member_warnings for select to authenticated using (true);

revoke all on public.member_lookup from anon;
grant select on public.member_lookup to authenticated;

revoke all on function public._default_warning_message(text) from public, anon, authenticated;
revoke all on function public.set_member_warning(text, text, text) from public, anon, authenticated;
revoke all on function public.clear_member_warning(text, text) from public, anon, authenticated;
revoke all on function public.set_member_farmmatch_issue(text, text) from public, anon, authenticated;
grant execute on function public.set_member_warning(text, text, text) to service_role;
grant execute on function public.clear_member_warning(text, text) to service_role;
grant execute on function public.set_member_farmmatch_issue(text, text) to service_role;
