(()=>{
'use strict';
const names={all:'Всё',contacts:'Клиенты',catalog:'Каталог',applications:'Заявки и брони',partners:'Партнёры',messages:'Сообщения'};
let ticket=0,results=[],state={q:'',scope:'all',page:0};
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
function open(q=''){
 ticket++;state={q:String(q).trim(),scope:'all',page:0};
 openSheet('Поиск',`<form id="pcsSearchForm"><label>Клиент, телефон, каталог, заявка, партнёр или текст сообщения<input id="pcsSearchQuery" minlength="2" maxlength="120" required value="${esc(state.q)}" placeholder="Минимум 2 символа"></label><label>Где искать<select id="pcsSearchScope">${Object.entries(names).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><button class="btn" type="submit">Найти</button></form><div id="pcsSearchResults" aria-live="polite"></div>`);
 document.getElementById('pcsSearchForm').addEventListener('submit',e=>{e.preventDefault();state={q:document.getElementById('pcsSearchQuery').value.trim(),scope:document.getElementById('pcsSearchScope').value,page:0};run()});
 if(state.q.length>=2)run();
}
async function run(){
 const target=document.getElementById('pcsSearchResults'),request=++ticket,snapshot={...state};if(!target)return;
 target.textContent='Ищу…';
 try{
  const data=await call('/search?'+new URLSearchParams(snapshot));
  if(request!==ticket||document.getElementById('pcsSearchResults')!==target)return;
  if(!Array.isArray(data.groups))throw Error('Некорректный ответ поиска');
  results=[];target.innerHTML=data.groups.map(g=>`<section><h3>${esc(names[g.scope]||g.scope)}</h3>${g.error?`<p role="alert">${esc(g.error)}</p>`:g.rows.map(x=>{const index=results.push({scope:g.scope,row:x})-1;return `<button type="button" class="item" data-result="${index}" style="width:100%;text-align:left;overflow-wrap:anywhere"><strong>${esc(x.title||x.public_id||'Без названия')}</strong><p>${esc([x.public_id,x.phone,x.username,x.client_contact,x.city,x.entity_type,x.category,x.status,x.operational_status,x.availability_status].filter(Boolean).join(' · '))}</p>${x.summary?`<p>${esc(x.summary)}</p>`:''}</button>`}).join('')||'<p>Совпадений на этой странице нет</p>'}${g.truncated?'<p>Есть ещё результаты — откройте следующую страницу.</p>':''}</section>`).join('');
  target.innerHTML+=`<div class="toolbar"><button class="btn soft" data-page="prev" ${snapshot.page===0?'disabled':''}>Назад</button><span>Страница ${snapshot.page+1}</span><button class="btn soft" data-page="next" ${!data.groups.some(g=>g.truncated)||snapshot.page>=5000?'disabled':''}>Далее</button></div>`;
  target.querySelectorAll('[data-result]').forEach(b=>b.addEventListener('click',()=>select(results[Number(b.dataset.result)])));
  target.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{state={...snapshot,page:snapshot.page+(b.dataset.page==='next'?1:-1)};run()}));
 }catch(e){if(request===ticket&&document.getElementById('pcsSearchResults')===target)target.textContent=e.message||'Поиск недоступен'}
}
function select(result){
 if(!result)return;const {scope,row}=result;
 if((scope==='contacts'||scope==='messages')&&valid(scope==='contacts'?row.id:row.contact_id)){ticket++;closeSheet();openClient(scope==='contacts'?row.id:row.contact_id,false);return}
 ticket++;
 const labels={public_id:'Номер',title:'Название / клиент',client_contact:'Контакт',city:'Город',category:'Категория',entity_type:'Тип',operational_status:'Статус заявки',availability_status:'Доступность',legal_name:'Юридическое название',status:'Статус'};
 openSheet(names[scope],Object.entries(labels).filter(([k])=>row[k]!=null).map(([k,v])=>`<p><strong>${esc(v)}:</strong> ${esc(row[k])}</p>`).join('')+`<button class="btn soft" id="pcsSearchBack">Вернуться к поиску</button>`+(scope==='catalog'&&valid(row.id)?'<button class="btn" id="pcsSearchCatalog">Открыть карточку каталога</button>':''));
 document.getElementById('pcsSearchBack').addEventListener('click',()=>{const saved={...state};open(saved.q);state=saved;run()});
 document.getElementById('pcsSearchCatalog')?.addEventListener('click',()=>{closeSheet();window.editCatalog37(row.id)});
}
window.pcsSearch={open};window.pcs25Search=()=>open(document.getElementById('pcs25Search')?.value||'');
 document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target?.id==='pcs25Search'){e.preventDefault();window.pcs25Search()}});
})();
