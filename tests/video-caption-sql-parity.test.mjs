import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {videoSpec} from '../server/supabase/pcs-manager-live2/content-video.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const base=()=>({version:1,mode:'TEXT_TO_VIDEO',preset:'landscape',fit:'contain',shots:[{prompt:'A small green leaf moves gently.',negative_prompt:'text',seed:42,frames:17}]});
const finishing=()=>({version:1,style:'readable-v1',language:'ru',cues:[{start_frame:0,end_frame:51,text:'Точный текст оператора'}]});
const captionSpec=()=>({...base(),version:2,finishing:finishing()});

// This executes the two pure production validators on actual PostgreSQL WASM.
// It does not substitute for the canonical queue's Neon rollback/integration QA.
test('caption pure PostgreSQL validators match JS boundaries and SQL fixtures, without a queue or network',{timeout:30000},async t=>{
 const sql=read('server/sql/pcs_content_video.sql');
 const start=sql.indexOf('CREATE OR REPLACE FUNCTION pcs.content_video_finishing_valid');
 const end=sql.indexOf('CREATE OR REPLACE FUNCTION pcs.content_video_job');
 assert.ok(start>=0&&end>start,'pure validator definitions must be present');
 const fixtures=read('tests/content-video-rollback.sql');
 const fixtureEnd=fixtures.indexOf(" r:=pcs.content_action('brand'");
 assert.ok(fixtureEnd>0,'pure caption fixtures must precede canonical queue fixtures');
 const db=new PGlite();
 try{
  await db.exec('CREATE SCHEMA pcs;'+sql.slice(start,end));
  await db.exec(fixtures.slice(0,fixtureEnd)+'END $qa$;');

  const cases=[base(),captionSpec(),null,[],{},...['version','mode','preset','fit','shots','finishing'].map(key=>{const value=captionSpec();delete value[key];return value;})];
  for(const version of [null,true,false,0,1,2,3,'2'])cases.push({...captionSpec(),version});
  for(const value of [null,[],{}, {...finishing(),style:'other'},{...finishing(),language:'th'},{...finishing(),font:'/private'}, {...finishing(),cues:[]}])cases.push({...captionSpec(),finishing:value});
  for(const start_frame of [-1,0,1,23,24,50,51,52,297,298])for(const end_frame of [-1,0,1,24,25,51,52,297,298]){
   cases.push({...captionSpec(),finishing:{...finishing(),cues:[{start_frame,end_frame,text:'Caption'}]}});
  }
  const texts=['',' ','\u00a0\u2000','A\n','\nA','A\nB\nC','A'.repeat(36),'A'.repeat(37),'A'.repeat(36)+'\n'+'Б'.repeat(35),'A'.repeat(36)+'\n'+'Б'.repeat(36),'😀'.repeat(36),'😀'.repeat(37),'{\\pos(0,0)}Caption','Text\\Nnext','A\ud800B',...Array.from({length:160},(_,i)=>'A'+String.fromCodePoint(i)+'B'),...[0xad,0x61c,0x1680,0x2000,0x200b,0x200f,0x2028,0x202e,0x2060,0x206f,0xfeff].map(n=>'A'+String.fromCodePoint(n)+'B')];
  for(const text of texts)cases.push({...captionSpec(),finishing:{...finishing(),cues:[{start_frame:0,end_frame:51,text}]}});
  for(const length of [1,12,13])cases.push({...captionSpec(),finishing:{...finishing(),cues:Array.from({length},(_,i)=>({start_frame:i,end_frame:i+1,text:'Caption'}))}});
  for(const patch of [{seed:'bogus'},{seed:'42'},{seed:99999999999999},{frames:null},{frames:'17'},{prompt:null},{negative_prompt:null}])cases.push({...captionSpec(),shots:[{...base().shots[0],...patch}]});

  let jsonRefused=0;
  for(const input of cases){
   let js=true;try{videoSpec(input);}catch{js=false;}
   let postgres;
   try{
    postgres=(await db.query('select pcs.content_video_spec_valid($1::jsonb,$2) valid',[JSON.stringify(input),'telegram'])).rows[0].valid;
   }catch(error){
    // PostgreSQL refuses NUL and lone UTF-16 surrogate escapes before JSONB
    // reaches PL/pgSQL. These must be rejected by the JS boundary as well.
    if(['22P05','22P02'].includes(error.code)&&/unicode|surrogate|\\u0000/i.test(error.message+' '+error.detail)){
     postgres=false;jsonRefused++;
    }else throw error;
   }
   assert.equal(postgres,js,JSON.stringify(input));
  }
  const privileges=await db.query("select has_function_privilege('public','pcs.content_video_finishing_valid(jsonb,integer)','EXECUTE') allowed");
  assert.equal(privileges.rows[0].allowed,false);
  t.diagnostic(`${cases.length} JS/PostgreSQL parity cases; ${jsonRefused} invalid Unicode JSON values refused before validation; full queue QA not run here`);
 }finally{await db.close();}
});
