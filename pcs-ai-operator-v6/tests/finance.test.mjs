import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../finance-v26.js',import.meta.url),'utf8');
function fixture(){
 const pending=[],nodes={};for(const key of ['[data-finance-list]','[data-finance-source]','[data-finance-status]','[data-finance-context]','[data-finance-filter]','[data-finance-refresh]'])nodes[key]={innerHTML:'',textContent:'',value:'all',listeners:{},addEventListener(k,fn){this.listeners[k]=fn},querySelectorAll(){return[]}};
 const root={querySelector:k=>nodes[k]},main={innerHTML:''},window={PCS:{page:'finance'},opsCall:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),toast(){},openSheet(){}};
 const document={querySelector:k=>k==='#main'?main:k==='#pcsFinanceScreen'?root:null};vm.runInNewContext(source,{window,document,URLSearchParams,Intl,Date});return{window,pending,nodes,main};
}
test('financial amounts preserve large and fractional decimals, currencies and missing data',()=>{
 const h=fixture(),cash=h.window.pcsFinanceFormat;assert.equal(cash('123456789012345678.125','THB'),'123\u00a0456\u00a0789\u00a0012\u00a0345\u00a0678,125 THB');assert.equal(cash('1.05','USD'),'1,05 USD');assert.equal(cash(null,'THB'),'Не указано');assert.equal(cash('bad','USD'),'Некорректная сумма');
});
test('finance reads ledger, escapes values and uses actual lookahead instead of invented global totals',async()=>{
 const h=fixture(),render=h.window.pcsFinance26();assert.match(h.pending[0].url,/source=ledger/);h.pending[0].resolve({source:'ledger',rows:[{counterparty:'<script>',entry_type:'income',amount:'100.25',currency:'USD',status:'pending',created_at:'2026-10-04T12:00:00Z'}],truncated:true});await render;
 const html=h.nodes['[data-finance-list]'].innerHTML;assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/100,25 USD/);assert.match(html,/Ожидает проверки/);assert.match(html,/Есть ещё записи/);assert.doesNotMatch(html,/Всего записей|finance-summary/);
});
test('finance errors remain visible and a late response cannot rewrite a different page',async()=>{
 const h=fixture(),render=h.window.pcsFinance26();h.window.PCS.page='crm';h.pending[0].resolve({source:'ledger',rows:[{counterparty:'Stale',amount:'10'}]});await render;assert.doesNotMatch(h.nodes['[data-finance-list]'].innerHTML,/Stale/);
 h.window.PCS.page='finance';const next=h.window.pcsFinance26();h.pending[1].reject(Error('Ledger unavailable'));await next;assert.equal(h.nodes['[data-finance-list]'].textContent,'Ledger unavailable');
});
