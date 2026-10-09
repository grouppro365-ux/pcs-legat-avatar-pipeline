import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const match=process.env.TGCLOUD_TOKEN?.match(/^app(\d+):/);if(!match)throw Error('Serverless CLI token missing');
const origin='https://app'+match[1]+'.tgcloud.ai/';
const manifest=JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),'../dist/migration-manifest.json')));
const published=await fetch(origin+'migration-manifest.json',{signal:AbortSignal.timeout(20000),cache:'no-store'});
if(!published.ok||JSON.stringify(await published.json())!==JSON.stringify(manifest))throw Error('Published manifest mismatch');
const jobs=Object.entries(manifest.files);let next=0;
await Promise.all(Array.from({length:6},async()=>{
 while(next<jobs.length){const [path,hash]=jobs[next++];const r=await fetch(origin+path,{signal:AbortSignal.timeout(20000),cache:'no-store'});
 if(!r.ok||createHash('sha256').update(new Uint8Array(await r.arrayBuffer())).digest('hex')!==hash)throw Error('Published asset mismatch: '+path);}
}));
console.log('Verified Telegram Mini App: '+origin+' ('+jobs.length+' files).');
console.log('Database and webhook are still on the existing PCS infrastructure.');
