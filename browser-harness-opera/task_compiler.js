(function(root){
  const BATCH_RE = /(?:\b(?:all|every|each|whole|batch)\b|\bвсе\b|\bвсех\b|\bкажд(?:ый|ую|ое|ые|ого|ой)\b|массов|пакетн)/iu;

  function isBatchTask(task) {
    return BATCH_RE.test(String(task || ''));
  }

  function maxStepsFor(task) {
    return isBatchTask(task) ? 500 : 120;
  }

  function compilerInstructions() {
    return [
      'TOKEN-EFFICIENT EXECUTION MODE:',
      '- You are not a remote mouse. Use reasoning only where reasoning is needed.',
      '- If several deterministic interactions can be decided from the CURRENT PAGE snapshot, return one bundle action instead of one micro-action.',
      '- A bundle can contain at most 12 ordered steps. Each step must be independently targetable from the current page state.',
      '- Good bundle candidates: fill several fields, select options, toggle controls, open a panel and fill its fields, then wait/assert the result.',
      '- Do NOT put a navigation-causing action before later bundle steps. A link/form action likely to replace the document must be the final bundle step.',
      '- Do NOT bundle across an unseen page. After navigation, let Browser Harness Observe again.',
      '- For content work, produce the substantive text once, then put all deterministic editor-field updates that are visible now into the same bundle.',
      '- Prefer 1 useful AI decision + many local browser actions over repeated AI calls for each click/fill.',
      '- If the current state is ambiguous or a fresh semantic decision is required, return a normal single action and re-observe.'
    ].join('\n');
  }

  root.BH_TASK_COMPILER = {isBatchTask, maxStepsFor, compilerInstructions};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BH_TASK_COMPILER;
})(typeof globalThis !== 'undefined' ? globalThis : this);
