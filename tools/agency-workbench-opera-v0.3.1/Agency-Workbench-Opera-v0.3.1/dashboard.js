const $ = id => document.getElementById(id);

function addLog(message, level='info') {
  const el=document.createElement('div');
  el.className=`entry ${level}`;
  el.textContent=`${new Date().toLocaleTimeString()}  ${message}`;
  $('log').appendChild(el);
  $('log').scrollTop=$('log').scrollHeight;
}

async function activeTab() {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab) throw new Error('Активная вкладка не найдена.');
  return tab;
}

async function call(msg) {
  const res=await chrome.runtime.sendMessage(msg);
  if(!res?.ok) throw new Error(res?.error||'Неизвестная ошибка');
  return res;
}

async function refresh() {
  try {
    const res=await call({type:'GET_STATUS'});
    const b=res.bindings||{};
    $('chatStatus').textContent=b.chatLocation?`ChatGPT: ${b.chatLocation}`:'ChatGPT: не привязан';
    $('chatStatus').className=`status ${b.chatLocation?'ok':''}`;
    $('targetStatus').textContent=b.targetOrigin?`Сайт: ${b.targetOrigin}`:'Сайт: не привязан';
    $('targetStatus').className=`status ${b.targetOrigin?'ok':''}`;
    const pending=res.stored?.pendingConfirmation;
    $('confirm').hidden=!pending;
    if(pending) $('runStatus').textContent='Требуется подтверждение опасного действия.';
  } catch(e) { addLog(e.message,'error'); }
}

$('bindChat').addEventListener('click',async()=>{
  try {
    const tab=await activeTab();
    const res=await call({type:'BIND_CHAT',tabId:tab.id});
    addLog(`ChatGPT привязан: ${res.location}`,'success');
    await refresh();
  } catch(e) { addLog(e.message,'error'); }
});

$('bindTarget').addEventListener('click',async()=>{
  try {
    const tab=await activeTab();
    const res=await call({type:'BIND_TARGET',tabId:tab.id});
    addLog(`Сайт привязан: ${res.origin}`,'success');
    await refresh();
  } catch(e) { addLog(e.message,'error'); }
});

$('testChat').addEventListener('click',async()=>{
  try {
    $('runStatus').textContent='Проверяю ChatGPT bridge…';
    const res=await call({type:'TEST_CHAT'});
    if(!res.ok) throw new Error('ChatGPT ответил, но тестовая метка не найдена.');
    addLog('ChatGPT bridge: PASS','success');
    $('runStatus').textContent='ChatGPT bridge работает.';
  } catch(e) { addLog(e.message,'error'); $('runStatus').textContent=e.message; }
});

$('run').addEventListener('click',async()=>{
  const task=$('task').value.trim();
  try {
    $('run').disabled=true;
    $('runStatus').textContent='Выполняю…';
    addLog(`Задача: ${task}`);
    const res=await call({type:'RUN_TASK',task});
    const r=res.result||{};
    if(r.status==='needs_confirmation') {
      $('runStatus').textContent=r.reason||'Нужно подтверждение.';
      $('confirm').hidden=false;
    } else {
      $('runStatus').textContent=r.summary||r.status||'Готово';
    }
  } catch(e) { addLog(e.message,'error'); $('runStatus').textContent=e.message; }
  finally { $('run').disabled=false; await refresh(); }
});

$('confirm').addEventListener('click',async()=>{
  try {
    $('confirm').disabled=true;
    addLog('Пользователь подтвердил одно опасное действие.','warning');
    const res=await call({type:'CONFIRM_PENDING'});
    $('runStatus').textContent=res.result?.summary||res.result?.status||'Продолжено';
  } catch(e) { addLog(e.message,'error'); $('runStatus').textContent=e.message; }
  finally { $('confirm').disabled=false; await refresh(); }
});

chrome.runtime.onMessage.addListener(msg=>{
  if(msg.type==='WORKBENCH_LOG') addLog(msg.message,msg.level||'info');
});

refresh();
