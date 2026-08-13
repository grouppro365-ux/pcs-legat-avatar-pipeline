(function(root){
  const ALLOWED_ACTIONS = new Set(['click','fill','select','check','uncheck','focus','scroll','wait','assert','submit','navigate']);
  const ITEM_STATUSES = new Set(['working','completed','skipped']);

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
      const floor = Math.max(0, pos - 12000);
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
    const hasIdentity = !!(target.ref || target.selector || target.name || target.label || target.text || target.role || target.hints?.id || target.hints?.testid || target.hints?.name);
    if (!hasIdentity) return `${actionType} target has no usable identity`;
    return null;
  }

  function validateProgress(progress) {
    if (progress == null) return null;
    if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return 'PROGRESS_NOT_OBJECT';
    if (!String(progress.itemKey || '').trim()) return 'PROGRESS_ITEM_KEY_REQUIRED';
    if (!ITEM_STATUSES.has(String(progress.itemStatus || ''))) return 'PROGRESS_ITEM_STATUS_INVALID';
    if (progress.note != null && typeof progress.note !== 'string') return 'PROGRESS_NOTE_INVALID';
    return null;
  }

  function validateResponse(obj, expectedRequestId) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {ok:false,error:'PLANNER_RESPONSE_NOT_OBJECT'};
    if (obj.requestId !== expectedRequestId) return {ok:false,error:'REQUEST_ID_MISMATCH'};
    if (!['act','done'].includes(obj.status)) return {ok:false,error:'PLANNER_STATUS_INVALID'};
    const progressError = validateProgress(obj.progress);
    if (progressError) return {ok:false,error:progressError};

    if (obj.status === 'done') {
      const proof = obj.proof;
      if (!proof || typeof proof !== 'object') return {ok:false,error:'DONE_PROOF_REQUIRED'};
      if (!['text','url','title','element'].includes(proof.kind)) return {ok:false,error:'DONE_PROOF_KIND_INVALID'};
      if (['text','url','title'].includes(proof.kind) && !String(proof.includes || '').trim()) return {ok:false,error:'DONE_PROOF_FRAGMENT_REQUIRED'};
      if (proof.kind === 'element') {
        const targetError = validateTarget(proof.target, 'element proof');
        if (targetError) return {ok:false,error:'DONE_PROOF_TARGET_REQUIRED'};
        if (proof.equals == null && proof.includes == null && proof.checked == null) return {ok:false,error:'DONE_PROOF_ASSERT_REQUIRED'};
      }
      return {ok:true,value:obj};
    }

    const action = obj.action;
    if (!action || typeof action !== 'object') return {ok:false,error:'ACTION_REQUIRED'};
    const type = String(action.type || '').toLowerCase();
    if (!ALLOWED_ACTIONS.has(type)) return {ok:false,error:'ACTION_TYPE_INVALID'};
    action.type = type;

    if (type === 'navigate') {
      try { new URL(String(action.url), 'https://relative.invalid/'); } catch { return {ok:false,error:'NAVIGATE_URL_INVALID'}; }
      return {ok:true,value:obj};
    }
    if (type === 'wait' && !action.target && !action.textIncludes && !action.urlIncludes) return {ok:false,error:'WAIT_CONDITION_REQUIRED'};
    if (!['scroll','wait'].includes(type) || action.target) {
      const targetError = validateTarget(action.target, type);
      if (targetError) return {ok:false,error:'ACTION_TARGET_REQUIRED'};
    }
    if (type === 'fill' && action.value == null) return {ok:false,error:'FILL_VALUE_REQUIRED'};
    if (type === 'select' && action.value == null && action.optionText == null) return {ok:false,error:'SELECT_OPTION_REQUIRED'};
    if (type === 'assert' && action.equals == null && action.includes == null && action.checked == null) return {ok:false,error:'ASSERT_CONDITION_REQUIRED'};
    return {ok:true,value:obj};
  }

  function makeSchemaText() {
    return [
      'Return exactly ONE JSON object and nothing else.',
      'Use the requestId shown at the top of this prompt. Do not copy this placeholder literally.',
      'ACT shape: {"requestId":"<REQUEST_ID_FROM_TOP>","status":"act","action":{"type":"click|fill|select|check|uncheck|focus|scroll|wait|assert|submit|navigate","target":{"ref":"bh...","role":"","name":"","label":"","text":""}},"progress":{"itemKey":"stable item title/url/id","itemStatus":"working|completed|skipped","note":"short checkpoint"},"reason":"short"}',
      'DONE shape: {"requestId":"<REQUEST_ID_FROM_TOP>","status":"done","result":"specific result","proof":{"kind":"text|url|title|element","includes":"real fragment on current page"},"progress":{"itemKey":"optional final item","itemStatus":"completed|skipped","note":"short checkpoint"}}',
      'For batch/collection work, use progress to keep a compact durable ledger. Mark an item completed only after a separate wait/assert step verifies the saved/target state; never mark completed on the mutation click itself.'
    ].join('\n');
  }

  const api = {ALLOWED_ACTIONS, ITEM_STATUSES, collectTopLevelObjects, collectRequestScopedObjects, extractJson, validateProgress, validateResponse, makeSchemaText};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BH_PLANNER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
