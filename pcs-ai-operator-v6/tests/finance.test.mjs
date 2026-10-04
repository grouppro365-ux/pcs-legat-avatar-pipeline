import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../finance-v26.js',import.meta.url),'utf8');
function fixture(){
 const pending=[],nodes={},sheets=[];let balanceBox=null;for(const key of ['[data-finance-list]','[data-finance-source]','[data-finance-status]','[data-finance-context]','[data-finance-filter]','[data-finance-refresh]'])nodes[key]={innerHTML:'',textContent:'',value:'all',listeners:{},addEventListener(k,fn){this.listeners[k]=fn},querySelectorAll(k){return this.buttons?.[k]||[]}};
 const root={querySelector:k=>nodes[k]},main={innerHTML:''},window={PCS:{page:'finance'},opsCall:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),toast(){},openSheet(title,html){sheets.push({title,html});balanceBox=html.includes('data-finance-balance')?{innerHTML:'',textContent:'Загружаю баланс брони…'}:null}};
 const document={querySelector:k=>k==='#main'?main:k==='#pcsFinanceScreen'?root:k==='[data-finance-balance]'?balanceBox:null};vm.runInNewContext(source,{window,document,URLSearchParams,Intl,Date});return{window,pending,nodes,main,sheets,get balanceBox(){return balanceBox}};
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

test('balance displays rental money, security money and foreign currency separately and escapes fields',()=>{
 const h=fixture(),html=h.window.pcsFinanceBalanceHtml({currency:'THB',total_amount:'1000.125',gross_paid:'600.125',net_paid:'500.125',refunded:'100',remaining:'500',overpayment:'0',security_deposit_paid:'3000',security_deposit_refunded:'0',payment_status:'partial',stored_payment_status:'partial',total_confirmed:true,other_currencies:[{entry_type:'income',currency:'<script>',amount:'25'}]});
 assert.match(html,/Частично оплачено/);assert.match(html,/500 THB/);assert.match(html,/Гарантийный депозит: получено/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/подтверждённый курс/);
});
test('unknown price and stored projection disagreement stay explicit; ledger filters match database',()=>{
 const h=fixture(),html=h.window.pcsFinanceBalanceHtml({currency:'THB',total_amount:null,total_confirmed:false,payment_status:'partial',stored_payment_status:'paid',other_currencies:[]});
 assert.match(html,/Стоимость не подтверждена/);assert.match(html,/нужна сверка/);
 const p=h.window.pcsFinance26();assert.match(h.main.innerHTML,/value="due"/);assert.doesNotMatch(h.main.innerHTML,/value="pending"|value="rejected"/);h.pending[0].resolve({source:'ledger',rows:[]});return p;
});

test('ledger detail loads a bound booking balance and ignores the previous detail response',async()=>{
 const h=fixture(),button={dataset:{financeRow:'0'},addEventListener(k,fn){this[k]=fn}};
 h.nodes['[data-finance-list]'].buttons={'[data-finance-row]':[button]};const render=h.window.pcsFinance26();
 const id='11111111-1111-4111-8111-111111111111';h.pending[0].resolve({source:'ledger',rows:[{id:'entry',reservation_id:id,entry_type:'income',amount:'10',currency:'THB'}]});await render;
 button.click();assert.equal(h.pending[1].url,'/finance/balance?reservation_id='+id);const oldBox=h.balanceBox;
 button.click();const currentBox=h.balanceBox;assert.notEqual(oldBox,currentBox);
 h.pending[1].resolve({reservation_id:id,payment_status:'paid',stored_payment_status:'paid',currency:'THB',net_paid:'999',other_currencies:[]});await new Promise(resolve=>setImmediate(resolve));assert.equal(oldBox.innerHTML,'');assert.equal(currentBox.innerHTML,'');
 h.pending[2].resolve({reservation_id:id,payment_status:'partial',stored_payment_status:'partial',currency:'THB',net_paid:'10',other_currencies:[]});await new Promise(resolve=>setImmediate(resolve));assert.match(currentBox.innerHTML,/Частично оплачено/);assert.doesNotMatch(currentBox.innerHTML,/999/);
});
test('balance failure stays explicit and a detail response after navigation cannot repaint',async()=>{
 const h=fixture(),button={dataset:{financeRow:'0'},addEventListener(k,fn){this[k]=fn}};
 h.nodes['[data-finance-list]'].buttons={'[data-finance-row]':[button]};const render=h.window.pcsFinance26();
 const id='11111111-1111-4111-8111-111111111111';h.pending[0].resolve({source:'ledger',rows:[{reservation_id:id}]});await render;
 button.click();h.pending[1].reject(Error('Balance unavailable'));await new Promise(resolve=>setImmediate(resolve));assert.equal(h.balanceBox.textContent,'Balance unavailable');
 button.click();const box=h.balanceBox;h.window.PCS.page='crm';h.pending[2].resolve({reservation_id:id,payment_status:'paid'});await new Promise(resolve=>setImmediate(resolve));assert.equal(box.innerHTML,'');
});
