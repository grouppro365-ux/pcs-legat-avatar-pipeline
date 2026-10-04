(()=>{
 'use strict';
 const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let rows=new Map(),loading=false,acting=false,page=0;
 const held=x=>x.delivery_status&&!(x.delivery_status==='FAILED'&&x.delivery_stage==='rejected');
 async function list(nextPage=page){
  const main=document.getElementById('main');if(!main||loading||!Number.isInteger(nextPage)||nextPage<0||nextPage>5000)return;page=nextPage;
  loading=true;rows=new Map();main.innerHTML='<div class="page-head"><h1>Требуют ответа</h1><p>Проверьте сообщение клиента и ответ перед решением.</p></div><div id="approvalList" class="list">Загрузка…</div>';
  const target=document.getElementById('approvalList');
  try{
   const data=await window.call('/approvals?page='+page);if(document.getElementById('approvalList')!==target)return;
   if(!Array.isArray(data))throw Error('Не удалось получить очередь.');
   rows=new Map(data.filter(x=>valid(x.id)).map(x=>[x.id,x]));
   target.innerHTML=[...rows.values()].map(x=>`<div class="item"><b>${escape(x.contact_name||x.contact_username||'Клиент')}</b><p style="white-space:pre-wrap">${escape(x.source_text||'Исходное сообщение не содержит текста.')}</p><div class="answer-box" style="white-space:pre-wrap">${escape(x.answer)}</div>${held(x)?'<p class="contract-fact-error">Доставка не подтверждена. Проверьте диалог.</p>':''}<button class="btn" onclick="pcsApprovals.open('${x.id}')">Проверить ответ</button></div>`).join('')||'<div class="empty">Очередь пуста</div>';
   target.innerHTML+=`<div class="toolbar"><button class="btn soft" ${page===0?'disabled':''} onclick="pcsApprovals.list(${page-1})">Назад</button><span>Страница ${page+1}</span><button class="btn soft" ${data.length<200||page===5000?'disabled':''} onclick="pcsApprovals.list(${page+1})">Далее</button></div>`;
  }catch(e){if(document.getElementById('approvalList')===target)target.textContent=e.message||'Не удалось загрузить очередь.'}finally{loading=false}
 }
 function open(id){
  const x=rows.get(id);if(!x||acting)return;
  window.openSheet('Проверить AI-ответ',`<form id="approvalReviewForm" data-id="${id}" onsubmit="event.preventDefault();pcsApprovals.decide('send')"><b>${escape(x.contact_name||'Клиент')}</b><p>Сообщение клиента</p><div class="answer-box" style="white-space:pre-wrap">${escape(x.source_text||'Нет текстового сообщения')}</div><div class="field"><label for="approvalAnswer">Ответ клиенту</label><textarea id="approvalAnswer" readonly rows="7">${escape(x.answer)}</textarea></div>${x.policy_reason?`<p>${escape(x.policy_reason)}</p>`:''}<p id="approvalReviewError" class="contract-fact-error" role="alert">${held(x)?'Доставка не подтверждена. Проверьте диалог клиента.':''}</p><div class="toolbar"><button class="btn soft" type="button" onclick="closeSheet();pcsApprovals.list()">Обновить очередь</button><button id="approvalSend" class="btn" type="submit">${held(x)?'Проверить отправку':'Отправить ответ'}</button><button id="approvalReject" class="btn danger" type="button" ${held(x)?'disabled':''} onclick="pcsApprovals.decide('reject')">Отклонить</button>${valid(x.contact_id)?`<button class="btn soft" type="button" onclick="closeSheet();openClient('${x.contact_id}',false)">Диалог клиента</button>`:''}</div></form>`);
 }
 async function decide(action){
  const form=document.getElementById('approvalReviewForm');if(!form||acting||!['send','reject'].includes(action))return;
  const x=rows.get(form.dataset.id);if(!x)return;
  const err=document.getElementById('approvalReviewError'),send=document.getElementById('approvalSend'),reject=document.getElementById('approvalReject');
  acting=true;send.disabled=true;reject.disabled=true;err.textContent='';
  try{
   await window.call('/approvals/'+x.id+'/'+action,{method:'POST',body:JSON.stringify({expected_version:x.edit_version,...(action==='send'?{text:x.answer}:{})})});
   window.toast(action==='send'?'Ответ отправлен':'Ответ отклонён');
   if(document.getElementById('approvalReviewForm')===form){window.closeSheet();await list()}
  }catch(e){
   if(document.getElementById('approvalReviewForm')!==form)return;
   err.textContent=e.message||'Результат не подтверждён. Обновите очередь и проверьте диалог.';
   // Network loss may follow a successful decision. Refresh the queue instead of allowing a different decision.
   if(action==='send'&&(e.code==='delivery_uncertain'||!e.status)){x.delivery_status='PROCESSING';x.delivery_stage='sending';send.textContent='Проверить отправку'}
  }finally{acting=false;if(document.getElementById('approvalReviewForm')===form){send.disabled=false;reject.disabled=Boolean(held(x))}}
 }
 window.pcsApprovals={list,open,decide};window.approvals=list;
 window.sendApproval=open;window.rejectApproval=open;
})();
