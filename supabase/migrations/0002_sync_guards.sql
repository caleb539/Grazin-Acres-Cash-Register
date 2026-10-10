-- Sync safety moves into the database so every caller gets it (the register
-- CLI, or an agent calling the functions directly through the Supabase MCP).
--
--   p_dry_run      validate + report what would change, write nothing
--   p_allow_shrink allow a full sync that hides more than 20% (min 5) of the
--                  active rows. Operator-only; normally a sign of a partial scrape.

drop function public.sync_products(jsonb, boolean);
drop function public.sync_members(jsonb, boolean);

-- Shared check: how many active rows a full sync would hide, refusing if too many.
create function public._sync_shrink_check(
  p_kind text, p_active_ids text[], p_active_names text[], p_incoming jsonb, p_allow_shrink boolean
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_incoming text[] := array(select i->>'farmmatch_id' from jsonb_array_elements(p_incoming) i);
  v_hide_names text[];
  v_active integer := coalesce(array_length(p_active_ids, 1), 0);
  v_limit integer;
begin
  select coalesce(array_agg(p_active_names[k]), '{}') into v_hide_names
  from generate_subscripts(p_active_ids, 1) k
  where not (p_active_ids[k] = any (v_incoming));

  v_limit := greatest(5, floor(v_active * 0.2)::integer);
  if coalesce(array_length(v_hide_names, 1), 0) > v_limit and not p_allow_shrink then
    raise exception 'Refusing: this full sync would hide % of % active % (limit %), e.g. %. If FarmMatch really shrank, the operator can pass p_allow_shrink => true. Otherwise the scrape probably missed pages.',
      array_length(v_hide_names, 1), v_active, p_kind, v_limit, array_to_string(v_hide_names[1:10], ', ');
  end if;
  return jsonb_build_object('currently_active', v_active,
                            'would_hide', coalesce(array_length(v_hide_names, 1), 0),
                            'would_hide_sample', to_jsonb(coalesce(v_hide_names[1:15], '{}')));
end $$;

create function public.sync_products(
  p_items jsonb, p_full_sync boolean default true, p_dry_run boolean default false, p_allow_shrink boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_received integer;
  v_inserted integer;
  v_updated integer;
  v_deactivated integer := 0;
  v_bad jsonb;
  v_plan jsonb := '{}'::jsonb;
  v_new integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items must be a JSON array';
  end if;
  v_received := jsonb_array_length(p_items);

  select jsonb_agg(i) into v_bad
  from jsonb_array_elements(p_items) i
  where coalesce(i->>'farmmatch_id', '') = ''
     or coalesce(i->>'name', '') = ''
     or coalesce(i->>'sale_type', '') not in ('each', 'weight')
     or case when jsonb_typeof(i->'price') = 'number' then (i->>'price')::numeric < 0 else true end;
  if v_bad is not null then
    raise exception 'Invalid product rows (need farmmatch_id, name, sale_type each|weight, numeric price >= 0): %', v_bad;
  end if;
  if (select count(distinct i->>'farmmatch_id') from jsonb_array_elements(p_items) i) <> v_received then
    raise exception 'Duplicate farmmatch_id values in p_items';
  end if;

  if p_full_sync then
    v_plan := public._sync_shrink_check('products',
      array(select farmmatch_id from public.products where active order by name),
      array(select name from public.products where active order by name),
      p_items, p_allow_shrink);
  end if;

  if p_dry_run then
    select count(*) into v_new from jsonb_array_elements(p_items) i
    where not exists (select 1 from public.products p where p.farmmatch_id = i->>'farmmatch_id');
    return v_plan || jsonb_build_object('dry_run', true, 'received', v_received, 'new', v_new, 'existing', v_received - v_new);
  end if;

  with src as (
    select
      i->>'farmmatch_id'                                   as farmmatch_id,
      i->>'name'                                           as name,
      nullif(i->>'category', '')                           as category,
      i->>'sale_type'                                      as sale_type,
      coalesce(nullif(i->>'unit', ''),
               case when i->>'sale_type' = 'weight' then 'lb' else 'ea' end) as unit,
      round((i->>'price')::numeric * 100)::integer         as price_cents,
      coalesce((i->>'taxable')::boolean, false)            as taxable,
      coalesce((i->>'sort_order')::integer, 0)             as sort_order
    from jsonb_array_elements(p_items) i
  ), up as (
    insert into public.products as p
      (farmmatch_id, name, category, sale_type, unit, price_cents, taxable, sort_order, active, last_synced_at)
    select farmmatch_id, name, category, sale_type, unit, price_cents, taxable, sort_order, true, now() from src
    on conflict (farmmatch_id) do update set
      name = excluded.name, category = excluded.category, sale_type = excluded.sale_type,
      unit = excluded.unit, price_cents = excluded.price_cents, taxable = excluded.taxable,
      sort_order = excluded.sort_order, active = true, last_synced_at = now()
    returning (xmax = 0) as was_insert
  )
  select count(*) filter (where was_insert), count(*) filter (where not was_insert)
    into v_inserted, v_updated from up;

  if p_full_sync then
    with d as (
      update public.products set active = false
      where active and farmmatch_id not in (select i->>'farmmatch_id' from jsonb_array_elements(p_items) i)
      returning 1
    ) select count(*) into v_deactivated from d;
  end if;

  insert into public.sync_runs (kind, full_sync, received, inserted, updated, deactivated)
  values ('products', p_full_sync, v_received, v_inserted, v_updated, v_deactivated);

  return jsonb_build_object('received', v_received, 'inserted', v_inserted,
                            'updated', v_updated, 'deactivated', v_deactivated);
end $$;

create function public.sync_members(
  p_items jsonb, p_full_sync boolean default true, p_dry_run boolean default false, p_allow_shrink boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_received integer;
  v_inserted integer;
  v_updated integer;
  v_deactivated integer := 0;
  v_bad jsonb;
  v_plan jsonb := '{}'::jsonb;
  v_new integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items must be a JSON array';
  end if;
  v_received := jsonb_array_length(p_items);

  select jsonb_agg(i) into v_bad
  from jsonb_array_elements(p_items) i
  where coalesce(i->>'farmmatch_id', '') = ''
     or (coalesce(i->>'first_name', '') = '' and coalesce(i->>'last_name', '') = '')
     or (coalesce(i->>'renewal_date', '') <> '' and (i->>'renewal_date') !~ '^\d{4}-\d{2}-\d{2}$');
  if v_bad is not null then
    raise exception 'Invalid member rows (need farmmatch_id, a name, renewal_date as YYYY-MM-DD or null): %', v_bad;
  end if;
  if (select count(distinct i->>'farmmatch_id') from jsonb_array_elements(p_items) i) <> v_received then
    raise exception 'Duplicate farmmatch_id values in p_items';
  end if;

  if p_full_sync then
    v_plan := public._sync_shrink_check('members',
      array(select farmmatch_id from public.members where active order by last_name, first_name),
      array(select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) from public.members where active order by last_name, first_name),
      p_items, p_allow_shrink);
  end if;

  if p_dry_run then
    select count(*) into v_new from jsonb_array_elements(p_items) i
    where not exists (select 1 from public.members m where m.farmmatch_id = i->>'farmmatch_id');
    return v_plan || jsonb_build_object('dry_run', true, 'received', v_received, 'new', v_new, 'existing', v_received - v_new);
  end if;

  with src as (
    select
      i->>'farmmatch_id'                              as farmmatch_id,
      nullif(i->>'first_name', '')                    as first_name,
      nullif(i->>'last_name', '')                     as last_name,
      nullif(i->>'email', '')                         as email,
      nullif(i->>'phone', '')                         as phone,
      nullif(i->>'membership_type', '')               as membership_type,
      nullif(i->>'renewal_date', '')::date            as renewal_date,
      coalesce((i->>'has_card_on_file')::boolean, false) as has_card_on_file,
      nullif(i->>'notes', '')                         as notes
    from jsonb_array_elements(p_items) i
  ), up as (
    insert into public.members as m
      (farmmatch_id, first_name, last_name, email, phone, membership_type, renewal_date,
       has_card_on_file, notes, active, last_synced_at)
    select farmmatch_id, first_name, last_name, email, phone, membership_type, renewal_date,
           has_card_on_file, notes, true, now() from src
    on conflict (farmmatch_id) do update set
      first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email,
      phone = excluded.phone, membership_type = excluded.membership_type,
      renewal_date = excluded.renewal_date, has_card_on_file = excluded.has_card_on_file,
      notes = excluded.notes, active = true, last_synced_at = now()
    returning (xmax = 0) as was_insert
  )
  select count(*) filter (where was_insert), count(*) filter (where not was_insert)
    into v_inserted, v_updated from up;

  if p_full_sync then
    with d as (
      update public.members set active = false
      where active and farmmatch_id not in (select i->>'farmmatch_id' from jsonb_array_elements(p_items) i)
      returning 1
    ) select count(*) into v_deactivated from d;
  end if;

  insert into public.sync_runs (kind, full_sync, received, inserted, updated, deactivated)
  values ('members', p_full_sync, v_received, v_inserted, v_updated, v_deactivated);

  return jsonb_build_object('received', v_received, 'inserted', v_inserted,
                            'updated', v_updated, 'deactivated', v_deactivated);
end $$;

revoke all on function public._sync_shrink_check(text, text[], text[], jsonb, boolean) from public, anon, authenticated;
revoke all on function public.sync_products(jsonb, boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.sync_members(jsonb, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.sync_products(jsonb, boolean, boolean, boolean) to service_role;
grant execute on function public.sync_members(jsonb, boolean, boolean, boolean) to service_role;
