import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import * as local from './instagram-local.mjs';
import * as policy from './channel-policy.mjs';

test('claim latency does not invalidate a newly issued five-minute job', async (t) => {
  const secret='synthetic-key-012345678901234567890123456789';
  const now=1790856000000,stamp=String(now/1000);
  let elapsed=0;
  t.mock.method(Date,'now',()=>now+elapsed);
  const input=JSON.stringify({action:'claim',account_id:'1',request_id:'11111111-1111-4111-8111-111111111111'});
  const headers=new Headers({'x-pcs-local-timestamp':stamp,'x-pcs-local-signature':createHmac('sha256',secret)
    .update(`pcs-instagram-outbox-v1\n${stamp}\n${input}`).digest('hex')});
  const response=await local.receiveLocalOutbox({bytes:new TextEncoder().encode(input),headers,now,
    config:{enabled:true,outgoing_enabled:true,account_id:'1',hmac_secret:secret},
    store:{claim:async()=>{elapsed=2000;return {claim_id:'33333333-3333-4333-8333-333333333333',
      job:{generation_id:'22222222-2222-4222-8222-222222222222',account_id:'1',thread_id:'12',recipient_id:'2',
        text:'Test reply',approved:true,expires_at:now/1000+302}};}}});
  assert.equal(response.status,200);
});

test('signed claim issues an account-bound job without marking it sent', async () => {
  assert.equal(typeof local.receiveLocalOutbox, 'function', 'PCS must expose the authenticated outgoing queue');
  const secret='synthetic-key-012345678901234567890123456789';
  const now=1790856000000, stamp=String(now/1000);
  const input=JSON.stringify({action:'claim',account_id:'1',request_id:'11111111-1111-4111-8111-111111111111'});
  const headers=new Headers({'x-pcs-local-timestamp':stamp,'x-pcs-local-signature':createHmac('sha256',secret)
    .update(`pcs-instagram-outbox-v1\n${stamp}\n${input}`).digest('hex')});
  const job={generation_id:'22222222-2222-4222-8222-222222222222',account_id:'1',thread_id:'12',recipient_id:'2',
    text:'Test reply',approved:true,expires_at:now/1000+300};
  let acknowledgements=0;
  const response=await local.receiveLocalOutbox({bytes:new TextEncoder().encode(input),headers,now,
    config:{enabled:true,outgoing_enabled:true,account_id:'1',hmac_secret:secret},
    store:{claim:async()=>({job,claim_id:'33333333-3333-4333-8333-333333333333'}),ack:async()=>{acknowledgements++;}}});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.deepEqual(JSON.parse(result.job.body),job);
  assert.equal(result.job.signature,createHmac('sha256',secret).update('pcs-instagram-outbound-v1\n'+result.job.body).digest('hex'));
  assert.equal(acknowledgements,0);
});

test('local automatic replies require activation, fresh input and safe AI policy', () => {
  assert.equal(typeof policy.mayQueueLocalReply,'function');
  const config={enabled:true,outgoing_enabled:true,account_id:'1',outgoing_since:'2026-10-01T12:00:00Z',pilot_recipient_ids:['2']};
  const row={account:'instagrapi:1',external_user_id:'instagrapi:1:2',timestamp:Date.parse('2026-10-01T12:01:00Z')};
  const generated={autoSend:true,model:'car-rental-qualification-v1',confidence:1};
  const args={config,connection:{enabled:true,status:'active',public_config:{reply_mode:'auto'}},row,generated,risk:null};
  assert.equal(policy.mayQueueLocalReply(args),true);
  for(const change of [{config:{...config,outgoing_enabled:false}}, {config:{...config,outgoing_since:null}},
    {row:{...row,timestamp:1}}, {row:{...row,external_user_id:'instagrapi:1:3'}},
    {generated:{...generated,autoSend:false}}, {generated:{...generated,confidence:0.89}},
    {generated:{...generated,model:'safe-fallback'}}, {risk:'partner_confirmation_required'}]) {
    assert.equal(policy.mayQueueLocalReply({...args,...change}),false);
  }
});

test('a durably queued answer is acknowledged as pending, never delivered', async () => {
  const secret='synthetic-key-012345678901234567890123456789';
  const now=1790856000000,stamp=String(now/1000);
  const input=JSON.stringify({channel:'instagram',account:'instagrapi:1',message_id:'instagrapi:1:9',
    conversation_id:'instagrapi:1:12',external_user_id:'instagrapi:1:2',text:'hello',timestamp:now,kind:'text',
    name:'Test',attachments:[]});
  const response=await local.receiveLocalInstagram({bytes:new TextEncoder().encode(input),now,
    headers:new Headers({'x-pcs-local-timestamp':stamp,'x-pcs-local-signature':createHmac('sha256',secret)
      .update(`pcs-instagram-local-v1\n${stamp}\n${input}`).digest('hex')}),
    config:{enabled:true,account_id:'1',hmac_secret:secret},
    store:{claim:async(id,digest)=>({id,status:'new',digest}),complete:async()=>{},fail:async()=>{}},
    process:async()=>({action:'pending_send',generation_id:'22222222-2222-4222-8222-222222222222'})});
  assert.equal(response.status,200);
  assert.equal((await response.json()).action,'pending_send');
});
