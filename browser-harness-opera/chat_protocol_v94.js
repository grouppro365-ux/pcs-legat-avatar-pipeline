(function(root){
  const flat = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function requestTurnIndex(turns, requestId) {
    for (let i = (turns || []).length - 1; i >= 0; i -= 1) {
      if (turns[i]?.role === 'user' && String(turns[i]?.text || '').includes(requestId)) return i;
    }
    return -1;
  }

  function assistantFragmentsAfterRequest(turns, requestId) {
    const start = requestTurnIndex(turns, requestId);
    if (start < 0) return [];
    const out = [];
    for (let i = start + 1; i < turns.length; i += 1) {
      const turn = turns[i];
      if (turn?.role === 'user') break;
      if (turn?.role === 'assistant' && String(turn.text || '').trim()) out.push(String(turn.text));
    }
    return out;
  }

  function parseAssistantFragments(fragments, requestId, marker, extractJson, requireMarker = true) {
    if (!Array.isArray(fragments) || !fragments.length) return null;
    if (requireMarker && !fragments.some(text => String(text).includes(marker))) return null;
    const candidates = [...fragments].reverse();
    candidates.push(fragments.join('\n'));
    for (const text of candidates) {
      try {
        const obj = extractJson(String(text), requestId);
        if (obj?.requestId === requestId) return obj;
      } catch {}
    }
    return null;
  }

  const api = {flat, requestTurnIndex, assistantFragmentsAfterRequest, parseAssistantFragments};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BH_CHAT94 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
