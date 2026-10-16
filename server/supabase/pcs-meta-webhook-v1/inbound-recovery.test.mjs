import test from 'node:test';
import assert from 'node:assert/strict';
import {generationIdentity,recoverableEvent,generationDisposition} from './inbound-recovery.mjs';
import {hasAutomaticAuthority,mayAutoSendHubReply} from './channel-policy.mjs';
test('generation identity converges by exact channel and source message, not retry event envelope',async()=>{
 assert.equal(await generationIdentity('instagram','one'),await generationIdentity('instagram','one'));
 assert.notEqual(await generationIdentity('instagram','one'),await generationIdentity('facebook','one'));
 assert.match(await generationIdentity('instagram','one'),/^[\da-f]{8}-[\da-f]{4}-8[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
});
test('failed ingress and expired claims recover; processed and active claims do not',()=>{
 const now=Date.parse('2026-10-16T00:00:00Z');
 assert.equal(recoverableEvent({status:'failed'},now),true);
 for(const status of ['processed','sent','sending','delivery_uncertain'])assert.equal(recoverableEvent({status,received_at:'2020-01-01'},now),false);
 assert.equal(recoverableEvent({status:'processing',received_at:'2020-01-01',payload:{started_at:'2026-10-15T23:59:30Z'}},now),false);
 assert.equal(recoverableEvent({status:'processing',received_at:'2020-01-01'},now),true);
});
test('provider confidence or configured threshold cannot grant automatic business authority',()=>{
 const connection={enabled:true,status:'active'};
 for(const generated of [{provider:'openrouter',model:'gpt',autoSend:true,confidence:1},{provider:'deterministic',model:'unknown',autoSend:true,confidence:1},{provider:'deterministic',model:'social-greeting',autoSend:true,confidence:null}]){
  assert.equal(hasAutomaticAuthority(generated),false);assert.equal(mayAutoSendHubReply({connection,replyMode:'auto',generated}),false);
 }
 assert.equal(mayAutoSendHubReply({connection,replyMode:'auto',generated:{provider:'deterministic',model:'social-greeting',autoSend:true,confidence:1}}),true);
});
test('receipt replay may send only a fresh authorized existing generation; old offers and changed policy go to operator',()=>{
 const now=Date.parse('2026-10-16T00:00:00Z'),record={status:'failed',policy_decision:'auto',requires_human:false,created_at:'2026-10-15T23:59:00Z'};
 assert.equal(generationDisposition(record,{now,autoAllowed:true}),'send');
 assert.equal(generationDisposition(record,{now,autoAllowed:false}),'approval');
 assert.equal(generationDisposition({...record,created_at:'2026-10-15T00:00:00Z'},{now,autoAllowed:true}),'approval');
 assert.equal(generationDisposition({...record,status:'sent'},{now,autoAllowed:false}),'sent');
 assert.equal(generationDisposition({...record,status:'approval_required'},{now,autoAllowed:true}),'approval');
});
