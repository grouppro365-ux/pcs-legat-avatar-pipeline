(() => {
  if (window.__agencyChatBridgeLoaded) return;
  window.__agencyChatBridgeLoaded = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function composer() {
    return document.querySelector('[data-testid="prompt-textarea"]') ||
      document.querySelector('#prompt-textarea') ||
      document.querySelector('textarea') ||
      [...document.querySelectorAll('[contenteditable="true"]')].find(el => el.offsetParent !== null);
  }

  function sendButton() {
    return document.querySelector('[data-testid="send-button"]') ||
      [...document.querySelectorAll('button')].find(b => /send|отправ/i.test(`${b.getAttribute('aria-label')||''} ${b.textContent||''}`) && b.offsetParent !== null);
  }

  function assistantMessages() {
    const exact=[...document.querySelectorAll('[data-message-author-role="assistant"]')];
    if (exact.length) return exact;
    return [...document.querySelectorAll('article')].filter(x => /assistant|chatgpt/i.test(x.getAttribute('data-testid')||''));
  }

  function setComposer(el, text) {
    el.focus();
    if (el.matches('textarea,input')) {
      const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const desc=Object.getOwnPropertyDescriptor(proto,'value');
      desc?.set?.call(el,text);
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return;
    }
    if (el.isContentEditable) {
      el.innerHTML='';
      el.textContent=text;
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
      return;
    }
    throw new Error('Не найден поддерживаемый composer ChatGPT.');
  }

  async function waitForComposer(timeout=15000) {
    const end=Date.now()+timeout;
    while(Date.now()<end){
      const el=composer();
      if(el) return el;
      await sleep(250);
    }
    throw new Error('Поле ввода ChatGPT не найдено.');
  }

  async function waitForAnswer(beforeCount, timeout=120000) {
    const end=Date.now()+timeout;
    let last='';
    let stableAt=0;
    while(Date.now()<end){
      const msgs=assistantMessages();
      if(msgs.length>beforeCount){
        const text=(msgs[msgs.length-1].innerText||msgs[msgs.length-1].textContent||'').trim();
        if(text && text===last){
          if(!stableAt) stableAt=Date.now();
          if(Date.now()-stableAt>1500) return text;
        }else{
          last=text;
          stableAt=Date.now();
        }
      }
      await sleep(350);
    }
    throw new Error('Ответ ChatGPT не получен за 120 секунд.');
  }

  async function ask(prompt) {
    const before=assistantMessages().length;
    const el=await waitForComposer();
    setComposer(el,prompt);
    await sleep(150);
    const btn=sendButton();
    if(btn && !btn.disabled) btn.click();
    else {
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
      el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
    }
    return await waitForAnswer(before);
  }

  chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
    (async()=>{
      if(msg.type==='CHATGPT_PING') return {ok:true,version:'0.3.1',location:`${location.origin}${location.pathname}`};
      if(msg.type==='CHATGPT_ASK') {
        const text=await ask(String(msg.prompt||''));
        return {ok:true,text,requestId:msg.requestId};
      }
      return {ok:false,error:'Unknown message'};
    })().then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message||String(e)}));
    return true;
  });
})();
