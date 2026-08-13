const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from);
  if (first < 0) throw new Error(`PATCH_MISSING:${label}`);
  if (text.indexOf(from, first + from.length) >= 0) throw new Error(`PATCH_AMBIGUOUS:${label}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

let worker = fs.readFileSync(path.join(root, 'service_worker.js'), 'utf8');

worker = replaceOnce(
  worker,
  "const MAX_STEPS = 50;",
  "const DEFAULT_MAX_STEPS = 100;\nconst BATCH_MAX_STEPS = 500;\nfunction isBatchTask(task) { return /(?:^|\\s)(?:все|всю|всех|кажд\\p{L}*|массов\\p{L}*|пакетн\\p{L}*|all|every|each|bulk|batch)(?:\\s|$)/iu.test(String(task || '')); }\nfunction maxStepsForTask(task) { return isBatchTask(task) ? BATCH_MAX_STEPS : DEFAULT_MAX_STEPS; }",
  'dynamic-max-steps'
);
worker = replaceOnce(worker, "return {version:'0.1.0', chat:null", "return {version:'0.2.0', chat:null", 'state-version');
worker = replaceOnce(
  worker,
  "  const previous = run.lastResult ? JSON.stringify(sanitize(run.lastResult)) : 'none';",
  "  const previous = run.lastResult ? JSON.stringify(sanitize(run.lastResult)) : 'none';\n  const ledger = run.ledger || {};\n  const expectedItems = Number(run.expectedItems || 0);",
  'prompt-ledger-variable'
);
worker = replaceOnce(
  worker,
  "    `STEP ${run.step}/${MAX_STEPS}; RECOVERIES ${run.recoveries||0}/${MAX_RECOVERIES}`,\n    `PREVIOUS RESULT: ${previous}`,",
  "    `STEP ${run.step}/${run.maxSteps || maxStepsForTask(run.task)}; RECOVERIES ${run.recoveries||0}/${MAX_RECOVERIES}`,\n    `PREVIOUS RESULT: ${previous}`,\n    `BATCH EXPECTED TOTAL: ${expectedItems || 'unknown'}`,\n    `BATCH LEDGER: ${JSON.stringify(ledger)}`,",
  'prompt-ledger-and-limit'
);
worker = replaceOnce(
  worker,
  "    BH_PLANNER.makeSchemaText(),",
  "    BH_PLANNER.makeSchemaText(run.task),",
  'conditional-skill-task-context'
);
worker = replaceOnce(
  worker,
  "    if (run.step>=MAX_STEPS) return blockRun(runId,'MAX_STEPS_REACHED');",
  "    if (run.step >= (run.maxSteps || maxStepsForTask(run.task))) return blockRun(runId,'MAX_STEPS_REACHED');",
  'max-step-check'
);
worker = replaceOnce(
  worker,
  "      const obj=validated.value;\n\n      if(obj.status==='done'){",
  "      const obj=validated.value;\n      if (obj.batch?.expectedTotal) {\n        const expected = Math.max(1, Math.min(100000, Number(obj.batch.expectedTotal)));\n        if (Number.isFinite(expected)) current.expectedItems = Math.max(Number(current.expectedItems || 0), Math.floor(expected));\n      }\n      if (obj.progress?.itemKey) {\n        const itemKey = String(obj.progress.itemKey).trim().slice(0, 500);\n        current.ledger ||= {};\n        current.ledger[itemKey] = {status:String(obj.progress.itemStatus), note:String(obj.progress.note || '').slice(0, 500), updatedAt:now()};\n      }\n      if (obj.batch?.expectedTotal || obj.progress?.itemKey) await putState(state);\n\n      if(obj.status==='done'){\n        if (isBatchTask(current.task)) {\n          const entries = Object.values(current.ledger || {});\n          const working = entries.filter(x => x?.status === 'working');\n          const finished = entries.filter(x => x?.status === 'completed' || x?.status === 'skipped');\n          const expected = Number(current.expectedItems || 0);\n          if (!expected || working.length || finished.length < expected) {\n            current.lastResult={ok:false,error:'BATCH_SCOPE_INCOMPLETE',expected,finished:finished.length,working:working.length,items:entries.length};\n            current.recoveries=(current.recoveries||0)+1;\n            addLog(state,'warn','Batch-задача не может завершиться: не подтверждён полный объём или не все элементы обработаны.',current.lastResult);\n            await putState(state);\n            continue;\n          }\n        }",
  'persist-progress-and-batch-done-guard'
);
worker = replaceOnce(
  worker,
  "state.run={id:uid('run'),taskId:task.id,task:task.text,status:'running',step:0,recoveries:0,plannerErrors:0,history:[],lastResult:null,startedAt:now()};",
  "state.run={id:uid('run'),taskId:task.id,task:task.text,status:'running',step:0,maxSteps:maxStepsForTask(task.text),recoveries:0,plannerErrors:0,history:[],ledger:{},expectedItems:0,lastResult:null,startedAt:now()};",
  'run-batch-state'
);

fs.writeFileSync(path.join(root, 'service_worker.js'), worker);

let planner = fs.readFileSync(path.join(root, 'planner_protocol.js'), 'utf8');
planner = replaceOnce(
  planner,
  "  function validateResponse(obj, expectedRequestId) {",
  "  function validateBatch(batch) {\n    if (batch == null) return null;\n    if (!batch || typeof batch !== 'object' || Array.isArray(batch)) return 'BATCH_NOT_OBJECT';\n    if (batch.expectedTotal != null) {\n      const n = Number(batch.expectedTotal);\n      if (!Number.isInteger(n) || n < 1 || n > 100000) return 'BATCH_EXPECTED_TOTAL_INVALID';\n    }\n    return null;\n  }\n\n  function validateResponse(obj, expectedRequestId) {",
  'batch-validator-function'
);
planner = replaceOnce(
  planner,
  "    if (!['act','done'].includes(obj.status)) return {ok:false,error:'PLANNER_STATUS_INVALID'};\n    const progressError = validateProgress(obj.progress);",
  "    if (!['act','done'].includes(obj.status)) return {ok:false,error:'PLANNER_STATUS_INVALID'};\n    const batchError = validateBatch(obj.batch);\n    if (batchError) return {ok:false,error:batchError};\n    const progressError = validateProgress(obj.progress);",
  'batch-validator-call'
);
planner = replaceOnce(
  planner,
  "    action.type = type;\n\n    if (type === 'navigate') {",
  "    action.type = type;\n    if (obj.progress?.itemStatus === 'completed' && !['assert','wait'].includes(type)) return {ok:false,error:'PROGRESS_COMPLETED_REQUIRES_VERIFY_STEP'};\n\n    if (type === 'navigate') {",
  'completed-progress-needs-verification'
);
planner = replaceOnce(
  planner,
  "  function makeSchemaText() {",
  "  function makeSchemaText(taskText='') {",
  'skill-schema-task-arg'
);
planner = replaceOnce(
  planner,
  "      'For batch/collection work, use progress to keep a compact durable ledger. Mark an item completed only after a separate wait/assert/read step verifies the saved/target state; never mark completed on the mutation click itself.'",
  "      'Batch scope shape: {\\\"expectedTotal\\\":31}. When the current finite collection UI exposes a real total count, set batch.expectedTotal to that observed count.',\n      'For batch/collection work, use progress to keep a compact durable ledger. Mark an item completed only after a separate wait/assert/read step verifies the saved/target state; never mark completed on the mutation click itself.'",
  'batch-schema-text'
);
planner = replaceOnce(
  planner,
  "    const seoSkill = root.ABH_SKILLS?.seoArticleWriterTatyana?.prompt;\n    if (seoSkill) lines.push('', seoSkill);",
  "    const activateSeo = /@seo-article-writer-tatyana|\\bseo\\b|rank math|seo[- ]?стат|мета[- ]?тег|каннибализац/i.test(String(taskText || ''));\n    const seoSkill = root.ABH_SKILLS?.seoArticleWriterTatyana?.prompt;\n    if (activateSeo && seoSkill) lines.push('', seoSkill);",
  'conditional-seo-skill'
);
planner = replaceOnce(
  planner,
  "  const api = {ALLOWED_ACTIONS, ITEM_STATUSES, collectTopLevelObjects, collectRequestScopedObjects, extractJson, validateProgress, validateResponse, makeSchemaText};",
  "  const api = {ALLOWED_ACTIONS, ITEM_STATUSES, collectTopLevelObjects, collectRequestScopedObjects, extractJson, validateProgress, validateBatch, validateResponse, makeSchemaText};",
  'export-batch-validator'
);
fs.writeFileSync(path.join(root, 'planner_protocol.js'), planner);

console.log('apply_runtime_patch PASS');
