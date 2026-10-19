// Sample data for demo mode (no Supabase configured / "Try demo" on login).
// Not real Grazin' Acres prices.
import type { Member, Product, Settings } from './types';

const p = (
  n: number, name: string, category: string, price_cents: number,
  sale_type: Product['sale_type'] = 'each', unit = sale_type === 'weight' ? 'lb' : 'ea',
): Product => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  farmmatch_id: `DEMO-${n}`, name, category, sale_type, unit, price_cents, taxable: false, sort_order: n,
});

export const demoProducts: Product[] = [
  p(1, 'Whole Milk – Gallon', 'Dairy', 850),
  p(2, 'Whole Milk – Half Gal', 'Dairy', 475),
  p(3, 'Cream – Pint', 'Dairy', 600),
  p(4, 'Butter – 1 lb', 'Dairy', 1000),
  p(5, 'Yogurt – Quart', 'Dairy', 700),
  p(6, 'Kefir – Quart', 'Dairy', 750),
  p(7, 'Cheddar Cheese', 'Dairy', 1200, 'weight'),
  p(10, 'Eggs – Dozen', 'Eggs', 600),
  p(11, 'Duck Eggs – Half Dozen', 'Eggs', 700),
  p(20, 'Ground Beef', 'Meat', 999, 'weight'),
  p(21, 'Ribeye Steak', 'Meat', 2499, 'weight'),
  p(22, 'Beef Roast', 'Meat', 1150, 'weight'),
  p(23, 'Pork Chops', 'Meat', 899, 'weight'),
  p(24, 'Bacon', 'Meat', 1099, 'weight'),
  p(25, 'Whole Chicken (4 lbs)', 'Meat', 525, 'weight'),
  p(26, 'Bone Broth – Quart', 'Meat', 1200),
  p(30, 'Honey – 1 lb Jar', 'Pantry', 1100),
  p(31, 'Maple Syrup – Pint', 'Pantry', 1400),
  p(32, 'Sourdough Loaf', 'Pantry', 800),
  p(33, 'Large Bag Popcorn (4 lbs)', 'Pantry', 235, 'weight'),
];

const m = (
  n: number, first: string, last: string, phone: string, renewal: string | null,
  status: Member['membership_status'], card = true,
): Member => ({
  id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
  farmmatch_id: `DEMO-C${n}`, first_name: first, last_name: last, full_name: `${first} ${last}`,
  email: `${first.toLowerCase()}@example.com`, phone, phone_digits: phone.replace(/\D/g, ''),
  membership_type: renewal ? 'Annual' : null, renewal_date: renewal, has_card_on_file: card,
  membership_status: status,
});

export const demoMembers: Member[] = [
  m(1, 'Sarah', 'Miller', '(608) 555-0101', '2027-04-12', 'active'),
  m(2, 'John', 'Yoder', '(608) 555-0144', '2026-10-15', 'expiring_soon'),
  m(3, 'Emily', 'Hanson', '(608) 555-0177', '2026-08-01', 'expired'),
  m(4, 'David', 'Schmitt', '(608) 555-0190', '2027-01-30', 'active', false),
  m(5, 'Grace', 'Olson', '(608) 555-0122', null, 'none'),
];

export const demoSettings: Settings = {
  store_name: "Grazin' Acres",
  tax_rate: 0,
  expiring_soon_days: 14,
  receipt_footer: 'Thank you!',
  jar_credit_cents: 100,
  membership_fee_cents: 3000,
};
