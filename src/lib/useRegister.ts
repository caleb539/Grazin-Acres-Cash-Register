// Register data: cached catalog, local sales list, and the upload queue.
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadCatalog, PermanentUploadError, uploadSale, voidSaleOnServer } from './backend';
import { demoMembers, demoProducts, demoSettings } from './demo';
import { type Catalog, loadCatalog, loadSales, saveCatalog, saveSales } from './local';
import type { LocalSale } from './types';

const CATALOG_REFRESH_MS = 30 * 60_000;
const UPLOAD_RETRY_MS = 60_000;

export interface RegisterData {
  catalog: Catalog | null;
  sales: LocalSale[];
  online: boolean;
  refreshing: boolean;
  refreshError: string | null;
  waitingCount: number;
  errorCount: number;
  refreshCatalog: () => Promise<void>;
  addSale: (sale: LocalSale) => void;
  voidSale: (sale: LocalSale, reason: string) => Promise<string | null>;
  retryErrors: () => void;
}

export function useRegister(demo: boolean): RegisterData {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [sales, setSalesState] = useState<LocalSale[]>([]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // The ref is the source of truth so async uploads never work from a stale list.
  const salesRef = useRef<LocalSale[]>([]);
  const flushing = useRef(false);

  const updateSales = useCallback((fn: (prev: LocalSale[]) => LocalSale[]) => {
    salesRef.current = fn(salesRef.current);
    setSalesState(salesRef.current);
    void saveSales(demo, salesRef.current);
  }, [demo]);

  const patchSale = useCallback((id: string, patch: Partial<LocalSale>) => {
    updateSales((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, [updateSales]);

  const flush = useCallback(async () => {
    if (demo || flushing.current || !navigator.onLine) return;
    flushing.current = true;
    try {
      for (;;) {
        const next = salesRef.current.find((s) => s.upload === 'queued' && !s.voided);
        if (!next) break;
        try {
          const done = await uploadSale(next);
          patchSale(next.id, { upload: 'uploaded', upload_error: undefined, pending_customer_id: done.pending_customer_id });
        } catch (e) {
          const carried = (e as { sale?: LocalSale }).sale;
          if (carried?.pending_customer_id) patchSale(next.id, { pending_customer_id: carried.pending_customer_id });
          if (e instanceof PermanentUploadError) {
            patchSale(next.id, { upload: 'error', upload_error: e.message });
            continue;
          }
          break; // network/auth problem: try again later
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [demo, patchSale]);

  const refreshCatalog = useCallback(async () => {
    if (demo) return;
    setRefreshing(true);
    try {
      const c = await downloadCatalog();
      setCatalog(c);
      setRefreshError(null);
      await saveCatalog(c);
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [demo]);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cached, stored] = await Promise.all([demo ? undefined : loadCatalog(), loadSales(demo)]);
      if (cancelled) return;
      salesRef.current = stored;
      setSalesState(stored);
      if (demo) {
        setCatalog({ products: demoProducts, members: demoMembers, settings: demoSettings, refreshed_at: new Date().toISOString() });
        return;
      }
      if (cached) setCatalog(cached);
      const stale = !cached || Date.now() - Date.parse(cached.refreshed_at) > CATALOG_REFRESH_MS;
      if (stale && navigator.onLine) await refreshCatalog();
      void flush();
    })();
    return () => { cancelled = true; };
  }, [demo, refreshCatalog, flush]);

  // Online/offline + periodic retry and catalog refresh.
  useEffect(() => {
    const up = () => { setOnline(true); void flush(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const retry = setInterval(() => void flush(), UPLOAD_RETRY_MS);
    const refresh = setInterval(() => navigator.onLine && void refreshCatalog(), CATALOG_REFRESH_MS);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      clearInterval(retry);
      clearInterval(refresh);
    };
  }, [flush, refreshCatalog]);

  const addSale = useCallback((sale: LocalSale) => {
    updateSales((prev) => [...prev, sale]);
    void flush();
  }, [updateSales, flush]);

  const voidSale = useCallback(async (sale: LocalSale, reason: string): Promise<string | null> => {
    const current = salesRef.current.find((s) => s.id === sale.id);
    if (!current) return 'Sale not found';
    if (current.upload === 'uploaded') {
      try {
        await voidSaleOnServer(current.id, reason);
      } catch (e) {
        return navigator.onLine
          ? `Could not void: ${e instanceof Error ? e.message : e}`
          : 'This sale is already saved online. Connect to the internet to void it.';
      }
      patchSale(current.id, { voided: true });
    } else if (flushing.current && current.upload === 'queued') {
      return 'This sale is uploading right now. Try again in a few seconds.';
    } else {
      patchSale(current.id, { voided: true, upload: current.upload === 'demo' ? 'demo' : 'not_sent' });
    }
    return null;
  }, [patchSale]);

  const retryErrors = useCallback(() => {
    updateSales((prev) => prev.map((s) => (s.upload === 'error' ? { ...s, upload: 'queued' } : s)));
    void flush();
  }, [updateSales, flush]);

  return {
    catalog,
    sales,
    online,
    refreshing,
    refreshError,
    waitingCount: sales.filter((s) => s.upload === 'queued' && !s.voided).length,
    errorCount: sales.filter((s) => s.upload === 'error' && !s.voided).length,
    refreshCatalog,
    addSale,
    voidSale,
    retryErrors,
  };
}
