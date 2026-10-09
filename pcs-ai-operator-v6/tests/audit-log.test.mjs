import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(){const nodes={},calls=[],window={openSheet:(title,html)=>{for(const x of html.matchAll(/id="([^"]+)"/g))nodes[x[1]]={textContent:'',innerHTML:'',disabled:false}},call:url=>new Promise((resolve,reject)=>calls.push({url,resolve,reject}))};vm.runInNewContext(readFileSync(new URL('../audit-log.js',import.meta.url),'utf8'),{window,document:{getElementById:id=>nodes[id]},URLSearchParams,Date});return{nodes,calls,window};}
const tick=()=>new Promise(r=>setImmediate(r));
test('audit escapes records, paginates, and never mutates data',async()=>{const h=fixture(),p=h.window.pcsAudit.open();assert.equal(h.calls[0].url,'/audit?source=crm&page=0');h.calls[0].resolve({source:'crm',page:0,rows:[{action:'<script>',actor:'<img>',entity_id:'<id>',changed_fields:['<field>']}],truncated:true});await p;assert.doesNotMatch(h.nodes.pcsAuditList.innerHTML,/<script>|<img>|<field>/);assert.equal(h.nodes.pcsAuditNext.disabled,false);h.nodes.pcsAuditNext.onclick();assert.equal(h.calls[1].url,'/audit?source=crm&page=1');});
test('audit source switch and reopened sheets ignore previous responses; failures stay visible',async()=>{const h=fixture();h.window.pcsAudit.open();h.nodes.pcsAuditSource.onchange({target:{value:'business'}});h.calls[1].resolve({source:'business',page:0,rows:[{action:'business row'}]});await tick();h.calls[0].resolve({source:'crm',page:0,rows:[{action:'old'}]});await tick();assert.match(h.nodes.pcsAuditList.innerHTML,/business row/);const p=h.window.pcsAudit.open();h.calls[2].reject(Error('Unavailable'));await p;assert.equal(h.nodes.pcsAuditList.textContent,'Unavailable');});
test('journal is reachable from the current v26 More menu without removing existing actions',()=>{
 const children=[],grid={appendChild:b=>children.push(b)},window={moreMenu:()=>children.push({textContent:'Existing action'})},document={querySelector:s=>s.includes('.v26-more')?grid:null,createElement:()=>({})};
 vm.runInNewContext(readFileSync(new URL('../audit-log.js',import.meta.url),'utf8'),{window,document,URLSearchParams,Date});window.moreMenu();assert.deepEqual(children.map(x=>x.textContent),['Existing action','Журнал действий']);assert.equal(typeof children[1].onclick,'function');
});
test('long field lists stay compact, use readable labels, and escape expanded values',async()=>{
 const h=fixture(),p=h.window.pcsAudit.open();h.calls[0].resolve({source:'crm',page:0,rows:[{action:'applications.insert',changed_fields:['id','city','item_id','category','public_id','reserved_vehicle_id','<img>']}]});await p;
 const html=h.nodes.pcsAuditList.innerHTML;assert.match(html,/Все изменённые поля \(7\)/);assert.match(html,/<details><summary/);assert.match(html,/Зарезервированный автомобиль/);assert.doesNotMatch(html,/<img>|reserved_vehicle_id/);assert.ok(html.indexOf('Зарезервированный автомобиль')>html.indexOf('<details>'));
});

test('recent booking, gallery, prospect and communication events render readable operator history',async()=>{
 const records=[
 {action:'booking_updated',actor:'ADMIN',entity_type:'applications',changed_fields:['item_id','start_date','end_date','operational_status']},
 {action:'booking_status_updated',actor:'ADMIN',entity_type:'applications',changed_fields:['operational_status']},
 {action:'booking_create',actor:'ADMIN',entity_type:'applications',result:'SUCCESS',changed_fields:['request_id','public_id','item_id','start_date','end_date','operational_status']},
 {action:'catalog_media_add',actor:'ADMIN',entity_type:'catalog_items',changed_fields:['photo_id','upload_fingerprint']},
 {action:'catalog_media_delete',actor:'ADMIN',changed_fields:['deleted_photo_ids']},
 {action:'catalog_media_order',actor:'ADMIN',changed_fields:['photo_order']},
 {action:'prospect_source_updated',actor:'admin',entity_type:'prospect_source',changed_fields:['enabled','topic','rules']},
 {action:'prospect_request_rejected',actor:'admin',entity_type:'prospect_request'},
 {action:'prospect_request_restored',actor:'admin',entity_type:'prospect_request'},
 {action:'crm_message_sent',actor:'admin',entity_type:'message'},
 {action:'crm_delivery_confirmed_by_operator',actor:'pcs-manager-admin',entity_type:'message',changed_fields:['method','note']},
 {action:'ai_answer_sent',actor:'admin',entity_type:'ai_generation'},
 {action:'ai_answer_rejected',actor:'admin',entity_type:'ai_generation'}
 ];
 const h=fixture(),p=h.window.pcsAudit.open();h.calls[0].resolve({source:'crm',page:0,rows:records});await p;
 const html=h.nodes.pcsAuditList.innerHTML;
 for(const label of ['Бронь создана','Условия брони изменены','Статус брони изменён','Начало аренды','Окончание аренды','Фото добавлено','Фото удалены','Порядок фото изменён','Настройки источника Telegram изменены','Запрос Telegram отклонён','Запрос Telegram возвращён на проверку','Сообщение отправлено','Доставка подтверждена оператором','Согласованный ответ отправлен','Ответ ИИ отклонён','Способ подтверждения'])assert.ok(html.includes(label),label);
 for(const r of records){assert.ok(!html.includes(r.action),r.action);for(const field of r.changed_fields||[])assert.ok(!html.includes(field),field);}
 assert.doesNotMatch(html,/pcs-manager-admin|· admin|ai_generation|prospect_request/);
 assert.equal(h.calls.length,1);
});
test('unknown journal event names remain visible and safely escaped',async()=>{
 const h=fixture(),p=h.window.pcsAudit.open();h.calls[0].resolve({source:'crm',page:0,rows:[{action:'new_event_<script>',actor:'external_<img>',entity_type:'unknown_<svg>',changed_fields:['future_<iframe>']}]});await p;
 const html=h.nodes.pcsAuditList.innerHTML;assert.match(html,/new_event_&lt;script&gt;/);assert.match(html,/future_&lt;iframe&gt;/);assert.doesNotMatch(html,/<script>|<img>|<svg>|<iframe>/);
});

test('booking history renders bounded escaped before/after values only for booking events',async()=>{
 const h=fixture(),p=h.window.pcsAudit.open();h.calls[0].resolve({source:'crm',page:0,rows:[{action:'booking_updated',entity_type:'applications',booking_change:{before:{operational_status:'NEW',start_date:'2026-10-10',item_id:'<script>',client_contact:'secret'},after:{operational_status:'CONFIRMED',start_date:'2026-10-11',item_id:'new',client_contact:'other secret'}}},{action:'other',entity_type:'applications',booking_change:{before:{start_date:'hidden'},after:{start_date:'also hidden'}}}]});await p;
 const html=h.nodes.pcsAuditList.innerHTML;assert.match(html,/Изменения брони: до и после/);assert.match(html,/Новая/);assert.match(html,/Подтверждена/);assert.match(html,/2026-10-10/);assert.match(html,/2026-10-11/);assert.doesNotMatch(html,/<script>|secret|hidden|client_contact/);
});
