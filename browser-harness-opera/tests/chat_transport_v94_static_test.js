const assert = require('assert');
const fs = require('fs');
const path = require('path');

const transport = fs.readFileSync(path.join(__dirname,'..','chat_transport_v94.js'),'utf8');
const turns = fs.readFileSync(path.join(__dirname,'..','chat_turns_client.js'),'utf8');
const bootstrap = fs.readFileSync(path.join(__dirname,'..','bootstrap.js'),'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.json'),'utf8'));

assert(transport.includes('flat(afterPrimary.composer) === flat(prompt)'), 'fallback send must require exact composer equality');
assert(transport.includes("requestTurnIndex(current.turns || [], requestId)"), 'send must be confirmed by a real request user-turn');
assert(transport.includes('ABH_JSON_DONE_'), 'request-scoped completion marker required');
assert(transport.includes('CHATGPT_SUBMIT_UNCERTAIN_NO_RETRY'), 'ambiguous submit must safe-stop without duplicate resend');
assert(transport.includes('assistantFragmentsAfterRequest'), 'response must be request-anchored and multi-fragment aware');
assert(transport.includes("Input.insertText"), 'trusted CDP input must be available for composer replacement');
assert(!transport.includes('MutationObserver'), 'stable transport must not reintroduce observer state machine');
assert(!transport.includes('CHATGPT_RESPONSE_TIMEOUT'), 'old false timeout code must not exist in replacement transport');
assert(!/\/send\|отправ\//i.test(transport), 'must not globally guess Send buttons');
assert(turns.includes("[data-message-author-role]"), 'logical turn reader must use role-bearing message nodes');
assert(turns.includes("slice(-80)"), 'logical turn reader must retain a bounded recent turn history');
assert(bootstrap.indexOf("chat_protocol_v94.js") < bootstrap.indexOf("chat_transport_v94.js"), 'protocol helpers must load before transport');
assert(manifest.version === '0.1.3');
assert(manifest.content_scripts.some(x => x.matches?.includes('https://chatgpt.com/*') && x.js?.includes('chat_turns_client.js')));

console.log('chat_transport_v94_static_test PASS');
