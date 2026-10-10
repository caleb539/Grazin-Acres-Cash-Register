-- Hide items from the in-store register without touching FarmMatch data.
-- Rules (not a fixed list) so that new preorder listings that arrive in a
-- later sync are hidden automatically. The FarmMatch sync never touches this
-- table, so rules survive every sync.

create table public.register_hide_rules (
  id          uuid primary key default gen_random_uuid(),
  match_type  text not null check (match_type in ('category', 'name_regex', 'product')),
  value       text not null,   -- category name, case-insensitive regex, or farmmatch_id
  note        text,
  created_at  timestamptz not null default now(),
  unique (match_type, value)
);

-- Reject a broken regex up front instead of breaking the register's product list.
create function public._check_hide_rule() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.match_type = 'name_regex' then
    perform '' ~* new.value;
  end if;
  return new;
end $$;
create trigger register_hide_rules_check before insert or update on public.register_hide_rules
  for each row execute function public._check_hide_rule();

insert into public.register_hide_rules (match_type, value, note) values
  ('category',   'Wholes, Halves, & Quarters',        'Beef wholes/halves/quarters are preorders'),
  ('category',   'Pork Whole & Half',                 'Whole/half pigs are preorders'),
  ('name_regex', '\mpre-?order',                      'Anything labelled preorder'),
  ('name_regex', '\mavail(able\M|\.)',                'Anything with an availability date'),
  ('name_regex', '^\s*(whole|half|quarter)\s+(lamb|pig|hog)\M', 'Whole/half animal shares');

-- What the register shows: active products minus anything a rule hides.
create view public.register_products with (security_invoker = true) as
select p.id, p.farmmatch_id, p.name, p.category, p.sale_type, p.unit, p.price_cents, p.taxable, p.sort_order
from public.products p
where p.active
  and not exists (
    select 1 from public.register_hide_rules r
    where (r.match_type = 'category'   and r.value = p.category)
       or (r.match_type = 'product'    and r.value = p.farmmatch_id)
       or (r.match_type = 'name_regex' and p.name ~* r.value)
  );

alter table public.register_hide_rules enable row level security;
revoke all on public.register_hide_rules from anon, authenticated;
grant select on public.register_hide_rules to authenticated;
create policy register_read on public.register_hide_rules for select to authenticated using (true);

revoke all on public.register_products from anon;
grant select on public.register_products to authenticated;

revoke all on function public._check_hide_rule() from public, anon, authenticated;
