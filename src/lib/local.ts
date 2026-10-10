// On-device storage. IndexedDB (idb-keyval) for data; localStorage for small prefs.
import { createStore, get, set } from 'idb-keyval';
import type { LocalSale, Member, Product, Settings } from './types';

const store = createStore('ga-register', 'kv');

export interface Catalog {
  products: Product[];
  members: Member[];
  settings: Settings;
  refreshed_at: string;
}

export async function loadCatalog(): Promise<Catalog | undefined> {
  try { return await get<Catalog>('catalog', store); } catch { return undefined; }
}
export async function saveCatalog(c: Catalog): Promise<void> {
  await set('catalog', c, store);
}

const HISTORY_DAYS = 14;

// Demo-mode sales are kept apart so they never mix with real ones.
const salesKey = (demo: boolean) => (demo ? 'sales-demo' : 'sales');

export async function loadSales(demo: boolean): Promise<LocalSale[]> {
  try { return (await get<LocalSale[]>(salesKey(demo), store)) ?? []; } catch { return []; }
}

/** Saves the list, pruning uploaded sales older than HISTORY_DAYS. Unsent sales are never pruned. */
export async function saveSales(demo: boolean, sales: LocalSale[]): Promise<void> {
  const cutoff = Date.now() - HISTORY_DAYS * 86400_000;
  const kept = sales.filter(
    (s) => s.upload === 'queued' || s.upload === 'error' || Date.parse(s.sold_at) >= cutoff,
  );
  await set(salesKey(demo), kept, store);
}

// --- prefs -----------------------------------------------------------------

function pref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function setPref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
}

export function getCashier(): string {
  return pref('ga.cashier') ?? '';
}
export function setCashier(name: string): void {
  setPref('ga.cashier', name);
}

/** Short random code that identifies this iPad on receipts, e.g. "K7Q". */
export function getDeviceId(): string {
  let id = pref('ga.device');
  if (!id) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    id = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => chars[b % chars.length]).join('');
    setPref('ga.device', id);
  }
  return id;
}

/** Receipt numbers: DEVICE-YYMMDD-NNN, sequence resets daily. Unique per device. */
export function nextReceiptNumber(now = new Date()): string {
  const ymd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const key = `ga.seq.${ymd}`;
  const seq = (parseInt(pref(key) ?? '0', 10) || 0) + 1;
  setPref(key, String(seq));
  return `${getDeviceId()}-${ymd}-${String(seq).padStart(3, '0')}`;
}
