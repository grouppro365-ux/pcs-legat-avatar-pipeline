import test from 'node:test';
import assert from 'node:assert/strict';
import {telegramPublication,normalizePublicationText,observeTelegramPublication,verifyContentPublication} from '../server/supabase/pcs-manager-live2/content-publication-verify.mjs';
const url='https://t.me/test_channel/42',text='Confirmed PCS facts\nCafé & terms';
const message=(body,id='42',extra='')=>`<div class="tgme_widget_message text_not_supported_wrap" data-post="test_channel/${id}"><div class="tgme_widget_message_text js-message_text">${body}</div><time datetime="2026-10-20T01:02:03Z"></time>${extra}</div>`;
const html=()=>message('Confirmed PCS facts<br>Cafe&#769; &amp; terms');
const snapshot={publication_url:url,body:text};
const observe=(page,s=snapshot,options={})=>observeTelegramPublication(s,{fetcher:async()=>new Response(page),...options});
test('public permalink validation binds a fixed host, message id, and bounded BigInt pagination',()=>{
 assert.equal(telegramPublication('https://t.me/s/Test_Channel/42/').url,url);
 assert.equal(telegramPublication('https://t.me/test_channel/999999999999999').fetch_url,'https://t.me/s/test_channel?before=1000000000000000');
 for(const bad of ['http://t.me/test_channel/42','https://evil.test/test_channel/42','https://t.me.evil.test/test_channel/42','https://user@t.me/test_channel/42','https://t.me:444/test_channel/42','https://t.me/+invite/42','https://t.me/c/123/42','https://t.me/test_channel/42?embed=1','https://t.me/test_channel/42#x','https://t.me/test_channel/0','https://t.me/test_channel/00042','https://t.me/test_channel/42/../43','https://t.me/test_channel/1234567890123456'])assert.throws(()=>telegramPublication(bad),bad);
});
test('exact text comparison decodes entities and NFC/CRLF/NBSP without erasing content differences',async()=>{
 const result=await observe(html());assert.equal(result.outcome,'TEXT_MATCH');assert.equal(result.expected_sha256,result.observed_sha256);assert.equal(result.message_id,'42');assert.equal(result.published_at,'2026-10-20T01:02:03.000Z');
 assert.equal(normalizePublicationText(' Cafe\u0301\r\n&\u00a0terms '),'Café\n& terms');
 assert.equal((await observe(html(),{...snapshot,body:text+'!'})).outcome,'TEXT_MISMATCH');
 assert.equal((await observe(message('Confirmed PCS facts<br>Café  &amp; terms'))).outcome,'TEXT_MISMATCH');
});
test('fetch is fixed to Telegram with denied redirects and a deadline signal',async()=>{
 const result=await observeTelegramPublication(snapshot,{fetcher:async(target,options)=>{assert.equal(target,'https://t.me/s/test_channel?before=43');assert.equal(options.redirect,'manual');assert.ok(options.signal instanceof AbortSignal);return new Response(html());}});assert.equal(result.outcome,'TEXT_MATCH');
 for(const status of [301,302,307,308]){const r=await observe('',snapshot,{fetcher:async()=>new Response('',{status,headers:{location:'http://169.254.169.254/'}})});assert.equal(r.outcome,'UNREADABLE');assert.equal(r.reason,'redirect_refused');}
});
test('HTTP200 site-unavailable, missing/deleted/other-message/duplicate pages never count as observed',async()=>{
 for(const page of ['<html><title>Site Unavailable</title><body>Site Unavailable</body></html>',message('Different id','43'),'<html>Deleted message</html>',html()+html()]){const r=await observe(page);assert.equal(r.outcome,'UNREADABLE');assert.equal(r.observed_sha256,null);}
});
test('empty text, missing time, nested HTML truncation and parser clipping cannot match a prefix',async()=>{
 for(const page of [message(''),html().replace(/<time[^>]*><\/time>/,''),message('Confirmed PCS facts<div>hidden suffix</div>'),message('x'.repeat(13000)),message('Confirmed PCS facts<span class="js-message_text_more">more</span>')]){const r=await observe(page,{...snapshot,body:'Confirmed PCS facts'});assert.equal(r.outcome,'UNREADABLE');}
});
test('response size is bounded before decoding with length header and streaming chunks',async()=>{
 let cancelled=false;
 const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(100));c.enqueue(new Uint8Array(100));},cancel(){cancelled=true;}});
 const streamed=await observe('',snapshot,{maxBytes:150,fetcher:async()=>new Response(body)});assert.equal(streamed.reason,'page_too_large');assert.equal(cancelled,true);
 const announced=await observe('',snapshot,{maxBytes:50,fetcher:async()=>new Response(html(),{headers:{'content-length':'100'}})});assert.equal(announced.reason,'page_too_large');
});
test('network timeout and HTTP failure stay unreadable',async()=>{
 const timeout=await observe('',snapshot,{timeoutMs:5,fetcher:async(u,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});assert.equal(timeout.reason,'fetch_timeout');assert.equal(timeout.outcome,'UNREADABLE');
 assert.equal((await observe('',snapshot,{fetcher:async()=>new Response('',{status:429})})).outcome,'UNREADABLE');
});
test('canonical command prepares under SQL authority, fetches, then saves evidence to the same version',async()=>{
 const calls=[],b={request_id:'request',id:'post',expected_version:3};
 const result=await verifyContentPublication({query:async(q,args)=>{calls.push([q,args]);if(args[3]===null)return [{result:{ok:true,verification_required:true,snapshot}}];return [{result:{ok:true,id:'post',verification:JSON.parse(args[3]),status:'PUBLICATION_REPORTED'}}];}},b,'actor',['content.approve'],{fetcher:async()=>new Response(html())});
 assert.equal(result.verification.outcome,'TEXT_MATCH');assert.equal(result.status,'PUBLICATION_REPORTED');assert.equal(calls.length,2);assert.deepEqual(calls[0][1].slice(0,3),calls[1][1].slice(0,3));assert.match(calls[1][0],/pcs.content_verify_publication/);
});
test('authorized stored receipt replays without network and changed final version is not hidden',async()=>{
 let fetched=0;const options={fetcher:async()=>{fetched++;return new Response(html());}},b={id:'post'};
 const replay=await verifyContentPublication({query:async()=>[{result:{ok:true,replayed:true,id:'post',verification:{outcome:'UNREADABLE'}}}]},b,'actor',['content.approve'],options);assert.equal(replay.replayed,true);assert.equal(fetched,0);
 let call=0;await assert.rejects(()=>verifyContentPublication({query:async()=>{if(++call===1)return[{result:{ok:true,verification_required:true,snapshot}}];throw Error('content_version_conflict');}},b,'actor',['content.approve'],options),/content_version_conflict/);assert.equal(fetched,1);
});

test('empty target widget never borrows body/time from a later widget with reversed attributes',async()=>{
 const page='<div class="tgme_widget_message text_not_supported_wrap" data-post="test_channel/42"></div><div data-post="test_channel/43" class="tgme_widget_message text_not_supported_wrap"><div class="tgme_widget_message_text js-message_text">Approved body</div><time datetime="2026-10-20T01:02:03Z"></time></div>';
 const result=await observe(page,{...snapshot,body:'Approved body'});assert.equal(result.outcome,'UNREADABLE');assert.equal(result.reason,'text_unreadable');assert.equal(result.observed_sha256,null);
 const reversed=html().replace('class="tgme_widget_message text_not_supported_wrap" data-post="test_channel/42"','data-post="test_channel/42" class="tgme_widget_message text_not_supported_wrap"');assert.equal((await observe(reversed)).outcome,'TEXT_MATCH');
});

test('non-rendered comments, scripts, styles and nested/unclosed templates never verify hidden messages',async()=>{
 const widget=message('Approved body'),s={...snapshot,body:'Approved body'};
 for(const page of ['<!--'+widget+'-->','<script>const template=`'+widget+'`;</script>','<style>'+widget+'</style>','<template>'+widget+'</template>','<template><template>'+widget+'</template>'+widget+'</template>','<template><script>"</template>"</script>'+widget+'</template>','<!--'+widget,'<script>'+widget,'<style>'+widget,'<template>'+widget,'<template><template>'+widget+'</template>']){
  const result=await observe(page,s);assert.equal(result.outcome,'UNREADABLE',page);assert.equal(result.reason,'message_missing');assert.equal(result.observed_sha256,null);
 }
 assert.equal((await observe('<template>'+widget+'</template>'+html())).outcome,'TEXT_MATCH');
});
