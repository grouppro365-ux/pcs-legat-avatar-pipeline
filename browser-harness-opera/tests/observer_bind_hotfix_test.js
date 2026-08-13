const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'observer_bind_hotfix.js'), 'utf8');

function makeContext({healthyInitially=false}={}) {
  let reloaded = false;
  let sendCalls = 0;
  let reloadCalls = 0;
  let injectCalls = 0;
  const url = 'https://chatgpt.com/c/6a7b4d02-36a4-83eb-8c6c-2ea0d560b0a2';
  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    Promise,
    globalThis: null,
    chrome: {
      tabs: {
        async sendMessage(_tabId, msg) {
          assert.equal(msg.type, 'ABH_CHAT_OBSERVER_PING');
          sendCalls++;
          if (healthyInitially) return {ok:true,path:'/c/6a7b4d02-36a4-83eb-8c6c-2ea0d560b0a2'};
          if (reloaded) return {ok:true,path:'/c/6a7b4d02-36a4-83eb-8c6c-2ea0d560b0a2'};
          throw new Error('Receiving end does not exist');
        },
        async get(tabId) {
          assert.equal(tabId, 77);
          return {id:77,url,status:'complete'};
        },
        async reload(tabId) {
          assert.equal(tabId,77);
          reloadCalls++;
          reloaded = true;
        }
      },
      scripting: {
        async executeScript(opts) {
          assert.equal(opts.target.tabId,77);
          injectCalls++;
          return [];
        }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, {filename:'observer_bind_hotfix.js'});
  return {context, stats:()=>({reloaded,sendCalls,reloadCalls,injectCalls})};
}

(async()=>{
  {
    const {context,stats}=makeContext({healthyInitially:true});
    const result=await context.ensureChatObserver(77);
    assert.equal(result.bindRecovery,'none');
    assert.equal(result.harnessVersion,'0.3.1');
    assert.equal(stats().reloadCalls,0);
  }
  {
    const {context,stats}=makeContext();
    const result=await context.ensureChatObserver(77);
    assert.equal(result.bindRecovery,'reloaded');
    assert.equal(result.harnessVersion,'0.3.1');
    assert.equal(stats().reloadCalls,1);
    assert(stats().injectCalls >= 2, 'planner + observer reinjection attempted before reload');
    assert(stats().sendCalls >= 3, 'handshake retried after reload');
  }
  console.log('observer_bind_hotfix_test PASS');
})().catch(err=>{console.error(err);process.exit(1);});
