import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const id='11111111-1111-4111-8111-111111111111';
function backendHarness(media=[]){
  const row={id,title:'Existing',revision:1,media};
  const writes=[],removed=[];
  const query={select(){return this},eq(){return this},gt(){return this},order(){return Promise.resolve({data:[row]})},maybeSingle(){return Promise.resolve({data:row})},single(){return Promise.resolve({data:row})},update(p){writes.push(p);Object.assign(row,p);return this}};
  const bucket={createSignedUrl:async key=>({data:{signedUrl:'https://private.example/'+key}}),upload:async()=>({error:null}),remove:async keys=>{removed.push(...keys);return {error:null}}};
  let handler;
  const code=readFileSync(new URL('../../supabase/functions/pcs-kb/index.ts',import.meta.url),'utf8').replace(/^import .*\n/,'').replace(/\)!/g,')').replace(/:(?:any|string|Request)\b/g,'');
  vm.runInNewContext(code,{Deno:{env:{get:()=> 'https://backend.example'},serve:h=>handler=h},createClient:()=>({from:()=>query,storage:{from:()=>bucket}}),fetch:async()=>new Response('{}'),Request,Response,URL,crypto,TextEncoder,Uint8Array,atob,console});
  return {handler,writes,removed,row};
}

test('knowledge photos are retrieved only through the authenticated record route with signed URLs',async()=>{
  const h=backendHarness([{id:'photo-a',storage_key:id+'/a.png',filename:'a.png'}]);
  const response=await h.handler(new Request('https://backend.example/pcs-kb/'+id+'/media',{headers:{authorization:'Bearer test-session'}}));
  const body=await response.json();
  assert.equal(body[0]?.id,'photo-a');
  assert.equal(body[0]?.url,'https://private.example/'+id+'/a.png');
  assert.equal(h.writes.length,0);
});

test('upload attaches a photo to the existing knowledge entry without changing text or prices',async()=>{
  const h=backendHarness();
  const response=await h.handler(new Request('https://backend.example/pcs-kb/'+id+'/media',{method:'POST',headers:{authorization:'Bearer test-session','content-type':'application/json'},body:JSON.stringify({filename:'a.png',content_type:'image/png',content_base64:'iVBORw0KGgo='})}));
  assert.equal(response.status,201);
  assert.equal(h.row.media.length,1);
  assert.equal(h.row.title,'Existing');
  assert.equal(h.row.revision,2);
  assert.ok(h.row.media[0].storage_key.startsWith(id+'/'));
});

test('batch deletion validates every photo belongs to the record before deleting anything',async()=>{
  const h=backendHarness([{id:'photo-a',storage_key:id+'/a.png'},{id:'photo-b',storage_key:id+'/b.png'}]);
  const remove=ids=>h.handler(new Request('https://backend.example/pcs-kb/'+id+'/media',{method:'DELETE',headers:{authorization:'Bearer test-session','content-type':'application/json'},body:JSON.stringify({ids})}));
  assert.equal((await remove(['photo-a','another-record-photo'])).status,400);
  assert.equal(h.writes.length,0);
  assert.equal(h.removed.length,0);
  assert.equal((await remove(['photo-a'])).status,200);
  assert.deepEqual(Array.from(h.row.media,p=>p.id),['photo-b']);
  assert.deepEqual(h.removed,[id+'/a.png']);
});
