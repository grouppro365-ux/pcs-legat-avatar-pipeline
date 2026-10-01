import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { parseRentalRange } from '../../../supabase/functions/_shared/rental-period.mjs';

test('follow-up preserves explicit ISO rental dates instead of interpreting their fragments', () => {
  const source = readFileSync(new URL('../pcs-customer-followup-v1/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const months:');
  const end = source.indexOf('async function fx()', start);
  assert.ok(start >= 0 && end > start, 'the real date helper must be present');
  const helpers = stripTypeScriptTypes(source.slice(start, end));
  const dateRange = new Function('ymd','parseRentalRange',helpers+'; return dateRange;')(
    date => date.toISOString().slice(0,10), parseRentalRange);
  assert.deepEqual(dateRange('Паттайя, аренда 2026-11-10 — 2026-11-12'),
    {start:'2026-11-10',end:'2026-11-12'});
});
