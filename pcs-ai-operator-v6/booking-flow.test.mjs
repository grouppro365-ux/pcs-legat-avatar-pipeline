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
assert.match(ops,/Показываются только доступные автомобили с посуточным тарифом/,'booking form must exclude unconfirmed and non-rental catalog positions');
assert.match(ops,/refreshReservationPricing/,'booking total must be calculated from the daily rate and dates');
assert.match(ops,/rate\*reservationDays\(\)/,'automatic booking total must use the number of rental days');
assert.match(adapter,/path==='\/reservations'&&method==='POST'/,'stable adapter must allow creating bookings');
assert.match(adapter,/manager\('application-save'/,'booking must persist through the stable manager');
assert.match(adapter,/directBookable\(item\)/,'server adapter must refuse non-available catalog items');
assert.match(adapter,/directRental\(item\)/,'server adapter must refuse non-rental catalog items');
assert.match(adapter,/datesOverlap\(/,'server adapter must guard against an active overlapping booking');
assert.match(adapter,/AWAITING_PARTNER_CONFIRMATION/,'hold status must use the server booking lifecycle');
assert.match(adapter,/application-status/,'booking status controls must persist through the stable manager');
assert.match(ops,/e<=s/,'return date must be later than rental start date');
assert.match(interactions,/\.pcs-ap-service:not\(\[data-extra-id\]\)/,'legacy service redraw must be replaced');

console.log('booking flow checks passed');
