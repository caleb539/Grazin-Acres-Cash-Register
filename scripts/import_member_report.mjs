#!/usr/bin/env node
// Converts FarmMatch's "Report > Customer" text export (Name | Renewal Date)
// into the register's members JSON.
//
//   node scripts/import_member_report.mjs <report.txt> [<older members.json for phone/email>] > out.json
//
// The report has no FarmMatch customer IDs, so each row gets a temporary ID
// starting with "TEMP-": the email when one can be matched from the older
// JSON (stable across reports), otherwise last|first (+ #2, #3 for repeated
// names). A later export with real FarmMatch IDs replaces these records.

import { readFileSync } from 'node:fs';

const [reportPath, enrichPath] = process.argv.slice(2);
if (!reportPath) {
  console.error('Usage: import_member_report.mjs <report.txt> [<members.json>]');
  process.exit(2);
}

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const nameKey = (last, first) => `${norm(last)}|${norm(first)}`;

// 1. Parse "Last, First | MM/DD/YYYY" (or "blank") lines.
const rows = [];
for (const line of readFileSync(reportPath, 'utf8').split(/\r?\n/)) {
  if (line.trim() === '---') break; // the summary list of blanks follows
  const m = /^(.+?)\s*\|\s*(?:(\d{2})\/(\d{2})\/(\d{4})|blank)\s*$/i.exec(line);
  if (!m) continue;
  const name = m[1].trim();
  const renewal = m[4] ? `${m[4]}-${m[2]}-${m[3]}` : null;
  const comma = name.indexOf(',');
  const last = comma >= 0 ? name.slice(0, comma).trim() : name;
  const first = comma >= 0 ? name.slice(comma + 1).trim() : '';
  rows.push({ last, first, renewal });
}

// 2. Optional phone/email from an older JSON export, matched by name
//    (and by renewal date when a name appears more than once).
const byName = new Map();
if (enrichPath) {
  for (const o of JSON.parse(readFileSync(enrichPath, 'utf8'))) {
    const k = nameKey(o.last_name, o.first_name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(o);
  }
}
function contactFor(r) {
  const cands = byName.get(nameKey(r.last, r.first)) ?? [];
  if (cands.length === 1) return cands[0];
  const sameDate = cands.filter((c) => (c.renewal_date ?? null) === r.renewal);
  return sameDate.length === 1 ? sameDate[0] : null;
}

// 3. Build members with unique temporary IDs.
const used = new Set();
const seenName = new Map();
let enriched = 0;
const members = rows.map((r) => {
  const c = contactFor(r);
  const email = c?.email?.trim() || null;
  const phone = c?.phone?.trim() || null;
  if (c) enriched++;
  let id = email ? `TEMP-${email.toLowerCase()}` : null;
  if (!id || used.has(id)) {
    const base = `TEMP-${norm(r.last)}|${norm(r.first)}`;
    const n = (seenName.get(base) ?? 0) + 1;
    seenName.set(base, n);
    id = n === 1 ? base : `${base}#${n}`;
    while (used.has(id)) id += '+';
  }
  used.add(id);
  return {
    farmmatch_id: id,
    first_name: r.first || null,
    last_name: r.last || null,
    email,
    phone,
    renewal_date: r.renewal,
  };
});

console.error(`rows: ${members.length}, with renewal date: ${members.filter((m) => m.renewal_date).length}, phone/email matched: ${enriched}`);
process.stdout.write(JSON.stringify(members, null, 2) + '\n');
