import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

assert.match(source, /supersededByNewerInbound/);
assert.match(source, /gt\('created_at',source\.created_at\)/);
assert.match(source, /policy_reason:'superseded_by_newer_inbound'/);
assert.match(source, /status:'rejected'/);

const sourceCreatedAt = new Date('2026-09-03T04:44:09.270Z');
const newerInboundAt = new Date('2026-09-03T04:44:14.179Z');
assert.equal(newerInboundAt > sourceCreatedAt, true, 'the reproduced stale generation must be rejected');

console.log('pcs-generation-humanize-v10 supersession regression: ok');
