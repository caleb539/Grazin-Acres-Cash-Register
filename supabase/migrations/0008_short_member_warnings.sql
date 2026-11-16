-- Warnings are shown to the cashier as "Account incomplete — Missing: <message>",
-- so the message is only *what's missing* ("Payment method"), at most 60 characters.
-- Existing long notes are rewritten separately before the length limit applies.

create or replace function public._default_warning_message(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'no_payment_method' then 'Payment method'
    when 'account_incomplete' then 'Account setup'
    else 'Check their FarmMatch account'
  end
$$;

create or replace function public.set_member_warning(p_farmmatch_id text, p_kind text, p_message text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member_id uuid;
  -- "Missing: x" is added by the register, so drop it if the agent included it.
  v_message text := coalesce(
    nullif(btrim(regexp_replace(coalesce(p_message, ''), '^\s*(farmmatch account incomplete\s*[:-]\s*)?(missing\s*[:-]\s*)?', '', 'i')), ''),
    public._default_warning_message(p_kind));
begin
  if p_kind not in ('no_payment_method', 'account_incomplete', 'other') then
    raise exception 'Unknown warning kind "%" (use no_payment_method, account_incomplete or other)', p_kind;
  end if;
  if length(v_message) > 60 then
    raise exception 'Warning too long (% characters, max 60). Write only what''s missing, e.g. ''Payment method'' or ''Signed membership agreement''.', length(v_message);
  end if;
  select id into v_member_id from public.members where farmmatch_id = p_farmmatch_id;
  if v_member_id is null then
    raise exception 'No member with farmmatch_id %', p_farmmatch_id;
  end if;

  insert into public.member_warnings (member_id, kind, message)
  values (v_member_id, p_kind, v_message)
  on conflict (member_id, kind) do update set message = excluded.message, updated_at = now();

  if p_kind = 'no_payment_method' then
    update public.members set has_card_on_file = false where id = v_member_id;
  end if;
  if p_kind = 'account_incomplete' then
    update public.members set farmmatch_issue = v_message where id = v_member_id;
  end if;

  return jsonb_build_object('farmmatch_id', p_farmmatch_id, 'kind', p_kind, 'message', v_message);
end $$;

-- The older one-note function is still used by an existing agent that writes
-- long notes; shorten instead of failing so its runs don't break.
create or replace function public.set_member_farmmatch_issue(p_farmmatch_id text, p_issue text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_text text := btrim(regexp_replace(coalesce(p_issue, ''), '^\s*(farmmatch account incomplete\s*[:-]\s*)?(missing\s*[:-]\s*)?', '', 'i'));
begin
  if v_text = '' then
    perform public.clear_member_warning(p_farmmatch_id, 'account_incomplete');
  elsif v_text ~* 'no payment method' then
    perform public.set_member_warning(p_farmmatch_id, 'no_payment_method');
  else
    perform public.set_member_warning(p_farmmatch_id, 'account_incomplete',
      case when length(v_text) > 60 then left(v_text, 59) || '…' else v_text end);
  end if;
end $$;

alter table public.member_warnings
  add constraint member_warnings_message_short check (length(message) <= 60);

revoke all on function public._default_warning_message(text) from public, anon, authenticated;
revoke all on function public.set_member_warning(text, text, text) from public, anon, authenticated;
revoke all on function public.set_member_farmmatch_issue(text, text) from public, anon, authenticated;
grant execute on function public.set_member_warning(text, text, text) to service_role;
grant execute on function public.set_member_farmmatch_issue(text, text) to service_role;
