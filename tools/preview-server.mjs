// Dependency-free preview of the existing static PCS site.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const args=process.argv.slice(2);
const port=Number(args[args.indexOf('--port')+1]||4173);
const root=process.cwd();
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.mjs':'text/javascript'};
http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://preview');
  const path=resolve(root,'.'+decodeURIComponent(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));
  if(!path.startsWith(root+sep)) {res.writeHead(403).end();return;}
  res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');
  res.setHeader('Cache-Control','no-store');res.end(await readFile(path));
 } catch {res.writeHead(404).end('Not found');}
}).listen(port,'0.0.0.0',()=>console.log(`PCS preview on ${port}`));
