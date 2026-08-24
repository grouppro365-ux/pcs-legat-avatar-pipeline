(()=>{
const V9='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-ui-api-v9';
async function v9(path,opt={}){
  const h={...(opt.headers||{})};
  const t=localStorage.pcsToken||'';if(t)h.authorization='Bearer '+t;
  const isForm=opt.body instanceof FormData;if(!isForm&&!h['content-type'])h['content-type']='application/json';
  const r=await fetch(V9+path,{...opt,headers:h});let d={};try{d=await r.json()}catch{}
  if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d;
}
window.pcsV9=v9;

const ACTION_LABEL={hot:'Приоритет HOT установлен',ready_to_pay:'Клиент готов к оплате',waiting:'Переведено в ожидание клиента',lost:'Сделка отмечена потерянной'};
const oldClientAction=window.clientAction;
window.clientAction=async function(id,action){
  if(action==='paid')return window.openPaymentForm(id);
  try{await v9(`/crm/${id}/action`,{method:'POST',body:JSON.stringify({action})});PCS.crm=await window.call('/crm');toast(ACTION_LABEL[action]||'Статус обновлён');window.openClient(id,false)}catch(e){toast(e.message)}
};

function paymentKindRu(v){return({prepayment:'Предоплата',full:'Полная оплата',deposit:'Депозит',refund:'Возврат',other:'Прочий платёж'})[v]||v||'Платёж'}
function entryTypeRu(v){return({income:'Доход',expense:'Расход',deposit:'Депозит',refund:'Возврат',partner_payout:'Выплата партнёру'})[v]||v||'Операция'}
function financeStatusRu(v){return({paid:'Оплачено',planned:'Запланировано',due:'К оплате',cancelled:'Отменено'})[v]||v||''}
function moneyRu(v,c='THB'){const n=Number(v);if(!Number.isFinite(n))return '—';return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n)+' '+(c||'THB')}
function dateRu(v){if(!v)return '';try{return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v))}catch{return String(v)}}

window.openPaymentForm=async function(id){
  try{
    const reservations=await v9(`/crm/${id}/reservations`);
    const options=(reservations||[]).filter(x=>x.status!=='cancelled').map(r=>`<option value="${r.id}" data-total="${Number(r.total_amount||0)}">${esc(r.pcs_catalog_items?.title||'Бронь')} · ${esc(r.start_date)} → ${esc(r.end_date)} · ${moneyRu(r.total_amount,r.currency)}</option>`).join('');
    openSheet('Зафиксировать оплату',`
      <div class="payment-hint">Запись сразу попадёт в <b>Финансы</b> и в карточку клиента. Чек хранится внутри PCS.</div>
      <div class="grid2">
        <div class="field"><label>Вид платежа</label><select id="payKind"><option value="prepayment">Предоплата</option><option value="full">Полная оплата</option><option value="deposit">Депозит</option><option value="refund">Возврат</option><option value="other">Прочий платёж</option></select></div>
        <div class="field"><label>Бронь</label><select id="payReservation"><option value="">Без привязки к брони</option>${options}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Сумма</label><input id="payAmount" type="number" min="0" step="0.01" placeholder="Например 5000"></div>
        <div class="field"><label>Валюта</label><select id="payCurrency"><option>THB</option><option>USD</option><option>EUR</option><option>RUB</option><option>CNY</option><option>JPY</option><option>KRW</option><option>GBP</option></select></div>
      </div>
      <div class="field"><label>Способ оплаты</label><select id="payMethod"><option value="bank_transfer">Банковский перевод</option><option value="cash">Наличные</option><option value="card">Карта</option><option value="qr">QR / PromptPay</option><option value="other">Другое</option></select></div>
      <div class="field"><label>Чек / подтверждение</label><input id="payReceipt" type="file" accept="image/*,application/pdf"><small class="muted">Фото или PDF, до 12 МБ.</small></div>
      <div class="field"><label>Комментарий</label><textarea id="payNote" placeholder="Например: предоплата за аренду, остаток до выдачи авто"></textarea></div>
      <button class="btn sage" style="width:100%;margin-top:12px" onclick="savePayment('${id}')">Сохранить оплату</button>`);
    setTimeout(()=>{
      const s=document.querySelector('#payReservation'),a=document.querySelector('#payAmount');
      if(s&&a)s.addEventListener('change',()=>{const o=s.selectedOptions?.[0],n=Number(o?.dataset?.total||0);if(n>0&&!a.value)a.value=String(n)});
    },0);
  }catch(e){toast(e.message)}
};

window.savePayment=async function(id){
  try{
    const fd=new FormData();
    fd.set('payment_kind',document.querySelector('#payKind').value);
    fd.set('reservation_id',document.querySelector('#payReservation').value||'');
    fd.set('amount',document.querySelector('#payAmount').value);
    fd.set('currency',document.querySelector('#payCurrency').value);
    fd.set('payment_method',document.querySelector('#payMethod').value);
    fd.set('note',document.querySelector('#payNote').value.trim());
    const f=document.querySelector('#payReceipt').files?.[0];if(f)fd.set('receipt',f);
    await v9(`/crm/${id}/payment`,{method:'POST',body:fd});
    closeSheet();PCS.crm=await window.call('/crm');toast('Оплата сохранена в финансах');window.openClient(id,false);
  }catch(e){toast(e.message)}
};

const oldRenderClient=window.renderClient;
window.renderClient=function(d){
  oldRenderClient(d);
  const c=d.contact||d,root=document.querySelector('#crmDetail');if(!root)return;
  const holder=document.createElement('section');holder.className='client-finance-block';holder.innerHTML='<h3 class="section-title">Оплаты и чеки</h3><div class="muted">Загрузка…</div>';root.append(holder);
  v9(`/crm/${c.id}/finance`).then(rows=>{
    holder.innerHTML=`<div class="section-head"><h3 class="section-title">Оплаты и чеки</h3><button class="btn sage compact" onclick="openPaymentForm('${c.id}')">+ Оплата / чек</button></div><div class="list">${(rows||[]).map(x=>`<div class="item payment-row"><div><div class="pills"><span class="pill">${esc(paymentKindRu(x.payment_kind))}</span><span class="pill">${esc(financeStatusRu(x.status))}</span></div><b>${moneyRu(x.amount,x.currency)}</b><p>${esc(x.pcs_reservations?.pcs_catalog_items?.title||'')}${x.note?' · '+esc(x.note):''}</p><small>${esc(dateRu(x.paid_at||x.created_at))}${x.payment_method?' · '+esc(x.payment_method):''}</small></div>${x.receipt_url?`<a class="btn soft compact" href="${esc(x.receipt_url)}" target="_blank" rel="noopener">Открыть чек</a>`:'<span class="muted">Без чека</span>'}</div>`).join('')||'<div class="muted">Платежей пока нет</div>'}</div>`;
  }).catch(e=>{holder.innerHTML=`<h3 class="section-title">Оплаты и чеки</h3><div class="error">${esc(e.message)}</div>`});
};

const oldPricingManager=window.pricingManager;
window.pricingManager=function(id){
  const x=PCS.catalog?.find(v=>v.id===id);if(!x||x.category!=='car_rent')return oldPricingManager(id);
  openSheet('Тарифы аренды · '+x.title,`
    <div class="payment-hint">Для автомобилей цена хранится отдельно за <b>сутки, неделю и месяц</b>. Никаких скрытых пересчётов.</div>
    <div class="rental-price-grid">
      <div class="field"><label>Сутки</label><div class="money-input"><input id="rentDay" type="number" min="0" step="1" value="${esc(x.daily_price??(x.base_price_period==='day'?x.base_price:'')??'')}"><span>${esc(x.currency||'THB')}</span></div></div>
      <div class="field"><label>Неделя</label><div class="money-input"><input id="rentWeek" type="number" min="0" step="1" value="${esc(x.weekly_price??'')}"><span>${esc(x.currency||'THB')}</span></div></div>
      <div class="field"><label>Месяц</label><div class="money-input"><input id="rentMonth" type="number" min="0" step="1" value="${esc(x.monthly_price??(x.base_price_period==='month'?x.base_price:'')??'')}"><span>${esc(x.currency||'THB')}</span></div></div>
    </div>
    <p class="muted">Если один из тарифов не подтверждён — оставьте поле пустым. AI не должен придумывать его автоматически.</p>
    <button class="btn" style="width:100%;margin-top:12px" onclick="saveRentalPrices('${id}')">Сохранить тарифы</button>`);
};
window.saveRentalPrices=async function(id){
  try{
    const body={daily_price:document.querySelector('#rentDay').value,weekly_price:document.querySelector('#rentWeek').value,monthly_price:document.querySelector('#rentMonth').value};
    await v9(`/catalog/${id}/period-prices`,{method:'PATCH',body:JSON.stringify(body)});PCS.catalog=(await window.call('/catalog')).filter(x=>!x.deleted_at);closeSheet();toast('Тарифы сутки / неделя / месяц сохранены');window.catalog();
  }catch(e){toast(e.message)}
};

async function renderFinanceV9(){
  if(typeof window.opsNav==='function')window.opsNav();
  const m=document.querySelector('#main');if(!m)return;
  m.innerHTML=`<div class="eyebrow">Деньги</div><h1 class="title">Финансы</h1><p class="sub">Все оплаты, предоплаты, депозиты, возвраты, чеки и выплаты.</p><div id="fin">Загрузка…</div>`;
  try{
    const a=await v9('/finance');
    const currencies=[...new Set((a||[]).filter(x=>x.status==='paid').map(x=>x.currency||'THB'))];
    const summary=currencies.map(cur=>{const rows=a.filter(x=>x.status==='paid'&&(x.currency||'THB')===cur),sum=t=>rows.filter(x=>x.entry_type===t).reduce((s,x)=>s+Number(x.amount||0),0);return `<div class="finance-currency"><b>${esc(cur)}</b><span>Доход ${moneyRu(sum('income'),cur)}</span><span>Депозиты ${moneyRu(sum('deposit'),cur)}</span><span>Возвраты ${moneyRu(sum('refund'),cur)}</span><span>Партнёрам ${moneyRu(sum('partner_payout'),cur)}</span></div>`}).join('');
    document.querySelector('#fin').innerHTML=`<div class="finance-summary-v9">${summary||'<div class="muted">Пока нет оплаченных операций</div>'}</div><div class="list" style="margin-top:14px">${a.map(x=>`<div class="item finance-row-v9"><div><div class="pills"><span class="pill">${esc(entryTypeRu(x.entry_type))}</span><span class="pill">${esc(paymentKindRu(x.payment_kind))}</span><span class="pill">${esc(financeStatusRu(x.status))}</span></div><h3>${moneyRu(x.amount,x.currency)}</h3><p>${esc(x.pcs_contacts?.name||x.pcs_contacts?.username||x.counterparty||'')}${x.pcs_reservations?.pcs_catalog_items?.title?' · '+esc(x.pcs_reservations.pcs_catalog_items.title):''}</p><small>${esc(dateRu(x.paid_at||x.created_at))}${x.note?' · '+esc(x.note):''}</small></div>${x.receipt_url?`<a class="btn soft compact" href="${esc(x.receipt_url)}" target="_blank" rel="noopener">Чек</a>`:''}</div>`).join('')||'<div class="empty">Финансовых операций пока нет</div>'}</div>`;
  }catch(e){document.querySelector('#fin').textContent=e.message}
}
window.renderFinanceV9=renderFinanceV9;
const previousGo=window.go;
window.go=function(p){
  if(p==='finance'){
    PCS.page='finance';document.querySelector('#root').innerHTML=typeof shell==='function'?shell():document.querySelector('#root').innerHTML;
    if(typeof opsNav==='function')opsNav();renderFinanceV9();return;
  }
  return previousGo(p);
};

const RU_RAW={once:'Один раз',per_day:'За день',per_booking:'За бронь',available:'Доступно',checking:'Проверяется',unavailable:'Недоступно',requested:'Запрос',hold:'Холд',confirmed:'Подтверждено',active:'Активно',completed:'Завершено',cancelled:'Отменено'};
function localizeRaw(){const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const p=n.parentElement,t=(n.nodeValue||'').trim();if(!p||!t||p.closest('.conversation,.bubble,textarea,script,style'))continue;if(RU_RAW[t])n.nodeValue=n.nodeValue.replace(t,RU_RAW[t])}}
let rr=0;new MutationObserver(()=>{cancelAnimationFrame(rr);rr=requestAnimationFrame(localizeRaw)}).observe(document.body,{childList:true,subtree:true});setTimeout(localizeRaw,0);
})();