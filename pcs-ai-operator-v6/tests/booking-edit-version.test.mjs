import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../ops.js',import.meta.url),'utf8');
function ui(){
 const fields={brEditSave:{disabled:false,dataset:{version:'2026-10-09 00:00:00.123456+00'}},brEditItem:{value:'car'},brEditClient:{value:'client'},brEditStart:{value:'2026-10-10'},brEditEnd:{value:'2026-10-20'},brEditTotal:{value:'100'},brEditDeposit:{value:'10'},brEditCurrency:{value:'THB'},brEditNotes:{value:'Keep my draft'}};
 const calls=[],ctx={window:{},document:{querySelector:x=>fields[x.slice(1)]},toast:()=>{},closeSheet:()=>{ctx.closed=true},bookingsPage:async()=>{},OPS:{reservations:[{id:'booking',edit_version:'original-list-version'}]},opsCall:async(path,init)=>{calls.push(JSON.parse(init.body));throw Error('changed')}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('window.saveReservationEdit='),source.indexOf('async function ensureCatalog(')),ctx);return {fields,calls,ctx};
}
test('conflicted edit keeps the original form version and entered values for retries',async()=>{
 const f=ui();await f.ctx.window.saveReservationEdit('booking');
 assert.equal(f.calls[0].expected_version,f.fields.brEditSave.dataset.version);assert.equal(f.fields.brEditNotes.value,'Keep my draft');assert.equal(f.fields.brEditSave.disabled,false);assert.equal(f.ctx.closed,undefined);
 await f.ctx.window.saveReservationEdit('booking');assert.deepEqual(f.calls[0],f.calls[1]);
});
test('status controls send the version displayed in the booking list',async()=>{
 const f=ui();await f.ctx.window.setReservationStatus('booking','confirmed');assert.equal(f.calls[0].expected_version,'original-list-version');
});
test('a late booking response cannot close a different form and double clicks do not dispatch twice',async()=>{
 const f=ui();let resolve;f.ctx.opsCall=()=>new Promise(r=>{resolve=r});
 const pending=f.ctx.window.saveReservationEdit('booking');assert.equal(f.fields.brEditSave.disabled,true);
 await f.ctx.window.saveReservationEdit('booking');
 f.fields.brEditSave={disabled:false,dataset:{version:'other'}};resolve({ok:true});await pending;assert.equal(f.ctx.closed,undefined);
});
