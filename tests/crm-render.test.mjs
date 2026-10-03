import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../pcs-ai-operator-v6/app.js',import.meta.url),'utf8');
function render(data){
 const el={innerHTML:''};
 const context={$:()=>el,esc:s=>String(s??''),group:()=>'',fmtDateTime:s=>s};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function renderClient('),source.indexOf('function fmtDateTime(')),context);
 context.renderClient(data);return el.innerHTML;
}
test('Neon uppercase and legacy lowercase outbound messages render as outgoing',()=>{
 for(const direction of ['OUT','out'])assert.match(render({contact:{},messages:[{direction,text:'sent'}]}),/class="bubble out"/);
 assert.doesNotMatch(render({contact:{},messages:[{direction:'IN',text:'received'}]}),/class="bubble out"/);
});
test('missing task data is not represented as a verified empty task list',()=>{
 assert.match(render({contact:{}}),/Задачи пока не загружены/);
 assert.match(render({contact:{},tasks:[]}),/Нет задач/);
 assert.match(render({contact:{},tasks:[{title:'Call customer',completed_at:'2026-10-03'}]}),/Call customer/);
});
