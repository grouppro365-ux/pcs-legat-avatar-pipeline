(()=>{
 'use strict';
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const time=s=>{const d=new Date(s);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU'):'—'};
 const status=s=>({draft:'Черновик',needs_review:'Нужно проверить',ready_to_sign:'Готов к подписи',signed:'Подписан',superseded:'Предыдущая версия',cancelled:'Отменён',confirmed:'Подтверждена',active:'В аренде',completed:'Завершена'})[s]||'—';
 const titles={generated:'Создана версия договора',updated:'Сохранены поля договора',finalized:'Подтверждена финальная версия',previous_signature_confirmed:'Подтверждена прежняя подпись',vehicle_handover_confirmed:'Подтверждена выдача автомобиля',vehicle_return_confirmed:'Подтверждён возврат автомобиля',rental_status_updated:'Изменён статус аренды',signed_copy_uploaded:'Прикреплён подписанный экземпляр',pdf_uploaded:'Сохранён PDF'};
 const id=s=>/^[0-9a-f-]+$/i.test(String(s))?String(s):null;
 function render(data,reservation){
  const versions=Array.isArray(data.versions)?data.versions:[],events=Array.isArray(data.events)?data.events:[];
  const versionNames=new Map(versions.map(v=>[v.id,v.version]));
  return `<div class="contract-history"><p class="muted">Здесь сохранённые версии и записи действий. Подпись и отметки выдачи или возврата относятся к указанной версии.</p><h3>Сохранённые версии</h3><div class="contract-history-versions">${versions.map(v=>`<section class="contract-history-version"><b>Версия ${E(v.version)}</b><span>${E(status(v.status))}</span><small>Создана: ${E(time(v.created_at))}${v.signed_at?` · Подписана: ${E(time(v.signed_at))}`:''}</small>${v.has_signed_copy?'<small>Подписанный экземпляр прикреплён</small>':''}${id(v.id)?`<div class="contract-fact-actions"><button class="btn soft" onclick="editContract('${id(v.id)}')">Открыть поля</button>${['ready_to_sign','signed'].includes(v.status)?`<button class="btn blue" onclick="previewContract('${id(v.id)}')">Скачать PDF</button>`:''}</div>`:''}</section>`).join('')||'<p class="muted">Сохранённых версий пока нет.</p>'}</div>${data.versions_truncated?'<p class="muted">Показаны последние 50 сохранённых версий.</p>':''}<h3>Журнал действий</h3><ol class="contract-history-events">${events.map(e=>{const p=e.payload||{};return `<li><b>${E(titles[e.event_type]||'Запись в журнале договора')}</b><small>Версия ${E(versionNames.get(e.contract_id)??'—')} · Записано: ${E(time(e.created_at))}</small>${p.occurred_at?`<span>Фактическая дата: ${E(time(p.occurred_at))}</span>`:''}${p.operator_name?`<span>Менеджер: ${E(p.operator_name)}</span>`:''}${p.status?`<span>Статус: ${E(status(p.previous_status))} → ${E(status(p.status))}</span>`:''}${p.note?`<p>${E(p.note)}</p>`:''}</li>`}).join('')||'<li class="muted">Записей пока нет.</li>'}</ol>${data.events_truncated?'<p class="muted">Показаны последние 200 записей выбранных версий.</p>':''}${id(reservation)?`<button class="btn ghost" onclick="contractCenter('${id(reservation)}')">К актуальному договору</button>`:''}</div>`;
 }
 async function open(reservation){
  if(!id(reservation))return;
  try{const data=await window.contractCall(`/reservations/${reservation}/contracts/history`);window.openSheet('Версии и журнал договора',render(data,reservation))}
  catch(e){window.toast(e.message==='unauthorized'?'Нужно повторно войти в PCS.':'Не удалось загрузить журнал. Повторите открытие.')}
 }
 window.pcsContractHistory={open,render};
})();
