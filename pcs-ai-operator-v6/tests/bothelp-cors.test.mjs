import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('BotHelp admin permits the deployed Mini App origin without opening access to other sites',()=>{
  const source=readFileSync(new URL('../../server/supabase/pcs-meta-webhook-v1/index.ts',import.meta.url),'utf8');
  const origins=source.match(/const ADMIN_ORIGINS = new Set\(\[[\s\S]*?\]\);/)[0];
  const cors=source.match(/function adminCors\(request: Request\) \{[\s\S]*?\n\}/)[0].replace('request: Request','request');
  const context=vm.createContext({Request});
  vm.runInContext(origins+'\n'+cors,context);
  const origin='https://pcs-ai-operator-live-grouppro365-2288s-projects.vercel.app';
  context.request=new Request('https://example.test',{headers:{origin}});
  const result=vm.runInContext('adminCors(request)',context);
  assert.equal(result['access-control-allow-origin'],origin);
  assert.match(result['access-control-allow-headers'],/authorization/);
  assert.match(result['access-control-allow-methods'],/POST/);
  context.request=new Request('https://example.test',{headers:{origin:'https://untrusted.example'}});
  assert.notEqual(vm.runInContext('adminCors(request)',context)['access-control-allow-origin'],'https://untrusted.example');
});

