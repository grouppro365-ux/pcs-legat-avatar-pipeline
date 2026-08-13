(() => {
  if (globalThis.__ABH_CHAT_TURNS_CLIENT__) return;
  globalThis.__ABH_CHAT_TURNS_CLIENT__ = true;

  const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function composer() {
    return document.querySelector('#prompt-textarea') ||
      [...document.querySelectorAll('[contenteditable="true"],[role="textbox"],textarea')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).at(-1) || null;
  }

  function composerText() {
    const el = composer();
    if (!el) return '';
    if (el.isContentEditable) return norm(el.innerText || el.textContent || '');
    return String(el.value ?? '');
  }

  function bestText(root) {
    const candidates = [root];
    for (const sel of ['[data-message-content]','.markdown','.prose','[class*="markdown"]','[class*="prose"]']) {
      try { candidates.push(...root.querySelectorAll(sel)); } catch {}
    }
    let best = '';
    for (const node of candidates) {
      const text = norm(node?.innerText || node?.textContent || '');
      if (text.length > best.length) best = text;
    }
    return best;
  }

  function roleFor(root) {
    const direct = root.getAttribute?.('data-message-author-role');
    if (direct) return direct;
    const nested = root.querySelector?.('[data-message-author-role]');
    const nestedRole = nested?.getAttribute?.('data-message-author-role');
    if (nestedRole) return nestedRole;
    const aria = norm(root.getAttribute?.('aria-label')).toLowerCase();
    if (/assistant|chatgpt/.test(aria)) return 'assistant';
    if (/you|user|вы/.test(aria)) return 'user';
    return '';
  }

  function logicalTurns() {
    let nodes = [];
    try {
      nodes = [...document.querySelectorAll([
        '[data-message-author-role]',
        '[data-testid^="conversation-turn"]',
        '[data-testid*="conversation-turn"]',
        '[data-turn]',
        'article'
      ].join(','))];
    } catch {}

    const raw = [];
    for (const node of nodes) {
      const role = roleFor(node);
      if (!role) continue;
      const text = bestText(node);
      if (!text) continue;
      raw.push({role, text});
    }

    // ChatGPT may expose both an outer turn wrapper and an inner role node.
    // Preserve DOM order while collapsing identical logical turns only when adjacent.
    const turns = [];
    for (const turn of raw) {
      const last = turns.at(-1);
      if (last && last.role === turn.role && last.text === turn.text) continue;
      if (last && last.role === turn.role && (last.text.includes(turn.text) || turn.text.includes(last.text))) {
        if (turn.text.length > last.text.length) turns[turns.length - 1] = turn;
        continue;
      }
      turns.push(turn);
    }
    return turns.slice(-80);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'ABH_CHAT_STATE_V94') return;
    try {
      sendResponse({ok:true,url:location.href,composer:composerText(),turns:logicalTurns()});
    } catch (err) {
      sendResponse({ok:false,error:String(err?.message || err)});
    }
    return false;
  });
})();
