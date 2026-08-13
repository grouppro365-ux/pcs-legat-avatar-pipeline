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

  function textBlock(text, id) {
    const key = String(id || '').replace(/[^A-Za-z0-9_-]/g, '_');
    if (!key) return null;
    const start = `<<<ABH_TEXT:${key}>>>`;
    const end = `<<<ABH_END_TEXT:${key}>>>`;
    const a = String(text || '').indexOf(start);
    if (a < 0) return null;
    const b = String(text || '').indexOf(end, a + start.length);
    if (b < 0) return null;
    return String(text || '').slice(a + start.length, b).replace(/^\s*\n?/, '').replace(/\n?\s*$/, '');
  }

  function hydrateTextBlock(obj, source) {
    const action = obj?.action;
    if (obj?.status !== 'act' || action?.type !== 'fill' || action.value != null || !action.textBlockId) return obj;
    const value = textBlock(source, action.textBlockId);
    if (value == null) return null;
    action.value = value;
    return obj;
  }

  function balancedObjectAfter(raw, key, from = 0) {
    const keyPos = raw.indexOf(key, from);
    if (keyPos < 0) return null;
    const start = raw.indexOf('{', keyPos + key.length);
    if (start < 0) return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < raw.length; i += 1) {
      const c = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
    return null;
  }

  function decodeLooseText(value) {
    const raw = String(value ?? '');
    try { return JSON.parse(`"${raw}"`); } catch {}
    return raw
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  // Recovery for a real live failure: the model returned a long fill.value with
  // unescaped quotes inside Russian prose (for example: ванная "плачет").
  // The control object is recoverable even though strict JSON.parse is not.
  function recoverMalformedFill(text, requestId) {
    const raw = String(text || '');
    const reqPos = raw.lastIndexOf(String(requestId || ''));
    if (reqPos < 0) return null;
    const objectStart = raw.lastIndexOf('{', reqPos);
    if (objectStart < 0) return null;
    const head = raw.slice(objectStart);
    if (!/"status"\s*:\s*"act"/.test(head) || !/"type"\s*:\s*"fill"/.test(head)) return null;

    const valueKey = head.indexOf('"value"');
    if (valueKey < 0) return null;
    const colon = head.indexOf(':', valueKey + 7);
    if (colon < 0) return null;
    const openingQuote = head.indexOf('"', colon + 1);
    if (openingQuote < 0) return null;

    const boundaries = ['"},"progress"', '"},"reason"', '"},"completionMarker"', '"}}'];
    let end = -1;
    for (const token of boundaries) {
      const p = head.lastIndexOf(token);
      if (p > openingQuote && p > end) end = p;
    }
    if (end < 0) return null;

    const targetText = balancedObjectAfter(head, '"target"');
    if (!targetText) return null;
    let target;
    try { target = JSON.parse(targetText); } catch { return null; }

    let progress;
    const progressText = balancedObjectAfter(head, '"progress"', end);
    if (progressText) { try { progress = JSON.parse(progressText); } catch {} }

    const obj = {
      requestId: String(requestId),
      status: 'act',
      action: {type:'fill', target, value:decodeLooseText(head.slice(openingQuote + 1, end))}
    };
    if (progress) obj.progress = progress;
    return obj;
  }

  function parseAssistantFragments(fragments, requestId, marker, extractJson, requireMarker = true) {
    if (!Array.isArray(fragments) || !fragments.length) return null;
    const combined = fragments.join('\n');
    if (requireMarker && !combined.includes(marker)) return null;

    const candidates = [...fragments].reverse();
    candidates.push(combined);
    for (const text of candidates) {
      try {
        const obj = extractJson(String(text), requestId);
        const hydrated = hydrateTextBlock(obj, combined);
        if (hydrated?.requestId === requestId) return hydrated;
      } catch {}
    }
    for (const text of candidates) {
      const recovered = recoverMalformedFill(text, requestId);
      if (recovered) return recovered;
    }
    return null;
  }

  const api = {
    flat, requestTurnIndex, assistantFragmentsAfterRequest,
    textBlock, hydrateTextBlock, recoverMalformedFill, parseAssistantFragments
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BH_CHAT94 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
