(function(root){
  const ALLOWED_ACTIONS = new Set(['click','fill','select','check','uncheck','focus','scroll','wait','assert','submit','navigate']);
  const ITEM_STATUSES = new Set(['working','completed','skipped']);
  const MAX_ACTION_BUNDLE = 12;

  const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function shouldUseSeoSkill(task='') {
    return /@seo-article-writer-tatyana|seo|rank\s*math|стать|мета(?:-|\s)?тег|каннибал|indexnow|поисков|ключев(?:ое|ой)\s+слов|контент/i.test(String(task || ''));
  }

  function stripFences(text) {
    return String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  }

  function parseObject(text) {
    try {
      const obj = JSON.parse(text);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    } catch { return null; }
  }

  function balancedObjectFrom(raw, start) {
    if (raw[start] !== '{') return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < raw.length; i++) {
      const c = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{') { depth += 1; continue; }
      if (c === '}') {
        depth -= 1;
        if (depth === 0) return raw.slice(start, i + 1);
        if (depth < 0) return null;
      }
    }
    return null;
  }

  function collectTopLevelObjects(raw) {
    const out = [];
    let depth = 0, start = -1, inString = false, escaped = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{') { if (depth === 0) start = i; depth += 1; continue; }
      if (c === '}' && depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) { out.push(raw.slice(start, i + 1)); start = -1; }
      }
    }
    return out;
  }

  function collectRequestScopedObjects(raw, expectedRequestId) {
    const out = [];
    const seen = new Set();
    const needle = String(expectedRequestId || '');
    if (!needle) return out;
    let pos = raw.indexOf(needle);
    while (pos >= 0) {
      const floor = Math.max(0, pos - 16000);
      const starts = [];
      for (let i = pos; i >= floor; i--) if (raw[i] === '{') starts.push(i);
      for (const start of starts) {
        const text = balancedObjectFrom(raw, start);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        const obj = parseObject(text);
        if (obj?.requestId === expectedRequestId && (obj.status === 'act' || obj.status === 'done')) out.push(obj);
      }
      pos = raw.indexOf(needle, pos + needle.length);
    }
    return out;
  }

  function extractJson(text, expectedRequestId) {
    const raw = stripFences(text);
    const scoped = collectRequestScopedObjects(raw, expectedRequestId);
    if (scoped.length) return scoped[scoped.length - 1];
    const candidates = [raw, ...collectTopLevelObjects(raw)].map(parseObject).filter(Boolean);
    const exact = candidates.filter(obj => obj.requestId === expectedRequestId && (obj.status === 'act' || obj.status === 'done'));
    if (exact.length) return exact[exact.length - 1];
    throw new Error('PLANNER_JSON_NOT_FOUND');
  }

  function validateTarget(target, actionType) {
    if (!target || typeof target !== 'object') return `${actionType} requires target`;
    const hasIdentity = !!(target.ref || target.selector || target.name || target.label || target.text || target.role || target.hints?.id || target.hints?.testid || target.hints?.name || target.hints?.aria || target.hints?.placeholder);
    if (!hasIdentity) return `${actionType} target has no usable identity`;
    return null;
  }

  function validateProgress(progress) {
    if (progress == null) return null;
    if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return 'PROGRESS_NOT_OBJECT';
    if (!norm(progress.itemKey)) return 'PROGRESS_ITEM_KEY_REQUIRED';
    if (!ITEM_STATUSES.has(String(progress.itemStatus || ''))) return 'PROGRESS_ITEM_STATUS_INVALID';
    if (progress.note != null && typeof progress.note !== 'string') return 'PROGRESS_NOTE_INVALID';
    return null;
  }

  function validateBatch(batch) {
    if (batch == null) return null;
    if (!batch || typeof batch !== 'object' || Array.isArray(batch)) return 'BATCH_NOT_OBJECT';
    if (batch.expectedTotal != null) {
      const n = Number(batch.expectedTotal);
      if (!Number.isInteger(n) || n < 1 || n > 10000) return 'BATCH_EXPECTED_TOTAL_INVALID';
    }
    return null;
  }

  function validateAction(action) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) return 'ACTION_REQUIRED';
    const type = String(action.type || '').toLowerCase();
    if (!ALLOWED_ACTIONS.has(type)) return 'ACTION_TYPE_INVALID';
    action.type = type;

    if (type === 'navigate') {
      try { new URL(String(action.url), 'https://relative.invalid/'); } catch { return 'NAVIGATE_URL_INVALID'; }
      return null;
    }
    if (type === 'wait' && !action.target && !action.textIncludes && !action.urlIncludes) return 'WAIT_CONDITION_REQUIRED';
    if (!['scroll','wait'].includes(type) || action.target) {
      const targetError = validateTarget(action.target, type);
      if (targetError) return 'ACTION_TARGET_REQUIRED';
    }
    if (type === 'fill' && action.value == null) return 'FILL_VALUE_REQUIRED';
    if (type === 'select' && action.value == null && action.optionText == null) return 'SELECT_OPTION_REQUIRED';
    if (type === 'assert' && action.equals == null && action.includes == null && action.checked == null) return 'ASSERT_CONDITION_REQUIRED';
    return null;
  }

  function responseActions(obj) {
    if (Array.isArray(obj?.actions)) return obj.actions;
    if (obj?.action) return [obj.action];
    return [];
  }

  function validateResponse(obj, expectedRequestId) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {ok:false,error:'PLANNER_RESPONSE_NOT_OBJECT'};
    if (obj.requestId !== expectedRequestId) return {ok:false,error:'REQUEST_ID_MISMATCH'};
    if (!['act','done'].includes(obj.status)) return {ok:false,error:'PLANNER_STATUS_INVALID'};
    const progressError = validateProgress(obj.progress);
    if (progressError) return {ok:false,error:progressError};
    const batchError = validateBatch(obj.batch);
    if (batchError) return {ok:false,error:batchError};

    if (obj.status === 'done') {
      const proof = obj.proof;
      if (!proof || typeof proof !== 'object') return {ok:false,error:'DONE_PROOF_REQUIRED'};
      if (!['text','url','title','element'].includes(proof.kind)) return {ok:false,error:'DONE_PROOF_KIND_INVALID'};
      if (['text','url','title'].includes(proof.kind) && !norm(proof.includes)) return {ok:false,error:'DONE_PROOF_FRAGMENT_REQUIRED'};
      if (proof.kind === 'element') {
        if (validateTarget(proof.target, 'element proof')) return {ok:false,error:'DONE_PROOF_TARGET_REQUIRED'};
        if (proof.equals == null && proof.includes == null && proof.checked == null) return {ok:false,error:'DONE_PROOF_ASSERT_REQUIRED'};
      }
      return {ok:true,value:obj};
    }

    const actions = responseActions(obj);
    if (!actions.length) return {ok:false,error:'ACTION_REQUIRED'};
    if (actions.length > MAX_ACTION_BUNDLE) return {ok:false,error:'ACTION_BUNDLE_TOO_LARGE'};
    for (const action of actions) {
      const error = validateAction(action);
      if (error) return {ok:false,error};
    }
    if (obj.action && obj.actions) return {ok:false,error:'ACTION_AND_ACTIONS_MUTUALLY_EXCLUSIVE'};

    if (obj.progress?.itemStatus === 'completed') {
      const last = actions[actions.length - 1];
      if (!['assert','wait'].includes(last.type)) return {ok:false,error:'PROGRESS_COMPLETED_REQUIRES_VERIFY_STEP'};
    }
    obj.actions = actions;
    delete obj.action;
    return {ok:true,value:obj};
  }

  function makeSchemaText(task='') {
    const lines = [
      'Return exactly ONE JSON object and nothing else.',
      'Use the exact requestId shown at the top. Never copy the placeholder literally.',
      'Prefer a SMALL LOCAL ACTION BUNDLE when several deterministic actions can be executed on the same current page without additional reasoning. This reduces ChatGPT round-trips. Use 1-12 actions maximum.',
      'If a click/navigation changes the page or the next action depends on its result, stop the bundle there; the harness will Observe again.',
      'ACT shape: {"requestId":"<REQUEST_ID_FROM_TOP>","status":"act","actions":[{"type":"click|fill|select|check|uncheck|focus|scroll|wait|assert|submit|navigate","target":{"ref":"bh...","role":"","name":"","label":"","text":""}}],"batch":{"expectedTotal":31},"progress":{"itemKey":"stable title/url/id","itemStatus":"working|completed|skipped","note":"short checkpoint"},"reason":"short"}',
      'For a single action, "action":{...} is also accepted instead of "actions":[...].',
      'DONE shape: {"requestId":"<REQUEST_ID_FROM_TOP>","status":"done","result":"specific result","proof":{"kind":"text|url|title|element","includes":"real fragment on current page"}}',
      'For batch work, report batch.expectedTotal as soon as the real collection total is visible. Keep progress.itemKey stable. Mark completed only after the final action in that response is wait/assert that verifies the saved state.',
      'Never use repeated pagination/filtering/indexing as a substitute for the substantive user-requested work.'
    ];
    const seoSkill = root.ABH_SKILLS?.seoArticleWriterTatyana?.prompt;
    if (seoSkill && shouldUseSeoSkill(task)) lines.push('', seoSkill);
    return lines.join('\n');
  }

  const api = {
    ALLOWED_ACTIONS, ITEM_STATUSES, MAX_ACTION_BUNDLE,
    shouldUseSeoSkill, collectTopLevelObjects, collectRequestScopedObjects,
    extractJson, validateProgress, validateBatch, validateAction,
    responseActions, validateResponse, makeSchemaText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BH_PLANNER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
