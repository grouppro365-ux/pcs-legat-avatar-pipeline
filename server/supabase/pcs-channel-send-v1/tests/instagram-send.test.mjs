import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function meta(');
const end = source.indexOf('\nlet botHelpToken', start);
assert.ok(start >= 0 && end > start, 'test executes the production Meta transport');
const code = source.slice(start, end).replace(/: string\b/g, '').replace(/: any\b/g, '');

test('Instagram rejects success envelopes without a valid message id and preserves valid acknowledgements', async () => {
  for (const payload of [{}, {message_id:''}, {message_id:42}, {message_id:{}}, {messages:[{id:'wrong-provider'}]}]) {
    let calls=0;
    const context=vm.createContext({secret:async()=> 'test-only-token', fetchWithRetry:async()=> {calls++; return payload;}});
    vm.runInContext(code, context);
    await assert.rejects(context.meta('instagram','123','Test',{instagram_account_id:'456',api_login:'instagram_login'}), /instagram_delivery_unconfirmed/);
    assert.equal(calls,1, 'ambiguous acknowledgement must not trigger resend');
  }
  let sentRequest;
  const context=vm.createContext({secret:async()=> 'test-only-token', fetchWithRetry:async(url,init)=> {sentRequest={url,init}; return {message_id:'ig-message-123'};}});
  vm.runInContext(code, context);
  const result=await context.meta('instagram','123','Test',{instagram_account_id:'456',api_login:'instagram_login'});
  assert.equal(result.id,'ig-message-123');
  assert.equal(sentRequest.url,'https://graph.instagram.com/v23.0/456/messages');
  assert.deepEqual(JSON.parse(sentRequest.init.body),{recipient:{id:'123'},message:{text:'Test'}});
});
