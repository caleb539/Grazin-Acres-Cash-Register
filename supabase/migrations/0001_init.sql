-- Grazin' Acres Register — initial schema
--
-- Data flow:
--   Farmmatch --(agent: sync_products / sync_members)--> products, members
--   iPad register --(record_sale)--> sales, sale_lines
--   agent reads agent_sales_to_post --> enters into Farmmatch --> mark_sale_posted
--
-- Money is stored as integer cents everywhere. The agent-facing sync
-- functions accept dollar amounts and convert.

-- ---------------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------------
create table public.settings (
  id                  boolean primary key default true check (id),
  store_name          text    not null default 'Grazin'' Acres',
  tax_rate            numeric(6,5) not null default 0 check (tax_rate >= 0 and tax_rate < 1),
  expiring_soon_days  integer not null default 14 check (expiring_soon_days >= 0),
  receipt_footer      text    not null default 'Thank you!',
  updated_at          timestamptz not null default now()
);
insert into public.settings default values;

-- ---------------------------------------------------------------------------
-- Products (owned by Farmmatch; written only by the agent)
-- ---------------------------------------------------------------------------
create table public.products (
  id              uuid primary key default gen_random_uuid(),
  farmmatch_id    text not null unique,
  name            text not null,
  category        text,
  sale_type       text not null check (sale_type in ('each', 'weight')),
  unit            text not null default 'ea',          -- 'ea', 'lb', 'oz', 'gal', ...
  price_cents     integer not null check (price_cents >= 0), -- per unit (per lb for weight items)
  taxable         boolean not null default false,
  active          boolean not null default true,
  sort_order      integer not null default 0,
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index products_active_category_idx on public.products (active, category, sort_order, name);

-- ---------------------------------------------------------------------------
-- Members / customers (owned by Farmmatch; written only by the agent)
-- Every Farmmatch account is a row here, member or not.
-- ---------------------------------------------------------------------------
create table public.members (
  id                uuid primary key default gen_random_uuid(),
  farmmatch_id      text not null unique,
  first_name        text,
  last_name         text,
  email             text,
  phone             text,
  phone_digits      text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  membership_type   text,            -- free text from Farmmatch, e.g. 'Annual', 'Family'
  renewal_date      date,            -- null = no membership on file
  has_card_on_file  boolean not null default false,
  active            boolean not null default true,  -- false = no longer in Farmmatch
  notes             text,
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index members_last_first_idx on public.members (lower(last_name), lower(first_name));
create index members_phone_digits_idx on public.members (phone_digits);
create index members_email_idx on public.members (lower(email));

-- ---------------------------------------------------------------------------
-- Pending customers: someone who signed up for Farmmatch in the store but
-- isn't in members yet. The agent links them once the account syncs.
-- ---------------------------------------------------------------------------
create table public.pending_customers (
  id                 uuid primary key default gen_random_uuid(),
  first_name         text not null,
  last_name          text not null,
  phone              text,
  email              text,
  created_at         timestamptz not null default now(),
  matched_member_id  uuid references public.members (id),
  matched_at         timestamptz,
  constraint pending_has_contact check (phone is not null or email is not null)
);

-- ---------------------------------------------------------------------------
-- Sales
-- id is generated on the iPad so offline retries are idempotent.
-- ---------------------------------------------------------------------------
create table public.sales (
  id                    uuid primary key,
  receipt_number        text not null unique,
  device_id             text not null,
  cashier_name          text,
  member_id             uuid references public.members (id),
  pending_customer_id   uuid references public.pending_customers (id),
  sold_at               timestamptz not null,
  subtotal_cents        integer not null check (subtotal_cents >= 0),
  tax_cents             integer not null default 0 check (tax_cents >= 0),
  total_cents           integer not null check (total_cents >= 0),
  tender                text not null check (tender in ('cash', 'check', 'card_on_file')),
  cash_tendered_cents   integer check (cash_tendered_cents >= 0),
  change_cents          integer check (change_cents >= 0),
  check_number          text,
  status                text not null default 'completed' check (status in ('completed', 'voided')),
  voided_at             timestamptz,
  void_reason           text,
  -- Farmmatch posting (agent-managed)
  posting_status        text not null default 'unposted'
                        check (posting_status in ('unposted', 'posted', 'failed', 'needs_reversal', 'reversed', 'not_needed')),
  farmmatch_order_ref   text,
  posted_at             timestamptz,
  posting_error         text,
  posting_attempts      integer not null default 0,
  created_at            timestamptz not null default now(),
  constraint sales_has_customer check (member_id is not null or pending_customer_id is not null),
  constraint sales_total_math check (total_cents = subtotal_cents + tax_cents),
  constraint sales_cash_fields check (
    tender <> 'cash' or (cash_tendered_cents is not null and change_cents = cash_tendered_cents - total_cents)
  )
);
create index sales_sold_at_idx on public.sales (sold_at desc);
create index sales_posting_idx on public.sales (posting_status) where posting_status in ('unposted', 'failed', 'needs_reversal');
create index sales_member_idx on public.sales (member_id);
create index sales_pending_customer_idx on public.sales (pending_customer_id);

create table public.sale_lines (
  id                    uuid primary key default gen_random_uuid(),
  sale_id               uuid not null references public.sales (id) on delete cascade,
  line_no               integer not null,
  product_id            uuid not null references public.products (id),
  -- snapshots so receipts/posting stay correct if the product changes later
  farmmatch_product_id  text not null,
  product_name          text not null,
  sale_type             text not null check (sale_type in ('each', 'weight')),
  unit                  text not null,
  quantity              numeric(10,3) not null check (quantity > 0),  -- count, or weight in `unit`
  unit_price_cents      integer not null check (unit_price_cents >= 0),
  line_total_cents      integer not null check (line_total_cents >= 0),
  taxable               boolean not null,
  unique (sale_id, line_no)
);
create index sale_lines_product_idx on public.sale_lines (product_id);

-- ---------------------------------------------------------------------------
-- Sync log
-- ---------------------------------------------------------------------------
create table public.sync_runs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('products', 'members')),
  full_sync    boolean not null,
  started_at   timestamptz not null default now(),
  received     integer not null default 0,
  inserted     integer not null default 0,
  updated      integer not null default 0,
  deactivated  integer not null default 0,
  note         text
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger members_touch before update on public.members
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Register-facing view: member lookup with computed membership status
-- ---------------------------------------------------------------------------
create view public.member_lookup with (security_invoker = true) as
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
    when m.renewal_date is null then 'none'
    when m.renewal_date < current_date then 'expired'
    when m.renewal_date <= current_date + s.expiring_soon_days then 'expiring_soon'
    else 'active'
  end as membership_status
from public.members m
cross join public.settings s
where m.active;

-- ---------------------------------------------------------------------------
-- Agent: sync functions
-- p_items is a JSON array. p_full_sync = true means the array is the complete
-- list from Farmmatch, so anything not in it gets deactivated.
-- ---------------------------------------------------------------------------
create function public.sync_products(p_items jsonb, p_full_sync boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_received integer;
  v_inserted integer;
  v_updated integer;
  v_deactivated integer := 0;
  v_bad jsonb;
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

create function public.sync_members(p_items jsonb, p_full_sync boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_received integer;
  v_inserted integer;
  v_updated integer;
  v_deactivated integer := 0;
  v_bad jsonb;
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

-- Agent: after an in-store signup shows up in Farmmatch, link it.
create function public.link_pending_customer(p_pending_customer_id uuid, p_member_farmmatch_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member_id uuid;
  v_sales integer;
begin
  select id into v_member_id from public.members where farmmatch_id = p_member_farmmatch_id;
  if v_member_id is null then
    raise exception 'No member with farmmatch_id % — run sync_members first', p_member_farmmatch_id;
  end if;

  update public.pending_customers
     set matched_member_id = v_member_id, matched_at = now()
   where id = p_pending_customer_id;
  if not found then
    raise exception 'No pending customer %', p_pending_customer_id;
  end if;

  update public.sales set member_id = v_member_id
   where pending_customer_id = p_pending_customer_id and member_id is null;
  get diagnostics v_sales = row_count;

  return jsonb_build_object('member_id', v_member_id, 'sales_linked', v_sales);
end $$;

-- ---------------------------------------------------------------------------
-- Agent: posting sales to Farmmatch
-- ---------------------------------------------------------------------------
create view public.agent_sales_to_post with (security_invoker = true) as
select
  s.id                         as sale_id,
  s.receipt_number,
  s.sold_at,
  case when s.posting_status = 'needs_reversal' then 'reverse' else 'post' end as action,
  s.posting_status,
  s.posting_attempts,
  s.posting_error,
  s.farmmatch_order_ref,
  m.farmmatch_id               as customer_farmmatch_id,
  trim(coalesce(m.first_name, pc.first_name, '') || ' ' || coalesce(m.last_name, pc.last_name, '')) as customer_name,
  coalesce(m.email, pc.email)  as customer_email,
  coalesce(m.phone, pc.phone)  as customer_phone,
  s.tender,
  s.check_number,
  round(s.subtotal_cents / 100.0, 2) as subtotal,
  round(s.tax_cents / 100.0, 2)      as tax,
  round(s.total_cents / 100.0, 2)    as total,
  s.cashier_name,
  (
    select jsonb_agg(jsonb_build_object(
             'line_no', l.line_no,
             'farmmatch_product_id', l.farmmatch_product_id,
             'product_name', l.product_name,
             'sale_type', l.sale_type,
             'unit', l.unit,
             'quantity', l.quantity,
             'unit_price', round(l.unit_price_cents / 100.0, 2),
             'line_total', round(l.line_total_cents / 100.0, 2),
             'taxable', l.taxable)
           order by l.line_no)
    from public.sale_lines l where l.sale_id = s.id
  ) as lines,
  (m.farmmatch_id is not null)  as ready,
  case when m.farmmatch_id is null
       then 'Customer signed up in store and is not linked to a Farmmatch account yet (pending_customer_id ' || s.pending_customer_id || ')'
  end as blocked_reason,
  s.pending_customer_id
from public.sales s
left join public.members m on m.id = s.member_id
left join public.pending_customers pc on pc.id = s.pending_customer_id
where (s.status = 'completed' and s.posting_status in ('unposted', 'failed'))
   or s.posting_status = 'needs_reversal'
order by s.sold_at;

create function public.mark_sale_posted(p_sale_id uuid, p_farmmatch_order_ref text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.sales
     set posting_status = case when posting_status = 'needs_reversal' then 'reversed' else 'posted' end,
         farmmatch_order_ref = coalesce(p_farmmatch_order_ref, farmmatch_order_ref),
         posted_at = now(),
         posting_error = null,
         posting_attempts = posting_attempts + 1
   where id = p_sale_id and posting_status in ('unposted', 'failed', 'needs_reversal');
  if not found then
    raise exception 'Sale % not found or not awaiting posting', p_sale_id;
  end if;
end $$;

create function public.mark_sale_failed(p_sale_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.sales
     set posting_status = case when posting_status = 'needs_reversal' then 'needs_reversal' else 'failed' end,
         posting_error = p_error,
         posting_attempts = posting_attempts + 1
   where id = p_sale_id and posting_status in ('unposted', 'failed', 'needs_reversal');
  if not found then
    raise exception 'Sale % not found or not awaiting posting', p_sale_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Register: record a sale (atomic, idempotent, math-checked)
-- ---------------------------------------------------------------------------
create function public.record_sale(p_sale jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := (p_sale->>'id')::uuid;
  v_existing text;
  v_tax_rate numeric;
  v_subtotal integer := 0;
  v_taxable integer := 0;
  v_tax integer;
  v_total integer;
  v_line jsonb;
  v_line_no integer := 0;
  v_lines jsonb := '[]'::jsonb;
  v_product public.products%rowtype;
  v_qty numeric;
  v_price integer;
  v_line_total integer;
  v_tender text := p_sale->>'tender';
  v_cash integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if v_id is null then
    raise exception 'Sale id is required';
  end if;

  -- Idempotent: a retried upload returns the existing receipt.
  select receipt_number into v_existing from public.sales where id = v_id;
  if v_existing is not null then
    return jsonb_build_object('sale_id', v_id, 'receipt_number', v_existing, 'duplicate', true);
  end if;

  if (case when jsonb_typeof(p_sale->'lines') = 'array' then jsonb_array_length(p_sale->'lines') = 0 else true end) then
    raise exception 'Sale must have at least one line';
  end if;
  if (p_sale->>'member_id') is null and (p_sale->>'pending_customer_id') is null then
    raise exception 'Sale must have a member_id or pending_customer_id';
  end if;

  -- Pass 1: validate lines and compute totals.
  for v_line in select * from jsonb_array_elements(p_sale->'lines') loop
    v_line_no := v_line_no + 1;
    select * into v_product from public.products where id = (v_line->>'product_id')::uuid;
    if v_product.id is null then
      raise exception 'Line %: unknown product %', v_line_no, v_line->>'product_id';
    end if;

    v_qty := (v_line->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Line %: quantity must be > 0', v_line_no;
    end if;
    if v_product.sale_type = 'each' and v_qty <> trunc(v_qty) then
      raise exception 'Line %: % is sold by count, quantity must be whole', v_line_no, v_product.name;
    end if;

    -- Price the iPad charged (from its cached product list). Normally equals
    -- the current price; may differ if a sync landed mid-shift, which is fine.
    v_price := (v_line->>'unit_price_cents')::integer;
    if v_price is null or v_price < 0 then
      raise exception 'Line %: unit_price_cents is required', v_line_no;
    end if;
    v_line_total := round(v_qty * v_price);
    if v_line_total is distinct from (v_line->>'line_total_cents')::integer then
      raise exception 'Line %: line total % does not equal quantity x price (%)',
        v_line_no, v_line->>'line_total_cents', v_line_total;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'line_no', v_line_no, 'product_id', v_product.id, 'farmmatch_id', v_product.farmmatch_id,
      'name', v_product.name, 'sale_type', v_product.sale_type, 'unit', v_product.unit,
      'quantity', v_qty, 'price', v_price, 'total', v_line_total, 'taxable', v_product.taxable);

    v_subtotal := v_subtotal + v_line_total;
    if v_product.taxable then
      v_taxable := v_taxable + v_line_total;
    end if;
  end loop;

  select tax_rate into v_tax_rate from public.settings;
  v_tax := round(v_taxable * v_tax_rate);
  if (p_sale->>'tax_cents')::integer is distinct from v_tax then
    raise exception 'Tax mismatch: sent %, expected %', p_sale->>'tax_cents', v_tax;
  end if;
  v_total := v_subtotal + v_tax;
  if (p_sale->>'total_cents')::integer is distinct from v_total then
    raise exception 'Total mismatch: sent %, expected %', p_sale->>'total_cents', v_total;
  end if;

  if v_tender = 'cash' then
    v_cash := (p_sale->>'cash_tendered_cents')::integer;
    if v_cash is null or v_cash < v_total then
      raise exception 'Cash tendered must be at least the total';
    end if;
  end if;

  -- Pass 2: write.
  insert into public.sales (id, receipt_number, device_id, cashier_name, member_id, pending_customer_id,
                            sold_at, subtotal_cents, tax_cents, total_cents, tender,
                            cash_tendered_cents, change_cents, check_number)
  values (v_id, p_sale->>'receipt_number', p_sale->>'device_id', p_sale->>'cashier_name',
          (p_sale->>'member_id')::uuid, (p_sale->>'pending_customer_id')::uuid,
          coalesce((p_sale->>'sold_at')::timestamptz, now()),
          v_subtotal, v_tax, v_total, v_tender,
          v_cash, case when v_tender = 'cash' then v_cash - v_total end,
          nullif(p_sale->>'check_number', ''));

  insert into public.sale_lines (sale_id, line_no, product_id, farmmatch_product_id, product_name,
                                 sale_type, unit, quantity, unit_price_cents, line_total_cents, taxable)
  select v_id, (l->>'line_no')::integer, (l->>'product_id')::uuid, l->>'farmmatch_id', l->>'name',
         l->>'sale_type', l->>'unit', (l->>'quantity')::numeric, (l->>'price')::integer,
         (l->>'total')::integer, (l->>'taxable')::boolean
  from jsonb_array_elements(v_lines) l;

  return jsonb_build_object('sale_id', v_id, 'receipt_number', p_sale->>'receipt_number', 'duplicate', false);
end $$;

-- Register: void a sale. Already-posted sales get flagged for the agent to reverse.
create function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.sales
     set status = 'voided',
         voided_at = now(),
         void_reason = p_reason,
         posting_status = case posting_status
                            when 'posted' then 'needs_reversal'
                            when 'unposted' then 'not_needed'
                            when 'failed' then 'not_needed'
                            else posting_status end
   where id = p_sale_id and status = 'completed';
  if not found then
    raise exception 'Sale % not found or already voided', p_sale_id;
  end if;
end $$;

-- Register: add an in-store signup
create function public.add_pending_customer(p_first_name text, p_last_name text, p_phone text, p_email text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into public.pending_customers (first_name, last_name, phone, email)
  values (p_first_name, p_last_name, nullif(p_phone, ''), nullif(p_email, ''))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Security
--   anon:           nothing
--   authenticated:  the register iPad (one store login). Read catalog/members,
--                   write only through record_sale / void_sale / add_pending_customer.
--   service_role:   the Farmmatch agent (bypasses RLS).
-- ---------------------------------------------------------------------------
alter table public.settings          enable row level security;
alter table public.products          enable row level security;
alter table public.members           enable row level security;
alter table public.pending_customers enable row level security;
alter table public.sales             enable row level security;
alter table public.sale_lines        enable row level security;
alter table public.sync_runs         enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;

revoke all on all tables in schema public from authenticated;
grant select on public.settings, public.products, public.members, public.member_lookup,
                public.pending_customers, public.sales, public.sale_lines, public.sync_runs
  to authenticated;

create policy register_read on public.settings          for select to authenticated using (true);
create policy register_read on public.products          for select to authenticated using (true);
create policy register_read on public.members           for select to authenticated using (true);
create policy register_read on public.pending_customers for select to authenticated using (true);
create policy register_read on public.sales             for select to authenticated using (true);
create policy register_read on public.sale_lines        for select to authenticated using (true);
create policy register_read on public.sync_runs         for select to authenticated using (true);

revoke all on function public.sync_products(jsonb, boolean)        from authenticated;
revoke all on function public.sync_members(jsonb, boolean)         from authenticated;
revoke all on function public.link_pending_customer(uuid, text)    from authenticated;
revoke all on function public.mark_sale_posted(uuid, text)         from authenticated;
revoke all on function public.mark_sale_failed(uuid, text)         from authenticated;
revoke all on function public.touch_updated_at()                   from authenticated;
grant execute on function public.sync_products(jsonb, boolean)     to service_role;
grant execute on function public.sync_members(jsonb, boolean)      to service_role;
grant execute on function public.link_pending_customer(uuid, text) to service_role;
grant execute on function public.mark_sale_posted(uuid, text)      to service_role;
grant execute on function public.mark_sale_failed(uuid, text)      to service_role;

grant execute on function public.record_sale(jsonb)                          to authenticated;
grant execute on function public.void_sale(uuid, text)                       to authenticated;
grant execute on function public.add_pending_customer(text, text, text, text) to authenticated;

revoke all on public.agent_sales_to_post from authenticated;
grant select on public.agent_sales_to_post to service_role;
