/*
 * Deterministic ChatGPT transport adapted from the proven Agency Browser Bridge 9.3/9.4 protocol.
 * It replaces only askChatGPT(). Browser Harness target execution remains unchanged.
 */
(() => {
  const flat = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const sleepLocal = ms => new Promise(r => setTimeout(r, ms));

  async function chatState(tabId) {
    let result = null;
    try { result = await chrome.tabs.sendMessage(tabId, {type:'ABH_CHAT_STATE_V94'}); } catch {}
    if (!result?.ok) {
      await chrome.scripting.executeScript({target:{tabId},files:['chat_turns_client.js']});
      result = await chrome.tabs.sendMessage(tabId, {type:'ABH_CHAT_STATE_V94'});
    }
    if (!result?.ok) throw new Error(result?.error || 'CHAT_TURN_READER_NOT_READY');
    return result;
  }

  async function assertPinnedConversation(state, tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('BOUND_CHAT_TAB_CLOSED');
    if (chatPath(tab.url || '') !== state.chat?.path) throw new Error('SAFETY_CHAT_SWITCH');
    return tab;
  }

  function requestTurnIndex(turns, requestId) {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i]?.role === 'user' && String(turns[i]?.text || '').includes(requestId)) return i;
    }
    return -1;
  }

  function assistantFragmentsAfterRequest(turns, requestId) {
    const start = requestTurnIndex(turns, requestId);
    if (start < 0) return [];
    const out = [];
    for (let i = start + 1; i < turns.length; i += 1) {
      const turn = turns[i];
      if (turn?.role === 'user') break;
      if (turn?.role === 'assistant' && String(turn.text || '').trim()) out.push(String(turn.text));
    }
    return out;
  }

  function parseAssistantFragments(fragments, requestId, marker, requireMarker = true) {
    if (!fragments.length) return null;
    if (requireMarker && !fragments.some(text => text.includes(marker))) return null;
    const candidates = [...fragments].reverse();
    candidates.push(fragments.join('\n'));
    for (const text of candidates) {
      try {
        const obj = BH_PLANNER.extractJson(text, requestId);
        if (obj?.requestId === requestId) return obj;
      } catch {}
    }
    return null;
  }

  async function dispatchKey(target, payload) {
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', payload);
  }

  async function trustedReplaceComposer(tabId, prompt, chatDriver) {
    const composer = await composerProxy(chatDriver);
    await composer.focus();
    const target = {tabId};
    await chrome.debugger.attach(target, '1.3');
    try {
      await chrome.debugger.sendCommand(target, 'Page.bringToFront');
      const a = {key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65,modifiers:2};
      await dispatchKey(target,{type:'rawKeyDown',...a});
      await dispatchKey(target,{type:'keyUp',...a});
      const back = {key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8};
      await dispatchKey(target,{type:'rawKeyDown',...back});
      await dispatchKey(target,{type:'keyUp',...back});
      await chrome.debugger.sendCommand(target,'Input.insertText',{text:String(prompt)});
    } finally {
      await chrome.debugger.detach(target).catch(()=>{});
    }
  }

  async function prepareComposer(tabId, prompt, chatDriver) {
    let trustedError = null;
    try { await trustedReplaceComposer(tabId, prompt, chatDriver); }
    catch (err) { trustedError = err; await (await composerProxy(chatDriver)).fill(prompt); }

    await sleepLocal(180);
    const state = await chatState(tabId);
    if (flat(state.composer) !== flat(prompt)) {
      throw new Error(`CHATGPT_COMPOSER_MISMATCH${trustedError ? ':' + (trustedError.message || trustedError) : ''}`);
    }
  }

  async function sendOnceAndConfirm(state, chatTab, chatDriver, prompt, requestId) {
    let primaryError = null;
    try {
      await (await composerProxy(chatDriver)).focus();
      await trustedEnter(chatTab.id);
    } catch (err) { primaryError = err; }

    const started = Date.now();
    while (Date.now() - started < 7000) {
      await assertPinnedConversation(state, chatTab.id);
      const current = await chatState(chatTab.id);
      const idx = requestTurnIndex(current.turns || [], requestId);
      const inComposer = String(current.composer || '').includes(requestId);
      if (idx >= 0 && !inComposer) return {confirmed:true};
      await sleepLocal(250);
    }

    // A second submit attempt is allowed only while the exact intended prompt is still visibly unsent.
    const afterPrimary = await chatState(chatTab.id);
    if (flat(afterPrimary.composer) === flat(prompt) && requestTurnIndex(afterPrimary.turns || [], requestId) < 0) {
      try {
        const composer = await composerProxy(chatDriver);
        await composer.submit();
      } catch (err) {
        throw new Error(`CHATGPT_SUBMIT_FAILED:${err?.message || err}${primaryError ? '; primary=' + (primaryError.message || primaryError) : ''}`);
      }

      const fallbackStarted = Date.now();
      while (Date.now() - fallbackStarted < 7000) {
        await assertPinnedConversation(state, chatTab.id);
        const current = await chatState(chatTab.id);
        const idx = requestTurnIndex(current.turns || [], requestId);
        const inComposer = String(current.composer || '').includes(requestId);
        if (idx >= 0 && !inComposer) return {confirmed:true,fallback:true};
        await sleepLocal(250);
      }
    }

    const finalState = await chatState(chatTab.id);
    if (requestTurnIndex(finalState.turns || [], requestId) >= 0) return {confirmed:true,composerUncertain:true};
    if (String(finalState.composer || '').includes(requestId)) throw new Error('CHATGPT_SUBMIT_FAILED_PROMPT_STILL_IN_COMPOSER');
    throw new Error('CHATGPT_SUBMIT_UNCERTAIN_NO_RETRY');
  }

  async function waitAnchoredResponse(state, chatTab, requestId, marker, timeoutMs = 180000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await assertPinnedConversation(state, chatTab.id);
      const current = await chatState(chatTab.id);
      const fragments = assistantFragmentsAfterRequest(current.turns || [], requestId);
      const obj = parseAssistantFragments(fragments, requestId, marker, true);
      if (obj) return obj;
      await sleepLocal(450);
    }

    // Final recovery: if the model produced a complete valid JSON but omitted the marker,
    // recover it rather than inventing a false timeout. Never resend the prompt here.
    const finalState = await chatState(chatTab.id);
    const fragments = assistantFragmentsAfterRequest(finalState.turns || [], requestId);
    const recovered = parseAssistantFragments(fragments, requestId, marker, false);
    if (recovered) return recovered;
    throw new Error('CHATGPT_RESPONSE_NOT_FOUND_FOR_REQUEST');
  }

  // Override only the old free-ChatGPT transport. Target Driver/action code remains byte-for-byte stable.
  askChatGPT = async function(state, prompt, requestId) {
    const {chatTab,chatDriver} = await validateBindings(state);
    await assertPinnedConversation(state, chatTab.id);
    const marker = `ABH_JSON_DONE_${String(requestId).replace(/[^A-Za-z0-9_-]/g,'_')}`;
    const transportPrompt = [
      String(prompt),
      '',
      `TRANSPORT_COMPLETION_MARKER=${marker}`,
      `Your single JSON object MUST include the top-level field \"completionMarker\":\"${marker}\" exactly.`
    ].join('\n');

    // Recovery first: if this exact request was already submitted and answered, use it without sending again.
    const existing = await chatState(chatTab.id);
    if (requestTurnIndex(existing.turns || [], requestId) >= 0) {
      const recovered = parseAssistantFragments(assistantFragmentsAfterRequest(existing.turns || [], requestId), requestId, marker, false);
      if (recovered) return recovered;
      return waitAnchoredResponse(state, chatTab, requestId, marker);
    }

    await prepareComposer(chatTab.id, transportPrompt, chatDriver);
    await sendOnceAndConfirm(state, chatTab, chatDriver, transportPrompt, requestId);
    return waitAnchoredResponse(state, chatTab, requestId, marker);
  };
})();
