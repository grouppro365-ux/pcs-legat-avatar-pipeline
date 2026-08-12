const $ = id => document.getElementById(id);
let state = null;
let pollTimer = null;

async function call(type, extra={}) { return chrome.runtime.sendMessage({type, ...extra}); }
function esc(s='') { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderBind(el,ok,text){el.innerHTML=`<span class="dot ${ok?'ok':''}"></span>${esc(text)}`;}

function render(){
  renderBind($('chatBind'),!!state?.chat,state?.chat?`${state.chat.title} · ${state.chat.path}`:'ChatGPT не привязан');
  renderBind($('targetBind'),!!state?.target,state?.target?`${state.target.title} · ${state.target.origin}`:'Рабочий сайт не привязан');

  const run=state?.run;const status=run?.status||'';
  $('runStatus').className=`status ${status}`;
  const statusText=!run?'Нет активной задачи':({running:'Выполняется',awaiting_ai:'ChatGPT выбирает следующий шаг',confirmation:'Ждёт подтверждения',done:'Готово',blocked:'Остановлено',cancelled:'Отменено'}[status]||status);
  $('runStatus').textContent=run?.error&&['blocked','cancelled'].includes(status)?`${statusText}: ${run.error}`:statusText;
  $('step').textContent=run?`${run.step||0}/50${run.recoveries?` · ↻${run.recoveries}`:''}`:'';
  $('start').disabled=!state?.chat||!state?.target||['running','awaiting_ai','confirmation'].includes(status);
  $('cancel').disabled=!run||['done','blocked','cancelled'].includes(status);

  if(run?.result){$('result').classList.remove('hidden');$('result').textContent=run.result;}else $('result').classList.add('hidden');
  if(run?.evidence){$('evidence').classList.remove('hidden');$('evidence').textContent=`Проверка: ${run.evidence}`;}else $('evidence').classList.add('hidden');

  const pending=run?.status==='confirmation'?run.pendingAction:null;
  $('confirm').classList.toggle('hidden',!pending);
  if(pending){
    const a=pending.action||{};
    const subject=a.url||a.target?.name||a.target?.label||a.target?.text||a.target?.ref||'';
    $('confirmText').textContent=`${a.type||'action'} → ${subject}`;
    $('approve').dataset.token=pending.token||'';
  }

  const logs=(state?.logs||[]).slice(-50).reverse();
  $('log').innerHTML=logs.map(l=>{const detail=l?.data?.error?` — ${l.data.error}`:'';return`<div class="${esc(l.level)}"><b>${esc((l.ts||'').slice(11,19))}</b> ${esc(l.message)}${esc(detail)}</div>`;}).join('')||'<div>Журнал пуст.</div>';
}

async function refresh(){try{const res=await call('AUH_GET_STATE');if(res?.ok){state=res.state;render();}}catch(err){$('runStatus').textContent=`Ошибка: ${err.message||err}`;}}
function showError(err){$('runStatus').className='status blocked';$('runStatus').textContent=`Ошибка: ${err?.message||err}`;}

$('bindChat').onclick=async()=>{try{const r=await call('AUH_BIND_CHAT');if(!r?.ok)throw new Error(r?.error);state=r.state;render();}catch(e){showError(e);}};
$('bindTarget').onclick=async()=>{try{const r=await call('AUH_BIND_TARGET');if(!r?.ok)throw new Error(r?.error);state=r.state;render();}catch(e){showError(e);}};
$('start').onclick=async()=>{try{const task=$('task').value.trim();const r=await call('AUH_START_TASK',{task});if(!r?.ok)throw new Error(r?.error);state=r.state;render();}catch(e){showError(e);}};
$('cancel').onclick=async()=>{try{await call('AUH_CANCEL_RUN');await refresh();}catch(e){showError(e);}};
$('reject').onclick=$('cancel').onclick;
$('approve').onclick=async()=>{try{const token=$('approve').dataset.token;const r=await call('AUH_APPROVE_PENDING',{token});if(!r?.ok)throw new Error(r?.error);await refresh();}catch(e){showError(e);}};

refresh();
pollTimer=setInterval(refresh,700);
window.addEventListener('unload',()=>clearInterval(pollTimer));
