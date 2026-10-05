(()=>{
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
 const time=x=>x&&Number.isFinite(Date.parse(x))?new Date(x).toLocaleString('ru-RU'):'—';
 const amount=x=>typeof x==='string'&&/^\d+(?:\.\d+)?$/.test(x)?x.split('.')[0].replace(/\B(?=(\d{3})+(?!\d))/g,' ')+(x.includes('.')?'.'+x.split('.')[1]:''):'Сумма не указана';
 const status=x=>({DRAFT:'Черновик',SUBMITTED:'Представлено партнёром',APPROVED:'Одобрено оператором',REJECTED:'Отклонено',WITHDRAWN:'Отозвано',EXPIRED:'Срок истёк',ACCEPTED:'Принято'})[x]||'Неизвестный статус';
 let state=null;
 const active=s=>state===s&&document.getElementById('pcsOfferRows')===s.root;
 function card(x,source){
  if(source==='quotes')return `<article class="item" style="overflow-wrap:anywhere"><b>Версия цены ${esc(x.version)}</b><p>Стоимость: ${esc(amount(x.client_total))} ${esc(x.currency)}</p><p>Депозит: ${esc(amount(x.deposit))} ${esc(x.currency)}</p><p class="muted">Получатель оплаты: ${x.payment_recipient==='PARTNER'?'партнёр':'не подтверждён'}</p><p class="muted">Зафиксировано: ${esc(time(x.immutable_at))}</p></article>`;
  return `<article class="item" style="overflow-wrap:anywhere"><b>${esc(x.item_title||'Предложение партнёра')}</b><p><span class="pill">${status(x.status)}</span>${x.selected_in_application?'<span class="pill">Выбрано в заявке</span>':''}${x.deadline_passed?'<span class="pill warn">Срок действия прошёл</span>':''}</p><p>Стоимость: ${esc(amount(x.client_price_thb))} ${esc(x.currency_code)}</p><p>Депозит: ${esc(amount(x.deposit_thb))} ${esc(x.currency_code)}</p>${x.terms?`<details><summary style="min-height:44px;cursor:pointer">Условия</summary><p style="white-space:pre-wrap">${esc(x.terms)}</p></details>`:''}${x.client_comment?`<p style="white-space:pre-wrap">Комментарий: ${esc(x.client_comment)}</p>`:''}<p class="muted">Действует до: ${esc(time(x.expires_at))}</p><p class="muted">Представлено: ${esc(time(x.submitted_at))}</p><p class="muted">Проверено: ${esc(time(x.reviewed_at))}</p><p class="muted">Принято: ${esc(time(x.accepted_at))}</p></article>`;
 }
 async function load(s){
  if(!active(s))return;const seq=++s.seq,{source,page,id}=s;s.root.textContent='Загружаю предложения…';document.getElementById('pcsOfferPrev').disabled=true;document.getElementById('pcsOfferNext').disabled=true;
  try{const d=await window.call('/application-offers/'+id+'?'+new URLSearchParams({source,page}));if(!active(s)||seq!==s.seq)return;if(d.application?.id!==id||d.source!==source||d.page!==page||!Array.isArray(d.rows))throw Error('Некорректный ответ предложений');
   document.getElementById('pcsOfferApplication').textContent=d.application.public_id||'Заявка PCS';s.root.innerHTML=d.rows.map(x=>card(x,source)).join('')||`<p class="muted">${source==='partner'?'Предложения партнёров по этой заявке пока не сохранены.':'Снимки цены по этой заявке пока не сохранены.'}</p>`;
   document.getElementById('pcsOfferPage').textContent=`Страница ${page+1}`;document.getElementById('pcsOfferPrev').disabled=page===0;document.getElementById('pcsOfferNext').disabled=!d.truncated||page>=5000;
  }catch(e){if(active(s)&&seq===s.seq)s.root.textContent=e.message||'Не удалось загрузить предложения. Обновите список.';}
 }
 async function open(id){
  if(!uuid(id))return;
  window.openSheet('Предложения и цены',`<b id="pcsOfferApplication"></b><p class="muted">Сохранённые предложения и версии стоимости. Депозит показан отдельно. Статусы предложения и оплаты проверяются в заявке.</p><div class="toolbar"><select id="pcsOfferSource" aria-label="Вид предложений" data-pcs-localized style="max-width:100%;min-height:44px"><option value="partner">Предложения партнёров</option><option value="quotes">Версии цены PCS</option></select><button class="btn soft" id="pcsOfferRefresh">Обновить</button><button class="btn soft" id="pcsOfferBack">К заявке</button></div><div id="pcsOfferRows" class="list" aria-live="polite" style="margin-top:12px"></div><p id="pcsOfferPage" class="muted"></p><div class="toolbar"><button class="btn soft" id="pcsOfferPrev" disabled>Назад</button><button class="btn soft" id="pcsOfferNext" disabled>Далее</button></div>`);
  const s=state={root:document.getElementById('pcsOfferRows'),id,source:'partner',page:0,seq:0};document.getElementById('pcsOfferSource').onchange=e=>{s.source=e.target.value;s.page=0;load(s)};document.getElementById('pcsOfferRefresh').onclick=()=>load(s);document.getElementById('pcsOfferBack').onclick=()=>window.pcsApplications.openDetail(id);document.getElementById('pcsOfferPrev').onclick=()=>{s.page=Math.max(0,s.page-1);load(s)};document.getElementById('pcsOfferNext').onclick=()=>{s.page++;load(s)};await load(s);
 }
 window.pcsApplicationOffers={open};
})();
