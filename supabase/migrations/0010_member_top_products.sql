-- What each customer usually buys at the register, for the "usuals" row shown
-- when the cashier picks them. Counts completed (not voided) sales only.
-- times_bought = number of separate orders that included the product.

create view public.member_top_products with (security_invoker = true) as
select
  s.member_id,
  l.product_id,
  count(distinct s.id)::integer as times_bought,
  sum(l.quantity) as total_qty,
  max(s.sold_at) as last_bought_at
from public.sale_lines l
join public.sales s on s.id = l.sale_id
where s.status = 'completed' and s.member_id is not null
group by s.member_id, l.product_id;

revoke all on public.member_top_products from anon;
grant select on public.member_top_products to authenticated;
