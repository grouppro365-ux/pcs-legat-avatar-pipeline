import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const id='11111111-1111-4111-8111-111111111111';
function fixture(){const nodes={},calls=[],window={openSheet:(title,html)=>{for(const x of html.matchAll(/id="([^"]+)"/g))nodes[x[1]]={innerHTML:'',textContent:'',disabled:false}},call:url=>new Promise((resolve,reject)=>calls.push({url,resolve,reject}))};vm.runInNewContext(readFileSync(new URL('../application-offers.js',import.meta.url),'utf8'),{window,document:{getElementById:id=>nodes[id]},URLSearchParams,Date});return {nodes,calls,window};}
const tick=()=>new Promise(r=>setImmediate(r));
test('partner offers escape terms and comments, show selection and expiry independently',async()=>{
 const h=fixture(),p=h.window.pcsApplicationOffers.open(id);h.calls[0].resolve({application:{id,public_id:'APP-QA'},source:'partner',page:0,rows:[{status:'APPROVED',selected_in_application:true,deadline_passed:true,partner_name:'Компания <img>',terms:'<script>',client_comment:'<img>',client_price_thb:'123456.123456',deposit_thb:'1000000.50',currency_code:'THB'}],truncated:true});await p;const html=h.nodes.pcsOfferRows.innerHTML;assert.doesNotMatch(html,/<script>|<img>|123 456\.123 456/);assert.match(html,/123 456\.123456 THB/);assert.match(html,/1 000 000\.50 THB/);assert.match(html,/Партнёр: Компания &lt;img&gt;/);assert.match(html,/Выбрано в заявке/);assert.match(html,/Срок действия прошёл/);assert.equal(h.nodes.pcsOfferNext.disabled,false);
});
test('quote versions preserve exact amounts and currencies without inferring paid status',async()=>{
 const h=fixture();h.window.pcsApplicationOffers.open(id);h.nodes.pcsOfferSource.onchange({target:{value:'quotes'}});h.calls[1].resolve({application:{id},source:'quotes',page:0,rows:[{version:3,client_total:'9007199254740993.01',deposit:'10.25',currency:'USD',payment_recipient:'PARTNER'}]});await tick();assert.match(h.nodes.pcsOfferRows.innerHTML,/9 007 199 254 740 993\.01 USD/);assert.match(h.nodes.pcsOfferRows.innerHTML,/10\.25 USD/);assert.match(h.nodes.pcsOfferRows.innerHTML,/партнёр/);assert.doesNotMatch(h.nodes.pcsOfferRows.innerHTML,/Оплачено|Оплата получена/);
 h.calls[0].resolve({application:{id},source:'partner',page:0,rows:[{item_title:'Old'}]});await tick();assert.doesNotMatch(h.nodes.pcsOfferRows.innerHTML,/Old/);
});
test('source errors and mismatched identities stay visible; reopening ignores old responses',async()=>{
 const h=fixture(),p=h.window.pcsApplicationOffers.open(id);h.calls[0].resolve({application:{id:'wrong'},source:'partner',page:0,rows:[]});await p;assert.equal(h.nodes.pcsOfferRows.textContent,'Некорректный ответ предложений');
 h.window.pcsApplicationOffers.open(id);const next=h.window.pcsApplicationOffers.open(id);h.calls[2].reject(Error('Unavailable'));await next;h.calls[1].resolve({application:{id},source:'partner',page:0,rows:[]});await tick();assert.equal(h.nodes.pcsOfferRows.textContent,'Unavailable');
});
