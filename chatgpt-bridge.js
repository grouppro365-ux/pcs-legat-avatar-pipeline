(() => {
  if (globalThis.__AGENCY_CHAT_BRIDGE_V03__) return;
  globalThis.__AGENCY_CHAT_BRIDGE_V03__ = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => String(s ?? '').replace(/\s+/g,' ').trim();
  const conversationKey = () => `${location.origin}${location.pathname}`;

  function assistantNodes() {
    return [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  }

  function stopVisible() {
    return !!document.querySelector('button[data-testid="stop-button"],button[aria-label*="Stop" i],button[aria-label*="Останов" i]');
  }

  function findComposer() {
    const selectors = [
      '#prompt-textarea',
      'textarea[data-id="root"]',
      'form textarea',
      'form [contenteditable="true"]',
      '[contenteditable="true"][data-testid*="composer" i]',
      '[contenteditable="true"]'
    ];
    for (const s of selectors) {
      const list = [...document.querySelectorAll(s)];
      const el = list.find(x => {
        const r=x.getBoundingClientRect(); const st=getComputedStyle(x);
        return r.width>0 && r.height>0 && st.visibility!=='hidden' && st.display!=='none';
      });
      if (el) return el;
    }
    return null;
  }

  function currentComposerText(el) {
    if (!el) return '';
    if ('value' in el) return String(el.value || '');
    return clean(el.innerText || el.textContent || '');
  }

  async function setComposerText(text) {
    const el = findComposer();
    if (!el) throw new Error('Не найдено поле ввода ChatGPT. Обновите вкладку ChatGPT и повторите тест.');
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto,'value')?.set;
      setter ? setter.call(el,text) : (el.value=text);
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
    } else if (el.isContentEditable) {
      const sel = getSelection(); const range = document.createRange(); range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
      document.execCommand('delete', false);
      if (!document.execCommand('insertText', false, text)) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
      }
    } else throw new Error('Неподдерживаемый composer ChatGPT.');
    await sleep(150);
    if (!currentComposerText(el).includes(text.slice(0, Math.min(40,text.length)))) {
      throw new Error('Текст не попал в поле ChatGPT.');
    }
    return el;
  }

  function findSendButton(composer) {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Отправ" i]',
      'button[type="submit"]'
    ];
    for (const s of selectors) {
      const root = composer.closest('form') || document;
      const btn = [...root.querySelectorAll(s)].find(b => !b.disabled && b.getAttribute('aria-disabled') !== 'true' && b.getBoundingClientRect().width>0);
      if (btn) return btn;
    }
    return null;
  }

  async function submitPrompt(prompt) {
    const before = assistantNodes().length;
    const composer = await setComposerText(prompt);
    let btn = findSendButton(composer);
    for (let i=0; i<10 && !btn; i++) { await sleep(120); btn=findSendButton(composer); }
    if (!btn) throw new Error('Не найдена активная кнопка отправки ChatGPT.');
    btn.click();
    return before;
  }

  async function waitForAnswer(beforeCount, timeoutMs = 150000) {
    const start = Date.now();
    let stableText=''; let stableTicks=0; let sawNew=false;
    while (Date.now()-start < timeoutMs) {
      const nodes = assistantNodes();
      if (nodes.length > beforeCount) sawNew = true;
      if (sawNew) {
        const node = nodes[nodes.length-1];
        const text = clean(node?.innerText || node?.textContent || '');
        if (text && text === stableText && !stopVisible()) stableTicks++;
        else { stableText=text; stableTicks=0; }
        if (stableText && stableTicks >= 3) return stableText;
      }
      await sleep(500);
    }
    throw new Error('ChatGPT не ответил за 150 секунд.');
  }

  async function ask(prompt) {
    if (!/chatgpt\.com$|chat\.openai\.com$/i.test(location.hostname)) throw new Error('Bridge запущен не на ChatGPT.');
    const before = await submitPrompt(prompt);
    const answer = await waitForAnswer(before);
    return { answer, conversationKey: conversationKey() };
  }

  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse) => {
    (async()=>{
      try {
        if (msg?.type==='AGENCY_CHAT_PING') return sendResponse({ok:true,version:'0.3.0',conversationKey:conversationKey(),composer:!!findComposer()});
        if (msg?.type==='AGENCY_CHAT_ASK') {
          const result=await ask(String(msg.prompt||''));
          return sendResponse({ok:true,requestId:msg.requestId||'',...result});
        }
        return sendResponse({ok:false,error:'Unknown chat bridge message'});
      } catch(e) { sendResponse({ok:false,error:String(e?.message||e),conversationKey:conversationKey()}); }
    })();
    return true;
  });
})();
