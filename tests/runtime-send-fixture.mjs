export const id='00000000-0000-4000-8000-000000000001';
export function fixture(){
 const tables={pcs_contacts:[{id,name:'Test',telegram_chat_id:123,business_connection_id:'test-business'}],pcs_messages:[],pcs_channel_events:[],pcs_tasks:[]};let failHistory=false;
 const db={from(table){let operation='select',values,filters=[],single=false;
  const q={select(){return q},eq(k,v){filters.push([k,v]);return q},single(){single=true;return q},maybeSingle(){single=true;return q},insert(v){operation='insert';values=v;return q},update(v){operation='update';values=v;return q},then(resolve,reject){return Promise.resolve().then(()=>{
   const matches=x=>filters.every(([k,v])=>k==='payload->>owner'?x.payload?.owner===v:x[k]===v);
   if(operation==='insert'){
    if(table==='pcs_channel_events'&&tables[table].some(x=>x.channel===values.channel&&x.external_event_id===values.external_event_id))return {error:{code:'23505'},data:null};
    if(table==='pcs_messages'&&failHistory){failHistory=false;return {error:Error('history unavailable'),data:null};}
    const row={id:crypto.randomUUID(),...JSON.parse(JSON.stringify(values,(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v))};tables[table].push(row);return {data:single?row:[row],error:null};
   }
   const rows=tables[table].filter(matches);if(operation==='update')rows.forEach(x=>Object.assign(x,structuredClone(values)));return {data:single?(rows[0]?structuredClone(rows[0]):null):structuredClone(rows),error:null};
  }).then(resolve,reject)}};return q;}};
 return {db,tables,failHistory(){failHistory=true}};
}
