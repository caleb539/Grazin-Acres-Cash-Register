#!/usr/bin/env node
// register — command-line bridge between Farmmatch (via an agent) and the
// Grazin' Acres register database. The database key is read from Windows
// Credential Manager at runtime and is never printed, logged, or passed in
// arguments. Data contract: docs/AGENT_SPEC.md.
//
//   node tools/register.mjs <command> [args]

import { readFileSync } from 'node:fs';
import { deleteSecret, promptAndStoreSecret, readSecret } from './credentials.mjs';

const PROJECT_REF = 'fkjeeeicnxsnmaovsjtk';
const BASE = `https://${PROJECT_REF}.supabase.co`;
const CRED_TARGET = 'GrazinAcresRegister/supabase-service-role';

// A full sync may hide at most this share of currently-active rows (and at
// least SHRINK_MIN rows) before it refuses. Guards against a half-finished scrape.
const SHRINK_RATIO = 0.2;
const SHRINK_MIN = 5;

// ---------------------------------------------------------------------------
// Output helpers. Results go to stdout as JSON; problems go to stderr.
// ---------------------------------------------------------------------------

class CliError extends Error {}
const out = (value) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const fail = (msg) => { throw new CliError(msg); };

// ---------------------------------------------------------------------------
// Key (Windows Credential Manager, see credentials.mjs)
// ---------------------------------------------------------------------------

function readStoredKey() {
  if (process.platform !== 'win32') return null;
  try { return readSecret(CRED_TARGET); } catch (e) { fail(e.message); }
}

/** Returns a problem description, or null if the key looks right for this project. */
function describeKeyProblem(key) {
  if (key.startsWith('sb_publishable_')) return 'this is the PUBLISHABLE key; the agent needs the secret (sb_secret_...) or legacy service_role key';
  if (key.startsWith('sb_secret_')) return null;
  const parts = key.split('.');
  if (parts.length !== 3) return 'key is neither sb_secret_... nor a JWT (incomplete copy?)';
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return 'key looks like a JWT but cannot be decoded (incomplete copy?)'; }
  if (payload.ref !== PROJECT_REF) return `key belongs to project "${payload.ref}", not Grazin Acres Register (${PROJECT_REF})`;
  if (payload.role !== 'service_role') return `this is the "${payload.role}" key; the agent needs service_role`;
  return null;
}

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.SUPABASE_SECRET_KEY;
  const raw = fromEnv ?? readStoredKey();
  if (!raw) fail('No database key stored. The operator must run: node tools/register.mjs key set');
  const key = raw.trim();
  const problem = describeKeyProblem(key);
  if (problem) fail(`Database key is wrong: ${problem}. The operator must run: node tools/register.mjs key set`);
  cachedKey = key;
  return key;
}

// ---------------------------------------------------------------------------
// Supabase REST
// ---------------------------------------------------------------------------

async function request(method, path, { body, headers = {} } = {}) {
  const key = getKey();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    fail(`Network error reaching the database (offline?): ${e.cause?.code ?? e.message}`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.message ?? data?.msg ?? text;
    if (res.status === 401) fail(`Database rejected the key (401): ${msg}. The operator must run: node tools/register.mjs key set`);
    fail(`Database error ${res.status}: ${msg}${data?.details ? ` (${data.details})` : ''}`);
  }
  return { data, res };
}

const rpc = async (fn, args) => (await request('POST', `/rest/v1/rpc/${fn}`, { body: args })).data;

async function selectAll(table, query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await request('GET', `/rest/v1/${table}?${query}`, {
      headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    });
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function countRows(table, query) {
  const { res } = await request('HEAD', `/rest/v1/${table}?${query}`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
  const range = res.headers.get('content-range') ?? '';
  return Number(range.split('/')[1] ?? NaN);
}

// ---------------------------------------------------------------------------
// Input files + local validation (mirrors the database's own checks so the
// agent gets every problem at once, before anything is sent)
// ---------------------------------------------------------------------------

function loadJsonArray(file) {
  if (!file) fail('Missing file argument.');
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { fail(`Could not read ${file}: ${e.message}`); }
  const items = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(items)) fail(`${file} must contain a JSON array (or {"items": [...]}).`);
  return items;
}

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

function validate(items, kind) {
  const errors = [];
  const warnings = [];
  const seen = new Map();
  items.forEach((it, i) => {
    const where = `#${i} (${it?.name ?? [it?.first_name, it?.last_name].filter(Boolean).join(' ') ?? '?'})`;
    if (typeof it !== 'object' || it === null) { errors.push(`${where}: not an object`); return; }
    if (isBlank(it.farmmatch_id)) errors.push(`${where}: missing farmmatch_id`);
    else {
      const id = String(it.farmmatch_id);
      if (seen.has(id)) errors.push(`${where}: duplicate farmmatch_id "${id}" (also #${seen.get(id)})`);
      seen.set(id, i);
    }
    if (kind === 'products') {
      if (isBlank(it.name)) errors.push(`${where}: missing name`);
      if (!['each', 'weight'].includes(it.sale_type)) errors.push(`${where}: sale_type must be "each" or "weight"`);
      if (typeof it.price !== 'number' || !Number.isFinite(it.price) || it.price < 0) errors.push(`${where}: price must be a number >= 0 (dollars)`);
      else if (Math.round(it.price * 100) !== Math.round(it.price * 1e6) / 1e4) warnings.push(`${where}: price ${it.price} has more than 2 decimals; will be rounded to the cent`);
      if (it.taxable !== undefined && typeof it.taxable !== 'boolean') errors.push(`${where}: taxable must be true/false`);
    } else {
      if (isBlank(it.first_name) && isBlank(it.last_name)) errors.push(`${where}: needs first_name or last_name`);
      if (!isBlank(it.renewal_date) && !isDate(String(it.renewal_date))) errors.push(`${where}: renewal_date must be YYYY-MM-DD or null`);
      if (it.has_card_on_file !== undefined && typeof it.has_card_on_file !== 'boolean') errors.push(`${where}: has_card_on_file must be true/false`);
      if (isBlank(it.phone) && isBlank(it.email)) warnings.push(`${where}: no phone or email; cashier can only find them by name`);
    }
  });
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function sync(kind, args) {
  const file = args.find((a) => !a.startsWith('--'));
  const partial = args.includes('--partial');
  const dryRun = args.includes('--dry-run');
  const allowShrink = args.includes('--allow-shrink');
  const items = loadJsonArray(file);
  const { errors, warnings } = validate(items, kind);
  if (errors.length) {
    out({ ok: false, file, items: items.length, errors, warnings });
    process.exitCode = 1;
    return;
  }

  const table = kind === 'products' ? 'products' : 'members';
  const active = await selectAll(table, 'select=farmmatch_id,' + (kind === 'products' ? 'name' : 'first_name,last_name') + '&active=eq.true');
  const incoming = new Set(items.map((it) => String(it.farmmatch_id)));
  const wouldHide = partial ? [] : active.filter((r) => !incoming.has(r.farmmatch_id));
  const known = new Set(active.map((r) => r.farmmatch_id));
  const newCount = items.filter((it) => !known.has(String(it.farmmatch_id))).length;
  const limit = Math.max(SHRINK_MIN, Math.floor(active.length * SHRINK_RATIO));
  const label = (r) => r.name ?? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();

  const plan = {
    file,
    mode: partial ? 'partial (add/update only)' : 'full (missing rows get hidden)',
    items: items.length,
    currently_active: active.length,
    new: newCount,
    would_hide: wouldHide.length,
    would_hide_sample: wouldHide.slice(0, 15).map(label),
    warnings,
  };

  if (!partial && wouldHide.length > limit && !allowShrink) {
    out({ ok: false, ...plan, error: `Refusing: this full sync would hide ${wouldHide.length} of ${active.length} active ${kind} (limit ${limit}). If the Farmmatch list really shrank, the operator can re-run with --allow-shrink. Otherwise the scrape probably missed pages.` });
    process.exitCode = 1;
    return;
  }
  if (dryRun) { out({ ok: true, dry_run: true, ...plan }); return; }

  const result = await rpc(kind === 'products' ? 'sync_products' : 'sync_members', { p_items: items, p_full_sync: !partial, p_allow_shrink: allowShrink });
  out({ ok: true, ...plan, result });
}

async function salesToPost() {
  const rows = await selectAll('agent_sales_to_post', 'select=*');
  out({
    ready: rows.filter((r) => r.ready).length,
    blocked: rows.filter((r) => !r.ready).length,
    reversals: rows.filter((r) => r.action === 'reverse').length,
    card_on_file_total: Number(rows.filter((r) => r.ready && r.action === 'post' && r.tender === 'card_on_file')
      .reduce((n, r) => n + Number(r.total), 0).toFixed(2)),
    sales: rows,
  });
}

async function pendingSignups() {
  const rows = await selectAll('pending_customers', 'select=id,first_name,last_name,phone,email,created_at&matched_member_id=is.null&order=created_at');
  out({ count: rows.length, pending: rows });
}

async function status() {
  const [products, members, unposted, failed, reversals, runs] = await Promise.all([
    countRows('products', 'select=id&active=eq.true'),
    countRows('members', 'select=id&active=eq.true'),
    countRows('sales', 'select=id&status=eq.completed&posting_status=eq.unposted'),
    countRows('sales', 'select=id&posting_status=eq.failed'),
    countRows('sales', 'select=id&posting_status=eq.needs_reversal'),
    request('GET', '/rest/v1/sync_runs?select=kind,full_sync,started_at,received,inserted,updated,deactivated&order=started_at.desc&limit=6').then((r) => r.data),
  ]);
  out({ active_products: products, active_members: members, sales_unposted: unposted, sales_failed: failed, sales_needing_reversal: reversals, recent_syncs: runs });
}

async function check() {
  getKey();
  await request('GET', '/rest/v1/agent_sales_to_post?select=sale_id&limit=1');
  out({ ok: true, message: 'Key is valid for Grazin Acres Register and the database is reachable.' });
}

function keyCommand(sub) {
  if (process.platform !== 'win32') fail('Key storage uses Windows Credential Manager; run this on the Windows machine.');
  if (sub === 'set') {
    console.error('Paste the service_role (or sb_secret_...) key for Grazin Acres Register, then press Enter.');
    console.error('Input is hidden. Get it from: Supabase dashboard > Grazin Acres Register > Project Settings > API Keys.');
    if (!promptAndStoreSecret(CRED_TARGET, 'Key')) fail('Key was not stored.');
    return check();
  }
  if (sub === 'delete') {
    out({ ok: true, result: deleteSecret(CRED_TARGET) ? 'deleted' : 'none' });
    return;
  }
  if (sub === 'status') {
    const key = readStoredKey();
    if (!key) { out({ stored: false }); return; }
    const problem = describeKeyProblem(key.trim());
    out({ stored: true, valid_format: !problem, problem: problem ?? undefined, kind: key.startsWith('sb_secret_') ? 'sb_secret' : 'legacy service_role' });
    return;
  }
  fail('Usage: key set | key status | key delete');
}

const HELP = `register — Grazin' Acres register database tool

Agent commands:
  check                                Verify the key and connection
  status                               Counts, recent syncs, sales waiting
  sync-products <file.json> [--partial] [--dry-run] [--allow-shrink]
  sync-members  <file.json> [--partial] [--dry-run] [--allow-shrink]
  pending-signups                      In-store signups not yet linked
  link-pending <pending_id> <member_farmmatch_id>
  sales-to-post                        Sales to enter (or reverse) in Farmmatch
  mark-posted <sale_id> [farmmatch_order_ref]
  mark-failed <sale_id> <error message>

Operator only:
  key set | key status | key delete    Manage the key in Windows Credential Manager

--dry-run validates and shows what would change without writing anything.
--allow-shrink is for the operator, when Farmmatch's list really got shorter.`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'check': return check();
    case 'status': return status();
    case 'sync-products': return sync('products', args);
    case 'sync-members': return sync('members', args);
    case 'pending-signups': return pendingSignups();
    case 'link-pending':
      if (args.length !== 2) fail('Usage: link-pending <pending_id> <member_farmmatch_id>');
      return out(await rpc('link_pending_customer', { p_pending_customer_id: args[0], p_member_farmmatch_id: args[1] }));
    case 'sales-to-post': return salesToPost();
    case 'mark-posted':
      if (args.length < 1) fail('Usage: mark-posted <sale_id> [farmmatch_order_ref]');
      await rpc('mark_sale_posted', { p_sale_id: args[0], p_farmmatch_order_ref: args[1] ?? null });
      return out({ ok: true, sale_id: args[0], farmmatch_order_ref: args[1] ?? null });
    case 'mark-failed':
      if (args.length < 2) fail('Usage: mark-failed <sale_id> <error message>');
      await rpc('mark_sale_failed', { p_sale_id: args[0], p_error: args.slice(1).join(' ') });
      return out({ ok: true, sale_id: args[0] });
    case 'key': return keyCommand(args[0]);
    case undefined: case 'help': case '--help': case '-h':
      console.log(HELP); return;
    default: fail(`Unknown command "${cmd}". Run with --help.`);
  }
}

main().catch((e) => {
  console.error(e instanceof CliError ? `register: ${e.message}` : e);
  process.exitCode = 1;
});
