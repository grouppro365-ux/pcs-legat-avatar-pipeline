import assert from 'node:assert/strict';
import fs from 'node:fs';

const ops=fs.readFileSync(new URL('./ops.js',import.meta.url),'utf8');
const adapter=fs.readFileSync(new URL('./neon-adapter.js',import.meta.url),'utf8');
const interactions=fs.readFileSync(new URL('./interactions-v32.js',import.meta.url),'utf8');

for(const id of ['brItem','brClient','brStart','brEnd','brTotal','brDeposit','brCurrency','brNotes','brPhoto']){
  assert.ok(ops.includes(`id="${id}"`),`booking form is missing ${id}`);
}
assert.match(ops,/type="date"/,'booking dates must use the native date picker');
assert.match(ops,/deposit>total&&total>0/,'deposit cannot exceed a known total');
assert.match(ops,/file\.size>8\*1024\*1024/,'booking images need a size limit');
assert.match(adapter,/path==='\/reservations'&&method==='POST'/,'stable adapter must allow creating bookings');
assert.match(adapter,/manager\('application-save'/,'booking must persist through the stable manager');
assert.match(interactions,/\.pcs-ap-service:not\(\[data-extra-id\]\)/,'legacy service redraw must be replaced');

console.log('booking flow checks passed');
