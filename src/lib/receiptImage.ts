import { formatCents, formatQty } from './money';
import type { LocalSale, Settings } from './types';

/**
 * The receipt drawn as a PNG, for iPads: the home-screen app ignores window.print(),
 * but the share sheet (navigator.share with a file) works there and offers Print.
 * Everything here is synchronous so it runs inside the cashier's tap.
 */

const WIDTH = 576; // 80 mm thermal paper at 203 dpi
const PAD = 24;
const FONT = 'ui-monospace, Menlo, Consolas, monospace';

const TENDER_LABEL = { cash: 'Cash', check: 'Check', card_on_file: 'Card on file (Farmmatch)' } as const;

let logo: HTMLImageElement | null = null;
/** Start loading the logo early so it can be drawn synchronously later. */
export function preloadReceiptLogo(): void {
  if (logo || typeof Image === 'undefined') return;
  logo = new Image();
  logo.src = '/logo.png';
}

type Row =
  | { kind: 'text'; text: string; size: number; bold?: boolean; align?: 'left' | 'center' }
  | { kind: 'pair'; left: string; right: string; size: number; bold?: boolean; indent?: number }
  | { kind: 'rule' }
  | { kind: 'logo' }
  | { kind: 'gap'; h: number };

function customerName(s: LocalSale): string {
  return s.customer.kind === 'member'
    ? s.customer.member.full_name
    : `${s.customer.pending.first_name} ${s.customer.pending.last_name}`;
}

function rowsFor(sale: LocalSale, settings: Settings): Row[] {
  const d = new Date(sale.sold_at);
  const rows: Row[] = [];
  if (logo?.complete && logo.naturalWidth) rows.push({ kind: 'logo' });
  rows.push(
    { kind: 'text', text: settings.store_name || "Grazin' Acres", size: 30, bold: true, align: 'center' },
    { kind: 'text', text: `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, size: 20, align: 'center' },
    { kind: 'text', text: `Receipt ${sale.receipt_number}`, size: 20, align: 'center' },
  );
  if (sale.cashier_name) rows.push({ kind: 'text', text: `Cashier: ${sale.cashier_name}`, size: 20, align: 'center' });
  rows.push({ kind: 'text', text: `Customer: ${customerName(sale)}`, size: 20, align: 'center' });
  if (sale.voided) rows.push({ kind: 'text', text: '*** VOIDED ***', size: 26, bold: true, align: 'center' });
  rows.push({ kind: 'rule' });

  for (const l of sale.lines) {
    rows.push({ kind: 'pair', left: l.name, right: formatCents(l.line_total_cents), size: 22, bold: true });
    const detail = l.sale_type === 'weight'
      ? `${formatQty(l.qtyMilli)} ${l.unit} @ ${formatCents(l.unit_price_cents)}/${l.unit}`
      : l.qtyMilli !== 1000 ? `${formatQty(l.qtyMilli)} × ${formatCents(l.unit_price_cents)}` : null;
    if (detail) rows.push({ kind: 'text', text: `  ${detail}`, size: 19 });
  }
  if ((sale.membership_fee_cents ?? 0) > 0) {
    rows.push({ kind: 'pair', left: 'Membership renewal', right: formatCents(sale.membership_fee_cents), size: 22, bold: true });
  }
  rows.push({ kind: 'rule' });

  const jarCredit = sale.jar_credit_cents ?? 0;
  if (sale.tax_cents > 0 || jarCredit > 0) {
    rows.push({ kind: 'pair', left: 'Subtotal', right: formatCents(sale.subtotal_cents + (sale.membership_fee_cents ?? 0)), size: 22 });
  }
  if (sale.tax_cents > 0) rows.push({ kind: 'pair', left: 'Tax', right: formatCents(sale.tax_cents), size: 22 });
  if (jarCredit > 0) {
    rows.push({ kind: 'pair', left: `Jar credit (${sale.jar_returns} ${sale.jar_returns === 1 ? 'jar' : 'jars'})`, right: `−${formatCents(jarCredit)}`, size: 22 });
  }
  rows.push({ kind: 'pair', left: 'Total', right: formatCents(sale.total_cents), size: 28, bold: true }, { kind: 'rule' });

  rows.push({
    kind: 'pair', left: `Paid (${TENDER_LABEL[sale.tender]})`, size: 22,
    right: formatCents(sale.tender === 'cash' ? (sale.cash_tendered_cents ?? sale.total_cents) : sale.total_cents),
  });
  if (sale.tender === 'cash') rows.push({ kind: 'pair', left: 'Change', right: formatCents(sale.change_cents ?? 0), size: 22 });
  if (sale.tender === 'check' && sale.check_number) rows.push({ kind: 'pair', left: 'Check #', right: sale.check_number, size: 22 });

  if (settings.receipt_footer) {
    rows.push({ kind: 'rule' });
    for (const line of settings.receipt_footer.split('\n')) rows.push({ kind: 'text', text: line, size: 19, align: 'center' });
  }
  rows.push({ kind: 'gap', h: 24 });
  return rows;
}

/** Split text into lines that fit maxWidth. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
    else { out.push(cur); cur = word; }
  }
  out.push(cur);
  return out;
}

function draw(ctx: CanvasRenderingContext2D | null, rows: Row[]): number {
  let y = PAD;
  const inner = WIDTH - PAD * 2;
  const font = (size: number, bold?: boolean) => `${bold ? '700' : '400'} ${size}px ${FONT}`;
  const measure = document.createElement('canvas').getContext('2d')!;
  const c = ctx ?? measure;
  for (const r of rows) {
    if (r.kind === 'gap') { y += r.h; continue; }
    if (r.kind === 'rule') {
      if (ctx) { ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.moveTo(PAD, y + 10); ctx.lineTo(WIDTH - PAD, y + 10); ctx.stroke(); }
      y += 20;
      continue;
    }
    if (r.kind === 'logo') {
      const w = 200;
      const h = Math.round((logo!.naturalHeight / logo!.naturalWidth) * w);
      if (ctx) ctx.drawImage(logo!, (WIDTH - w) / 2, y, w, h);
      y += h + 8;
      continue;
    }
    c.font = font(r.size, r.bold);
    const lh = Math.round(r.size * 1.35);
    if (r.kind === 'text') {
      for (const line of wrap(c, r.text, inner)) {
        if (ctx) { ctx.textAlign = r.align ?? 'left'; ctx.fillText(line, r.align === 'center' ? WIDTH / 2 : PAD, y + r.size); }
        y += lh;
      }
    } else {
      const rightW = c.measureText(r.right).width;
      const lines = wrap(c, r.left, inner - rightW - 16);
      lines.forEach((line, i) => {
        if (ctx) {
          ctx.textAlign = 'left'; ctx.fillText(line, PAD, y + r.size);
          if (i === 0) { ctx.textAlign = 'right'; ctx.fillText(r.right, WIDTH - PAD, y + r.size); }
        }
        y += lh;
      });
    }
    y += 4;
  }
  return y;
}

/** The receipt as a PNG file (synchronous). */
export function receiptPngFile(sale: LocalSale, settings: Settings): File {
  const rows = rowsFor(sale, settings);
  const height = draw(null, rows);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  draw(ctx, rows);

  const b64 = canvas.toDataURL('image/png').split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], `receipt-${sale.receipt_number}.png`, { type: 'image/png' });
}

/** iPad / iPhone (iPadOS reports itself as a Mac with touch). */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
