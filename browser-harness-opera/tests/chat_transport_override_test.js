const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const protocolSrc = fs.readFileSync(path.join(__dirname,'..','chat_protocol_v94.js'),'utf8');
const transportSrc = fs.readFileSync(path.join(__dirname,'..','chat_transport_v94.js'),'utf8');
const planner = require('../planner_protocol.js');

const requestId = 'req_override_live';
const marker = 'ABH_JSON_DONE_req_override_live';
const responseObject = {
  requestId,
  status:'act',
  completionMarker:marker,
  action:{type:'click',target:{role:'button',name:'Продолжить'}}
};
const turns = [
  {role:'user',text:`REQUEST_ID=${requestId}`},
  {role:'assistant',text:'Working…'},
  {role:'assistant',text:JSON.stringify(responseObject)}
];

let sendCount = 0;
const context = {
  console,
  setTimeout,
  clearTimeout,
  BH_PLANNER: planner,
  chatPath: url => new URL(url).pathname.match(/^\/c\/[^/?#]+/)?.[0] || '',
  chrome: {
    tabs: {
      get: async id => ({id,url:'https://chatgpt.com/c/test'}),
      sendMessage: async (_id,msg) => {
        if (msg.type === 'ABH_CHAT_STATE_V94') return {ok:true,url:'https://chatgpt.com/c/test',composer:'',turns};
        sendCount += 1;
        return {ok:true};
      }
    },
    scripting:{executeScript:async()=>{throw new Error('must not reinject in recovery path');}},
    debugger:{attach:async()=>{},sendCommand:async()=>{},detach:async()=>{}}
  },
  validateBindings: async () => ({chatTab:{id:7,url:'https://chatgpt.com/c/test'},chatDriver:{}}),
  composerProxy: async () => { throw new Error('composer must not be touched when answer already exists'); },
  trustedEnter: async () => { throw new Error('send must not happen when answer already exists'); }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext('async function askChatGPT(){ return "OLD_TRANSPORT"; }', context);
vm.runInContext(protocolSrc, context);
vm.runInContext(transportSrc, context);

(async()=>{
  const result = await vm.runInContext(`askChatGPT({chat:{path:'/c/test'}}, 'ignored prompt', '${requestId}')`, context);
  assert.equal(result.requestId, requestId);
  assert.equal(result.action.type, 'click');
  assert.equal(sendCount, 0, 'existing completed request must not be resent');
  console.log('chat_transport_override_test PASS');
})().catch(err=>{console.error(err);process.exit(1);});
