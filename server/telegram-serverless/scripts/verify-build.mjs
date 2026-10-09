import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const dist=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const manifest=JSON.parse(readFileSync(resolve(dist,'migration-manifest.json')));
if(!/^[0-9a-f]{40}$/.test(manifest.source_sha)||manifest.database_migrated!==false)throw Error('Invalid migration manifest');
for(const [path,hash] of Object.entries(manifest.files)){
 if(path.split('/').some(s=>s.startsWith('.'))||path.includes('..')||path.includes('/tests/')||/\.mjs$/.test(path))throw Error('Unexpected static file');
 const bytes=readFileSync(resolve(dist,path));if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Static hash mismatch: '+path);
}
const html=readFileSync(resolve(dist,'index.html'),'utf8');
if(!html.includes('<base id="pcs-base" href="/">')||html.indexOf('telegram-transport.js')<0||html.indexOf('telegram-transport.js')>html.indexOf('neon-adapter.js'))throw Error('Incorrect Telegram bootstrap');
for(const match of html.matchAll(/<(?:script|link|img)\b[^>]*?(?:src|href)="([^"#]+)"/g)){
 const value=match[1].split('?')[0];if(!value||/^(?:https?:|data:|\/\/)/.test(value)||value==='/')continue;
 if(!existsSync(resolve(dist,value.replace(/^\//,''))))throw Error('Missing Mini App asset: '+value);
}
console.log('Verified '+Object.keys(manifest.files).length+' static files and Mini App bootstrap.');
