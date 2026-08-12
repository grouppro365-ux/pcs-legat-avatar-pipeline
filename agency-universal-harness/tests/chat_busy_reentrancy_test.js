const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'chatgpt_adapter.js'), 'utf8');

const pinnedPath = '/c/test-conversation';
const userTurns = [];
const assistantTurns = [];
let runtimeListener = null;
let secondAskResponse = null;
let firstResultSeen = false;

const composer = {
  scrollIntoView() {},
  focus() {},
  getBoundingClientRect() { return {width: 500, height: 80}; },
  closest() { return null; }
};

function turn(text) {
  return {innerText: text, textContent: text};
}

function makePort() {
  const messageListeners = [];
  const disconnectListeners = [];
  return {
    onMessage: { addListener(fn) { messageListeners.push(fn); } },
    onDisconnect: { addListener(fn) { disconnectListeners.push(fn); } },
    postMessage(msg) {
      userTurns.push(turn(`REQUEST ${msg.requestId}`));
      assistantTurns.push(turn(`${msg.requestId}\n{"requestId":"${msg.requestId}","status":"act","action":{"type":"wait","timeoutMs":250},"reason":"test"}`));
      setTimeout(() => messageListeners.forEach(fn => fn({ok:true})), 0);
    },
    disconnect() {}
  };
}

const chrome = {
  runtime: {
    lastError: null,
    connect() { return makePort(); },
    onMessage: { addListener(fn) { runtimeListener = fn; } },
    async sendMessage(payload) {
      if (payload?.type === 'AUH_CHAT_RESULT' && payload.requestId === 'req_1' && !firstResultSeen) {
        firstResultSeen = true;
        // Reproduce the live race: while the first result is still being handled,
        // the service worker asks for the next step before this sendMessage resolves.
        runtimeListener({
          type: 'AUH_CHAT_ASK',
          requestId: 'req_2',
          prompt: 'REQUEST_ID=req_2',
          pinnedPath
        }, {}, response => { secondAskResponse = response; });
        await new Promise(r => setTimeout(r, 20));
      }
      return {ok:true};
    }
  }
};

const document = {
  querySelector(sel) { return sel === '#prompt-textarea' ? composer : null; },
  querySelectorAll(sel) {
    if (sel === '[data-message-author-role="user"]') return userTurns;
    if (sel === '[data-message-author-role="assistant"]') return assistantTurns;
    if (sel === '[contenteditable="true"]') return [composer];
    return [];
  }
};

const context = {
  chrome,
  document,
  location: {pathname: pinnedPath},
  setTimeout,
  clearTimeout,
  console,
  Promise,
  Array,
  String,
  Date,
  Error,
  RegExp
};

vm.runInNewContext(source, context, {filename:'chatgpt_adapter.js'});
if (typeof runtimeListener !== 'function') throw new Error('runtime listener not registered');

let firstAccepted = null;
runtimeListener({
  type:'AUH_CHAT_ASK',
  requestId:'req_1',
  prompt:'REQUEST_ID=req_1',
  pinnedPath
}, {}, response => { firstAccepted = response; });

if (!firstAccepted?.ok) throw new Error(`first request was not accepted: ${JSON.stringify(firstAccepted)}`);

(async () => {
  const deadline = Date.now() + 5000;
  while (!secondAskResponse && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  if (!secondAskResponse) throw new Error('second request was never attempted during first result handling');
  if (!secondAskResponse.ok) throw new Error(`reentrant next step rejected: ${JSON.stringify(secondAskResponse)}`);
  if (secondAskResponse.error === 'CHATGPT_BUSY') throw new Error('regression: second step hit CHATGPT_BUSY');
  console.log('PASS: next ChatGPT step is accepted while previous RESULT sendMessage is still resolving');
})().catch(err => { console.error(err); process.exit(1); });
