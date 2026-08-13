(function(root){
  const MAX_BUNDLE_STEPS = 12;

  function isBundle(action) {
    return !!action && String(action.type || '').toLowerCase() === 'bundle';
  }

  function normalizeBundle(action) {
    if (!isBundle(action)) return null;
    const steps = Array.isArray(action.steps) ? action.steps : [];
    if (!steps.length) throw new Error('BUNDLE_EMPTY');
    if (steps.length > MAX_BUNDLE_STEPS) throw new Error('BUNDLE_TOO_LARGE');
    return {
      type: 'bundle',
      label: String(action.label || '').slice(0, 180),
      steps: steps.map(step => JSON.parse(JSON.stringify(step || {})))
    };
  }

  async function execute(bundle, executeOne, options = {}) {
    const normalized = normalizeBundle(bundle);
    const results = [];
    for (let i = 0; i < normalized.steps.length; i += 1) {
      const step = normalized.steps[i];
      const outcome = await executeOne(step, i, normalized.steps.length);
      results.push(outcome);
      if (outcome?.paused || outcome?.recoverable || outcome?.stopBundle) {
        return {ok: !outcome?.recoverable, completed: i, interrupted: true, outcome, results};
      }
      if (options.stopAfterNavigation !== false && outcome?.result?.navigation) {
        return {ok: true, completed: i + 1, interrupted: true, reason: 'navigation', results};
      }
    }
    return {ok: true, completed: normalized.steps.length, interrupted: false, results};
  }

  root.BH_LOCAL_EXECUTOR = {MAX_BUNDLE_STEPS, isBundle, normalizeBundle, execute};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BH_LOCAL_EXECUTOR;
})(typeof globalThis !== 'undefined' ? globalThis : this);
