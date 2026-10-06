(()=>{
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
 const names={telegram:'Одинаковый Telegram ID',phone:'Похожие записи по телефону',overdue:'Просроченный следующий шаг',missing_date:'Следующий шаг без срока'};
 const time=x=>x&&Number.isFinite(Date.parse(x))?new Date(x).toLocaleString('ru-RU'):'Не указан';
 let state;
 const active=s=>state===s&&document.getElementById('pcsQualityRows')===s.root;
 async function load(s){
  if(!active(s))return;const seq=++s.seq,{view,page}=s;s.root.textContent='Проверяю записи CRM…';document.getElementById('pcsQualityPrev').disabled=document.getElementById('pcsQualityNext').disabled=true;
  try{const d=await window.call('/data-quality?'+new URLSearchParams({view,page}));if(!active(s)||seq!==s.seq)return;
   if(d.view!==view||d.page!==page||!Array.isArray(d.rows)||d.rows.some(x=>!valid(x.id)))throw Error('Некорректный ответ проверки CRM');
   s.root.innerHTML=d.rows.map((x,i)=>`<article class="item" style="min-width:0;overflow-wrap:anywhere"><b>${esc(x.name||x.username||'Клиент')}</b><p>${esc([x.username,x.phone,x.city].filter(Boolean).join(' · '))}</p>${x.match_key?`<p>Совпадение: ${esc(x.match_key)} · записей: ${esc(x.duplicate_count)}</p>`:''}<p>Следующий шаг: ${esc(x.next_action||'Не указан')}</p><p>Срок: ${esc(time(x.next_action_at))}</p><button class="btn soft" type="button" data-quality-contact="${i}">Открыть клиента</button></article>`).join('')||'<p class="muted">В этом разделе записей для проверки нет.</p>';
   s.root.querySelectorAll('[data-quality-contact]').forEach(b=>b.onclick=()=>{if(!active(s))return;state=null;window.closeSheet();window.openClient(d.rows[Number(b.dataset.qualityContact)].id);});
   document.getElementById('pcsQualityPage').textContent=`Страница ${page+1}`;document.getElementById('pcsQualityPrev').disabled=page===0;document.getElementById('pcsQualityNext').disabled=!d.truncated||page>=5000;
  }catch(e){if(active(s)&&seq===s.seq)s.root.textContent=e.message||'Не удалось проверить CRM. Обновите список.';}
 }
 async function open(){
  window.openSheet('Качество CRM',`<p class="muted">Совпадение телефона или Telegram ID — повод проверить карточки. Общий семейный номер и разные обращения могут принадлежать разным людям. Записи не объединяются автоматически.</p><div class="field"><label for="pcsQualityView">Проверка</label><select id="pcsQualityView" data-pcs-localized>${Object.entries(names).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div><button class="btn soft" id="pcsQualityRefresh">Обновить</button><div class="list" id="pcsQualityRows" aria-live="polite" style="margin-top:12px"></div><p class="muted" id="pcsQualityPage"></p><div class="toolbar"><button class="btn soft" id="pcsQualityPrev" disabled>Назад</button><button class="btn soft" id="pcsQualityNext" disabled>Далее</button></div>`);
  const s=state={root:document.getElementById('pcsQualityRows'),view:'telegram',page:0,seq:0};document.getElementById('pcsQualityView').onchange=e=>{s.view=e.target.value;s.page=0;load(s)};document.getElementById('pcsQualityRefresh').onclick=()=>load(s);document.getElementById('pcsQualityPrev').onclick=()=>{s.page=Math.max(0,s.page-1);load(s)};document.getElementById('pcsQualityNext').onclick=()=>{s.page++;load(s)};await load(s);
 }
 window.pcsDataQuality={open};
 for(const name of ['moreMenu','pcs25Menu']){const previous=window[name];if(typeof previous!=='function')continue;window[name]=function(...args){const result=previous.apply(this,args),grid=document.querySelector('.sheetbox .v26-more,.sheetbox .more-grid,.sheetbox .action-grid');if(grid){const button=document.createElement('button');button.className='btn soft';button.textContent='Качество CRM';button.onclick=open;grid.appendChild(button);}return result;};}
})();
