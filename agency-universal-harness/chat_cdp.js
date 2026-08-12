globalThis.AUH_CHAT_CDP = (() => {
  const PROTOCOL_VERSION = '1.3';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function command(debuggee, method, params = {}) {
    return chrome.debugger.sendCommand(debuggee, method, params);
  }

  async function key(debuggee, type, keyName, code, vk, modifiers = 0) {
    return command(debuggee, 'Input.dispatchKeyEvent', {
      type,
      key: keyName,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers
    });
  }

  async function replaceFocusedTextAndSend(tabId, text) {
    const debuggee = { tabId };
    let attached = false;
    try {
      await chrome.debugger.attach(debuggee, PROTOCOL_VERSION);
      attached = true;

      // The content script focuses the ChatGPT composer before this call.
      // Clear it with trusted keyboard events so React/ProseMirror receives real input.
      await key(debuggee, 'keyDown', 'a', 'KeyA', 65, 2);
      await key(debuggee, 'keyUp', 'a', 'KeyA', 65, 2);
      await key(debuggee, 'keyDown', 'Backspace', 'Backspace', 8);
      await key(debuggee, 'keyUp', 'Backspace', 'Backspace', 8);
      await sleep(40);

      await command(debuggee, 'Input.insertText', { text: String(text || '') });
      await sleep(80);

      // Trusted Enter. Do not auto-retry this mutation if its postcondition is uncertain.
      await key(debuggee, 'keyDown', 'Enter', 'Enter', 13);
      await key(debuggee, 'keyUp', 'Enter', 'Enter', 13);
      return { ok: true, dispatched: true };
    } catch (err) {
      const message = String(err?.message || err);
      if (/Another debugger|already attached|Cannot attach/i.test(message)) {
        throw new Error('CHATGPT_CDP_ATTACH_FAILED_CLOSE_DEVTOOLS');
      }
      throw new Error(`CHATGPT_CDP_INPUT_FAILED:${message}`);
    } finally {
      if (attached) await chrome.debugger.detach(debuggee).catch(() => {});
    }
  }

  return { replaceFocusedTextAndSend };
})();
