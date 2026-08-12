const parser=require('../response_parser.js');
const matcher=require('../chat_response_matcher.js');

function ok(cond,msg){if(!cond){console.error('FAIL:',msg);process.exit(1);}console.log('PASS:',msg);}

const requestId='req_live_timeout_case';
const fragments=[
  'Нерелевантный интерфейс ChatGPT',
  '{"requestId":"req_other","status":"act","action":{"type":"wait"}}',
  '{"requestId":"req_live_timeout_case",',
  '"status":"act",',
  '"action":{"type":"click","target":{"ref":"r15","role":"link","name":"Следующая страница ›"}},',
  '"reason":"Перейти на вторую страницу"}'
];

const hit=matcher.find(requestId,fragments,parser);
ok(!!hit,'fragmented response is recovered');
ok(hit.obj.requestId===requestId,'exact requestId is preserved');
ok(hit.obj.status==='act','action status parsed');
ok(hit.obj.action?.target?.ref==='r15','nested action survives fragment join');
ok(hit.method==='joined_fragments'||hit.method==='aggregate','fragment recovery path was used');

const wrong=matcher.find('req_missing',fragments,parser);
ok(!wrong,'unrelated requestId is never accepted');

const complete=matcher.find(requestId,[JSON.stringify(hit.obj)],parser);
ok(complete?.method==='single_fragment','complete assistant turn remains fast path');

console.log('CHAT RESPONSE MATCHER REGRESSION PASS');
