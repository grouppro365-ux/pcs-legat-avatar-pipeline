(function(root){
  function valid(obj, requestId){
    return !!obj && obj.requestId === requestId && (obj.status === 'act' || obj.status === 'done');
  }

  function parse(text, requestId, parser){
    if(!text || !parser?.extractJson) return null;
    try{
      const obj = parser.extractJson(String(text), requestId);
      return valid(obj, requestId) ? obj : null;
    }catch{
      return null;
    }
  }

  function find(requestId, fragments, parser){
    const parts = (fragments || []).map(x => String(x || '').trim()).filter(Boolean);

    // Prefer a complete recent turn/block first.
    for(let i = parts.length - 1; i >= 0; i--){
      const obj = parse(parts[i], requestId, parser);
      if(obj) return {obj, text:JSON.stringify(obj), method:'single_fragment'};
    }

    // ChatGPT may render one JSON answer as several DOM fragments. Join bounded
    // suffix windows so an incomplete prefix does not hide a complete response.
    const maxParts = 80;
    const start = Math.max(0, parts.length - maxParts);
    for(let i = parts.length - 1; i >= start; i--){
      const joined = parts.slice(i).join('\n');
      const obj = parse(joined, requestId, parser);
      if(obj) return {obj, text:JSON.stringify(obj), method:'joined_fragments'};
    }

    const all = parts.slice(start).join('\n');
    const obj = parse(all, requestId, parser);
    return obj ? {obj, text:JSON.stringify(obj), method:'aggregate'} : null;
  }

  const api = {find};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AUH_CHAT_RESPONSE_MATCHER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
