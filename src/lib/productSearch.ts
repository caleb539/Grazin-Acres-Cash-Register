import type { Product } from './types';

// ---------------------------------------------------------------------------
// Departments: FarmMatch has ~65 small categories; the register groups them
// into a few big buttons. Matching is by keyword so new FarmMatch categories
// land in a sensible place without code changes.
// ---------------------------------------------------------------------------

export interface Department {
  id: string;
  label: string;
  icon: string;
}

export const DEPARTMENTS: Department[] = [
  { id: 'specials', label: 'Specials', icon: '⭐' },
  { id: 'dairy', label: 'Dairy', icon: '🥛' },
  { id: 'meat', label: 'Meat & Fish', icon: '🥩' },
  { id: 'eggs', label: 'Eggs', icon: '🥚' },
  { id: 'bakery', label: 'Bakery', icon: '🍞' },
  { id: 'pantry', label: 'Pantry', icon: '🥫' },
  { id: 'drinks', label: 'Drinks', icon: '🧃' },
  { id: 'household', label: 'Household', icon: '🧼' },
  { id: 'other', label: 'Other', icon: '📦' },
];

// First match wins, so order matters ("Ice Cream" is dairy, "Egg Supplier Products" is eggs).
const RULES: [string, RegExp][] = [
  ['specials', /special/],
  ['eggs', /\begg/],
  ['meat', /beef|pork|chicken|lamb|bison|turkey|geese|goose|salmon|\bcod\b|fish|meat|sausage|devon|lard|suet|bones?\b|stock/],
  ['dairy', /dairy|milk|cheese|butter|cream|yogurt|yoghurt|kefir|whey|ghee|colostrum|fraiche/],
  ['bakery', /bake|bakery|bread|muffin|pastr/],
  ['drinks', /kombucha|juice|coffee|tea\b|drink/],
  ['household', /soap|body|clean|laundry|candle|book|jar|animal|straw|mulch|garden/],
  ['pantry', /pantry|baking|sweet|syrup|salt|oil|vinegar|condiment|grain|granola|oat|rice|seed|fruit|snack|ferment|spice|flour|honey/],
];

export function departmentOf(category: string | null): string {
  const c = normalize(category ?? '');
  for (const [id, re] of RULES) if (re.test(c)) return id;
  return 'other';
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Lowercase, no accents, punctuation as spaces. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Very small plural/singular tolerance: "eggs" ~ "egg", "berries" ~ "berry". */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('es') && /(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/**
 * 0 = no match. Every typed word must appear (in any order) in the product name
 * or category; matches at the start of a word, and in the name, rank higher.
 */
export function matchScore(product: Product, query: string): number {
  const words = normalize(query).split(' ').filter(Boolean).map(stem);
  if (!words.length) return 0;
  const name = normalize(product.name);
  const nameWords = name.split(' ').map(stem);
  const catWords = normalize(product.category ?? '').split(' ').map(stem);

  let score = 0;
  for (const w of words) {
    if (nameWords.some((x) => x === w)) score += 30;
    else if (nameWords.some((x) => x.startsWith(w))) score += 20;
    else if (name.includes(w)) score += 8;
    else if (catWords.some((x) => x.startsWith(w))) score += 5;
    else return 0;
  }
  if (name.startsWith(normalize(query))) score += 25;
  return score - name.length / 100; // shorter names win ties ("Eggs (1 doz)" before "Duck Eggs …")
}

export function searchProducts(products: Product[], query: string): Product[] {
  return products
    .map((p) => ({ p, s: matchScore(p, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
    .map((x) => x.p);
}
