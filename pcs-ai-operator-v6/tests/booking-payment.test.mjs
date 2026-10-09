import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../ops.js',import.meta.url),'utf8');
test('booking cards show saved payment states separately from reservation lifecycle',()=>{
 const ctx={esc:x=>String(x??'').replaceAll('<','&lt;'),money:(n,c)=>n+' '+c,bookingStatus:()=> 'Подтверждено'};vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function bookingPaymentStatus('),source.indexOf('async function bookingsPage('))+source.slice(source.indexOf('function reservationCard('),source.indexOf('window.editReservation=')),ctx);
 for(const [status,label] of [['PARTIALLY_PAID','Частично оплачено'],['PAID_TO_PARTNER','Оплачено партнёру'],['REFUND_PENDING','Ожидается возврат'],['DISPUTED','Спор по оплате'],['UNKNOWN','Статус не указан'],['<script>','Статус не указан']]){
  const html=ctx.reservationCard({id:'11111111-1111-4111-8111-111111111111',status:'confirmed',payment_status:status,deposit_amount:999,start_date:'2026-10-10',end_date:'2026-10-20',pcs_catalog_items:{title:'Car'},total_amount:1000,currency:'THB'});assert.ok(html.includes('Оплата: '+label));assert.ok(html.includes("pcsAudit.open({applicationId:'11111111-1111-4111-8111-111111111111'})"));assert.ok(html.includes('Подтверждено'));assert.doesNotMatch(html,/<script>/);
 }
});
test('paid counter only includes saved payments to partner, regardless of draft advance amounts',async()=>{
 const box={innerHTML:''},ctx={OPS:{tab:'reservations'},document:{querySelector:()=>box},opsCall:async()=>[{payment_status:'PAID_TO_PARTNER'},{payment_status:'AWAITING_PAYMENT',deposit_amount:1000},{payment_status:'UNKNOWN',deposit_amount:2000},{payment_status:'PARTIALLY_PAID'}],reservationCard:()=>''};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function renderBookingTab('),source.indexOf('function reservationCard(')),ctx);await ctx.renderBookingTab();assert.match(box.innerHTML,/Оплачено партнёру<\/span><b>1<\/b>/);
});
