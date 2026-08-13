/*
 * Deterministic ChatGPT transport adapted from Agency Browser Bridge 9.3/9.4.
 * It replaces only askChatGPT(). Browser Harness target execution remains unchanged.
 */
(() => {
  const {flat, requestTurnIndex, assistantFragmentsAfterRequest, parseAssistantFragments} = BH_CHAT94;
  const sleepLocal = ms => new Promise(r => setTimeout(r, ms));
  const parseFragments = (fragments, requestId, marker, requireMarker=true) =>
    parseAssistantFragments(fragments, requestId, marker, BH_PLANNER.extractJson, requireMarker);

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

  async function pageRecovery(chatDriver, requestId, marker) {
    try {
      const page = await chatDriver.read({maxChars:250000, tail:true});
      return parseFragments([String(page?.text || '')], requestId, marker, false);
    } catch { return null; }
  }

  async function waitAnchoredResponse(state, chatTab, chatDriver, requestId, marker, timeoutMs = 180000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await assertPinnedConversation(state, chatTab.id);
      const current = await chatState(chatTab.id);
      const fragments = assistantFragmentsAfterRequest(current.turns || [], requestId);
      const obj = parseFragments(fragments, requestId, marker, true);
      if (obj) return obj;
      await sleepLocal(450);
    }

    // Never resend here: submission was already confirmed.
    const finalState = await chatState(chatTab.id);
    const fragments = assistantFragmentsAfterRequest(finalState.turns || [], requestId);
    const recovered = parseFragments(fragments, requestId, marker, false);
    if (recovered) return recovered;

    // Independent final path: read the full visible ChatGPT page. This covers
    // DOM turn virtualization/selector drift and also uses malformed-fill recovery.
    const pageRecovered = await pageRecovery(chatDriver, requestId, marker);
    if (pageRecovered) return pageRecovered;

    const requestIndex = requestTurnIndex(finalState.turns || [], requestId);
    const chars = fragments.reduce((sum, x) => sum + String(x || '').length, 0);
    const markerSeen = fragments.some(x => String(x || '').includes(marker));
    throw new Error(`CHATGPT_RESPONSE_NOT_FOUND_FOR_REQUEST:req=${requestIndex}:fragments=${fragments.length}:chars=${chars}:marker=${markerSeen?1:0}`);
  }

  askChatGPT = async function(state, prompt, requestId) {
    const {chatTab,chatDriver} = await validateBindings(state);
    await assertPinnedConversation(state, chatTab.id);
    const marker = `ABH_JSON_DONE_${String(requestId).replace(/[^A-Za-z0-9_-]/g,'_')}`;
    const transportPrompt = [
      String(prompt),
      '',
      `TRANSPORT_COMPLETION_MARKER=${marker}`,
      `Your control JSON MUST include the top-level field \"completionMarker\":\"${marker}\" exactly.`,
      'IMPORTANT FOR FILL WITH LONG OR FREE-FORM TEXT: do NOT put the prose in action.value.',
      'Instead use action.textBlockId:"BODY" in the JSON, then after the JSON output exactly:',
      '<<<ABH_TEXT:BODY>>>',
      '<raw text to insert; quotes and line breaks are allowed here>',
      '<<<ABH_END_TEXT:BODY>>>'
    ].join('\n');

    const existing = await chatState(chatTab.id);
    if (requestTurnIndex(existing.turns || [], requestId) >= 0) {
      const recovered = parseFragments(assistantFragmentsAfterRequest(existing.turns || [], requestId), requestId, marker, false);
      if (recovered) return recovered;
      const pageRecovered = await pageRecovery(chatDriver, requestId, marker);
      if (pageRecovered) return pageRecovered;
      return waitAnchoredResponse(state, chatTab, chatDriver, requestId, marker);
    }

    await prepareComposer(chatTab.id, transportPrompt, chatDriver);
    await sendOnceAndConfirm(state, chatTab, chatDriver, transportPrompt, requestId);
    return waitAnchoredResponse(state, chatTab, chatDriver, requestId, marker);
  };
})();
