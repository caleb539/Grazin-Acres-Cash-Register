-- Jar returns: the cashier counts returned jars and each one takes
-- settings.jar_credit_cents (default $1) off the order. The credit never takes
-- the order below $0. Stored per sale so the weekly posting can apply the
-- same credit in FarmMatch.

alter table public.settings
  add column jar_credit_cents integer not null default 100 check (jar_credit_cents >= 0);

alter table public.sales
  add column jar_returns integer not null default 0 check (jar_returns >= 0),
  add column jar_credit_cents integer not null default 0 check (jar_credit_cents >= 0);

alter table public.sales drop constraint sales_total_math;
alter table public.sales add constraint sales_total_math
  check (total_cents = subtotal_cents + tax_cents - jar_credit_cents);
alter table public.sales add constraint sales_jar_credit_cap
  check (jar_credit_cents <= subtotal_cents + tax_cents);

create or replace function public.record_sale(p_sale jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := (p_sale->>'id')::uuid;
  v_existing text;
  v_tax_rate numeric;
  v_jar_rate integer;
  v_subtotal integer := 0;
  v_taxable integer := 0;
  v_tax integer;
  v_jars integer := coalesce((p_sale->>'jar_returns')::integer, 0);
  v_jar_credit integer;
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
  if v_jars < 0 then
    raise exception 'jar_returns cannot be negative';
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

  select tax_rate, jar_credit_cents into v_tax_rate, v_jar_rate from public.settings;
  v_tax := round(v_taxable * v_tax_rate);
  if (p_sale->>'tax_cents')::integer is distinct from v_tax then
    raise exception 'Tax mismatch: sent %, expected %', p_sale->>'tax_cents', v_tax;
  end if;

  v_jar_credit := least(v_jars * v_jar_rate, v_subtotal + v_tax);
  if coalesce((p_sale->>'jar_credit_cents')::integer, 0) is distinct from v_jar_credit then
    raise exception 'Jar credit mismatch: sent %, expected % (% jars at % cents, capped at the order total)',
      coalesce(p_sale->>'jar_credit_cents', '0'), v_jar_credit, v_jars, v_jar_rate;
  end if;

  v_total := v_subtotal + v_tax - v_jar_credit;
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
                            sold_at, subtotal_cents, tax_cents, jar_returns, jar_credit_cents, total_cents, tender,
                            cash_tendered_cents, change_cents, check_number)
  values (v_id, p_sale->>'receipt_number', p_sale->>'device_id', p_sale->>'cashier_name',
          (p_sale->>'member_id')::uuid, (p_sale->>'pending_customer_id')::uuid,
          coalesce((p_sale->>'sold_at')::timestamptz, now()),
          v_subtotal, v_tax, v_jars, v_jar_credit, v_total, v_tender,
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

-- Posting view: same columns as before, plus the jar return fields at the end.
create or replace view public.agent_sales_to_post with (security_invoker = true) as
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
  s.pending_customer_id,
  s.jar_returns,
  round(s.jar_credit_cents / 100.0, 2) as jar_credit
from public.sales s
left join public.members m on m.id = s.member_id
left join public.pending_customers pc on pc.id = s.pending_customer_id
where (s.status = 'completed' and s.posting_status in ('unposted', 'failed'))
   or s.posting_status = 'needs_reversal'
order by s.sold_at;

revoke all on public.agent_sales_to_post from anon, authenticated;
grant select on public.agent_sales_to_post to service_role;
revoke all on function public.record_sale(jsonb) from public, anon;
grant execute on function public.record_sale(jsonb) to authenticated;
