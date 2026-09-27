import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('payment route consumers use the database PCS discriminator', () => {
  for (const path of ['admin.ts','booking-admin.ts']) {
    const source = readFileSync(new URL(path, import.meta.url),'utf8');
    assert.doesNotMatch(source, /eq\('route_type','pcs_payment'\)/);
    assert.doesNotMatch(source, /route_type:'pcs_payment'/);
  }
});
