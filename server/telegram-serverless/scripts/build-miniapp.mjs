import {execFileSync} from 'node:child_process';
import {mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repo=resolve(root,'../..');
const ref=process.argv[2]||'HEAD';
if(!/^(?:HEAD|[0-9a-f]{40})$/.test(ref))throw Error('Use HEAD or an exact commit SHA');
const sha=execFileSync('git',['rev-parse',ref],{cwd:repo,encoding:'utf8'}).trim();
const files=execFileSync('git',['ls-tree','-r','--name-only',sha,'pcs-ai-operator-v6'],{cwd:repo,encoding:'utf8'}).trim().split('\n');
const selected=files.filter(p=>!p.includes('/tests/')&&!p.endsWith('.test.mjs')&&/\.(html|js|css|png|jpe?g|webp|svg|ico|woff2?|mp4|json)$/.test(p));
if(!selected.includes('pcs-ai-operator-v6/index.html'))throw Error('Mini App index missing');
const dist=resolve(root,'dist');rmSync(dist,{recursive:true,force:true});mkdirSync(dist,{recursive:true});
const manifest={source_sha:sha,stage:'miniapp-and-api-transport',database_migrated:false,files:{}};
for(const path of selected){
 let bytes=execFileSync('git',['show',sha+':'+path],{cwd:repo,maxBuffer:30*1024*1024});
 const relative=path.replace('pcs-ai-operator-v6/','');
 if(/\.(html|js|css)$/.test(relative))bytes=Buffer.from(bytes.toString().replace(/(['\"])\/pcs-ai-operator-v6\//g,'$1/'));
 if(relative==='index.html'){
  let html=bytes.toString();
  const base='<base id="pcs-base" href="/">';
  const anchor='<script src="./neon-adapter.js';
  if(!html.includes(base)||!html.includes(anchor))throw Error('Mini App bootstrap changed; review migration build');
  html=html.replace(base,'<base id="pcs-base" href="/">').replace(anchor,'<script src="./telegram-transport.js?v=20261009-tg1"></script>\n  '+anchor);
  bytes=Buffer.from(html);
 }
 const target=resolve(dist,relative);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);
 manifest.files[relative]=createHash('sha256').update(bytes).digest('hex');
}
const transport=readFileSync(resolve(root,'scripts/telegram-transport.js'));writeFileSync(resolve(dist,'telegram-transport.js'),transport);
manifest.files['telegram-transport.js']=createHash('sha256').update(transport).digest('hex');
writeFileSync(resolve(dist,'migration-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({source_sha:sha,static_files:Object.keys(manifest.files).length,database_migrated:false}));
