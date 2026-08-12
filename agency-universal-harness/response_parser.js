(function(root){
  function stripFences(text){
    return String(text || '')
      .replace(/```(?:json)?/gi, '')
      .replace(/```/g, '')
      .trim();
  }

  function parseCandidate(text){
    try {
      const obj = JSON.parse(text);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    } catch {
      return null;
    }
  }

  function collectTopLevelObjects(raw){
    const out = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for(let i = 0; i < raw.length; i++){
      const c = raw[i];
      if(inString){
        if(escaped) escaped = false;
        else if(c === '\\') escaped = true;
        else if(c === '"') inString = false;
        continue;
      }
      if(c === '"'){
        inString = true;
        continue;
      }
      if(c === '{'){
        if(depth === 0) start = i;
        depth += 1;
        continue;
      }
      if(c === '}' && depth > 0){
        depth -= 1;
        if(depth === 0 && start >= 0){
          out.push(raw.slice(start, i + 1));
          start = -1;
        }
      }
    }
    return out;
  }

  function extractJson(text, expectedRequestId){
    const raw = stripFences(text);
    const direct = parseCandidate(raw);
    if(direct && (!expectedRequestId || direct.requestId === expectedRequestId)) return direct;

    const parsed = collectTopLevelObjects(raw).map(parseCandidate).filter(Boolean);
    if(expectedRequestId){
      const exact = parsed.find(obj => obj.requestId === expectedRequestId);
      if(exact) return exact;
      if(direct || parsed.length) throw new Error('REQUEST_ID_MISMATCH');
    }

    const actionLike = parsed.find(obj => obj.status === 'act' || obj.status === 'done');
    if(actionLike) return actionLike;
    if(direct) return direct;
    throw new Error('AI_JSON_PARSE_FAILED');
  }

  const api = { extractJson, collectTopLevelObjects };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AUH_RESPONSE_PARSER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
