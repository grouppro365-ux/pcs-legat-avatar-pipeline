import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSeasonDate,seasonDateRange} from '../server/supabase/pcs-catalog-admin/season-dates.mjs';
test('screenshot season dates normalize to exact ISO dates without locale ambiguity',()=>{
 assert.deepEqual(seasonDateRange('01.10.2026','30.04.2027'),{date_from:'2026-10-01',date_to:'2027-04-30'});
 assert.equal(normalizeSeasonDate('01.02.2026'),'2026-02-01');
 assert.deepEqual(seasonDateRange('2026-10-01','2027-04-30'),seasonDateRange(' 01.10.2026 ','30.04.2027'));
});
test('catalog save handler writes normalized screenshot dates and rejects invalid input before insert',async()=>{
 const source=readFileSync(new URL('../server/supabase/pcs-catalog-admin/index.ts',import.meta.url),'utf8');
 const body=source.slice(source.indexOf("if(action==='upsert_rule')"),source.indexOf("if(action==='delete_rule')")).replace('const row:any=','const row=');
 const run=new (Object.getPrototypeOf(async function(){}).constructor)('sb','json','req','b','id','action','seasonDateRange',body);
 const inserted=[],refreshed=[];const sb={from(table){const q={select(){return q},eq(){return q},insert(row){inserted.push(row);return q},single:async()=>({data:table==='pcs_catalog_items'?{base_price_period:'day',deleted_at:null}:{...inserted.at(-1),id:'test-rule'},error:null})};return q},rpc:async(...args)=>{refreshed.push(args);return {error:null}}};
 const json=(req,body,status=200)=>({status,body});const b={date_from:'01.10.2026',date_to:'30.04.2027',multiplier:1.8};
 const result=await run(sb,json,{},b,'test-catalog','upsert_rule',seasonDateRange);
 assert.equal(result.status,200);assert.equal(inserted[0].date_from,'2026-10-01');assert.equal(inserted[0].date_to,'2027-04-30');assert.equal(inserted[0].multiplier,1.8);assert.equal(refreshed.length,1);
 const invalid=await run(sb,json,{},{...b,date_from:'31.04.2027'},'test-catalog','upsert_rule',seasonDateRange);
 assert.equal(invalid.status,400);assert.equal(inserted.length,1);
});
test('invalid dates and reversed or empty ranges cannot reach storage',()=>{
 for(const date of ['31.04.2027','29.02.2026','2026-02-30','2026-13-01','01/02/2026','garbage','',null,12])assert.equal(normalizeSeasonDate(date),null);
 assert.equal(normalizeSeasonDate('29.02.2028'),'2028-02-29');
 for(const range of [['30.04.2027','01.10.2026'],['01.10.2026','01.10.2026'],['31.04.2027','01.05.2027']])assert.equal(seasonDateRange(...range),null);
});
