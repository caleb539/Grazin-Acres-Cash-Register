-- Record of changes applied directly to the database on 2026-11-13 (migrations
-- "product_price_tiers", "product_price_tiers_fix_grants",
-- "allow_product_price_tiers_sync_kind"), kept here so the repo matches the live
-- schema. Do not re-run against the live project; it already has these.
--
-- Quantity price breaks synced from FarmMatch: from min_qty up (in the product's
-- unit: count, or lb for weighed items), every unit costs unit_price_cents.
-- max_qty is informational; the register uses the highest tier the quantity reaches.

create table public.product_price_tiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  min_qty numeric not null check (min_qty > 0),
  max_qty numeric null check (max_qty is null or max_qty >= min_qty),
  unit_price_cents integer not null check (unit_price_cents > 0),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, min_qty)
);

alter table public.product_price_tiers enable row level security;

create policy register_read on public.product_price_tiers
  for select
  to authenticated
  using (true);

revoke all on public.product_price_tiers from anon;
revoke all on public.product_price_tiers from authenticated;
grant select on public.product_price_tiers to authenticated;

alter table public.sync_runs drop constraint sync_runs_kind_check;
alter table public.sync_runs add constraint sync_runs_kind_check
  check (kind = any (array['products'::text, 'members'::text, 'product_price_tiers'::text]));
