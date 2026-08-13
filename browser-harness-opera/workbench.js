const $ = id => document.getElementById(id);
let currentState = null;
let draggedTaskId = null;

async function call(type, payload={}) {
  return new Promise((resolve,reject)=>{
    chrome.runtime.sendMessage({type,...payload}, res => {
      const err=chrome.runtime.lastError;
      if(err) return reject(new Error(err.message));
      if(!res?.ok) return reject(new Error(res?.error||'Unknown extension error'));
      resolve(res);
    });
  });
}
function time(ts){try{return new Date(ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}catch{return'';}}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function skillForTask(task){return /@seo-article-writer-tatyana|\bseo\b|rank math|seo[- ]?стат|мета[- ]?тег|каннибализац/i.test(String(task?.text||task||''))?'seo-article-writer-tatyana':'';}

function card(task){
  const el=document.createElement('div');
  el.className=`card ${task.status||''}`;
  el.draggable=task.status==='queue';
  el.dataset.taskId=task.id;
  const skill=skillForTask(task);
  el.innerHTML=`<div class="txt">${esc(task.text)}</div><div class="meta">${esc(task.status)}${skill?` · skill: ${esc(skill)}`:''}${task.error?` · ${esc(task.error)}`:''}${task.result?` · ${esc(task.result)}`:''}</div>`;
  el.addEventListener('dragstart',()=>{draggedTaskId=task.id;});
  el.addEventListener('dragend',()=>{draggedTaskId=null;document.querySelectorAll('.column').forEach(c=>c.classList.remove('dragover'));});
  return el;
}
function renderTasks(state){
  const q=$('queueCards'),r=$('runningCards'),d=$('doneCards');q.innerHTML='';r.innerHTML='';d.innerHTML='';
  for(const task of state.tasks||[]){
    const el=card(task);
    if(task.status==='done')d.appendChild(el);
    else if(task.status==='queue')q.appendChild(el);
    else r.appendChild(el);
  }
}
function renderLogs(state){
  const box=$('logs');const nearBottom=box.scrollTop+box.clientHeight>=box.scrollHeight-30;
  box.innerHTML=(state.logs||[]).slice(-120).map(l=>`<div class="log ${esc(l.level)}"><b>${time(l.ts)}</b> ${esc(l.message)}${l.data?` <span>${esc(JSON.stringify(l.data))}</span>`:''}</div>`).join('');
  if(nearBottom)box.scrollTop=box.scrollHeight;
}
function render(state){
  currentState=state;
  $('chatState').textContent=state.chat?state.chat.title||state.chat.path:'Не привязан';
  $('targetState').textContent=state.target?state.target.title||state.target.origin:'Не привязана';
  renderTasks(state);renderLogs(state);
  const run=state.run;
  const status=run?.status||'idle';
  $('runStatus').textContent=status==='idle'?'Ожидание':status;
  $('runStatus').className=status==='done'?'ok':(['blocked','cancelled'].includes(status)?'err':(status==='confirmation'?'warn':''));
  $('runProgress').textContent=run?`${run.step||0}/${run.maxSteps||100} · recovery ${run.recoveries||0}/10${Object.keys(run.ledger||{}).length?` · items ${Object.keys(run.ledger||{}).length}`:''}`:'';
  const showConfirm=run?.status==='confirmation'&&run.pendingAction?.token;
  $('confirmBox').classList.toggle('show',!!showConfirm);
  if(showConfirm){
    const a=run.pendingAction.action||{};
    $('confirmText').textContent=`Одноразовое подтверждение: ${a.type}${a.target?.name?` — ${a.target.name}`:''}${a.url?` — ${a.url}`:''}`;
  }
  $('cancelBtn').disabled=!run||!['running','confirmation'].includes(run.status);
}
async function refresh(){try{const res=await call('ABH_GET_STATE');render(res.state);}catch(err){$('runStatus').textContent=err.message;$('runStatus').className='err';}}

$('bindChat').addEventListener('click',async()=>{try{const r=await call('ABH_BIND_CHAT');render(r.state);}catch(e){alert(e.message);}});
$('bindTarget').addEventListener('click',async()=>{try{const r=await call('ABH_BIND_TARGET');render(r.state);}catch(e){alert(e.message);}});
$('addTask').addEventListener('click',async()=>{const text=$('taskText').value.trim();if(!text)return;try{const r=await call('ABH_ADD_TASK',{text});$('taskText').value='';render(r.state);}catch(e){alert(e.message);}});
$('taskText').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){$('addTask').click();}});
$('confirmAction').addEventListener('click',async()=>{const token=currentState?.run?.pendingAction?.token;if(!token)return;try{await call('ABH_CONFIRM',{token});await refresh();}catch(e){alert(e.message);}});
async function cancel(){try{const r=await call('ABH_CANCEL');render(r.state);}catch(e){alert(e.message);}}
$('cancelRun').addEventListener('click',cancel);$('cancelBtn').addEventListener('click',cancel);
$('openFull').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('workbench.html')}));

document.querySelectorAll('.column').forEach(col=>{
  col.addEventListener('dragover',e=>{if(col.dataset.column==='running'&&draggedTaskId){e.preventDefault();col.classList.add('dragover');}});
  col.addEventListener('dragleave',()=>col.classList.remove('dragover'));
  col.addEventListener('drop',async e=>{
    col.classList.remove('dragover');
    if(col.dataset.column!=='running'||!draggedTaskId)return;
    e.preventDefault();const id=draggedTaskId;draggedTaskId=null;
    try{const r=await call('ABH_START_TASK',{taskId:id});render(r.state);}catch(err){alert(err.message);}
  });
});

refresh();setInterval(refresh,1000);
