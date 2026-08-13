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
  "  const previous = run.lastResult ? JSON.stringify(sanitize(run.lastResult)) : 'none';\n  const ledger = run.ledger || {};",
  'prompt-ledger-variable'
);
worker = replaceOnce(
  worker,
  "    `STEP ${run.step}/${MAX_STEPS}; RECOVERIES ${run.recoveries||0}/${MAX_RECOVERIES}`,\n    `PREVIOUS RESULT: ${previous}`,",
  "    `STEP ${run.step}/${run.maxSteps || maxStepsForTask(run.task)}; RECOVERIES ${run.recoveries||0}/${MAX_RECOVERIES}`,\n    `PREVIOUS RESULT: ${previous}`,\n    `BATCH LEDGER: ${JSON.stringify(ledger)}`,",
  'prompt-ledger-and-limit'
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
  "      const obj=validated.value;\n      if (obj.progress?.itemKey) {\n        const itemKey = String(obj.progress.itemKey).trim().slice(0, 500);\n        current.ledger ||= {};\n        current.ledger[itemKey] = {status:String(obj.progress.itemStatus), note:String(obj.progress.note || '').slice(0, 500), updatedAt:now()};\n        await putState(state);\n      }\n\n      if(obj.status==='done'){\n        if (isBatchTask(current.task)) {\n          const entries = Object.values(current.ledger || {});\n          const working = entries.filter(x => x?.status === 'working');\n          if (!entries.length || working.length) {\n            current.lastResult={ok:false,error:'BATCH_LEDGER_INCOMPLETE',working:working.length,items:entries.length};\n            current.recoveries=(current.recoveries||0)+1;\n            addLog(state,'warn','Batch-задача не может завершиться: ledger пуст или содержит незавершённые элементы.',current.lastResult);\n            await putState(state);\n            continue;\n          }\n        }",
  'persist-progress-and-batch-done-guard'
);
worker = replaceOnce(
  worker,
  "state.run={id:uid('run'),taskId:task.id,task:task.text,status:'running',step:0,recoveries:0,plannerErrors:0,history:[],lastResult:null,startedAt:now()};",
  "state.run={id:uid('run'),taskId:task.id,task:task.text,status:'running',step:0,maxSteps:maxStepsForTask(task.text),recoveries:0,plannerErrors:0,history:[],ledger:{},lastResult:null,startedAt:now()};",
  'run-batch-state'
);

fs.writeFileSync(path.join(root, 'service_worker.js'), worker);

let planner = fs.readFileSync(path.join(root, 'planner_protocol.js'), 'utf8');
planner = replaceOnce(
  planner,
  "    action.type = type;\n\n    if (type === 'navigate') {",
  "    action.type = type;\n    if (obj.progress?.itemStatus === 'completed' && !['assert','wait'].includes(type)) return {ok:false,error:'PROGRESS_COMPLETED_REQUIRES_VERIFY_STEP'};\n\n    if (type === 'navigate') {",
  'completed-progress-needs-verification'
);
fs.writeFileSync(path.join(root, 'planner_protocol.js'), planner);

console.log('apply_runtime_patch PASS');
