export async function loadMotionConfig(url = './motion.config.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Motion config HTTP ${res.status}`);
  return res.json();
}

const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function transform(frame) {
  const parts = [];
  if (frame.translateX !== undefined) parts.push(`translateX(${frame.translateX}px)`);
  if (frame.translateY !== undefined) parts.push(`translateY(${frame.translateY}px)`);
  if (frame.scale !== undefined) parts.push(`scale(${frame.scale})`);
  if (frame.rotate !== undefined) parts.push(`rotate(${frame.rotate}deg)`);
  return parts.length ? parts.join(' ') : undefined;
}

function keyframe(frame) {
  const out = {};
  if (frame.opacity !== undefined) out.opacity = frame.opacity;
  const t = transform(frame);
  if (t) out.transform = t;
  return out;
}

export function createMotionEngine(config) {
  const durations = config.tokens.duration;
  const easings = config.tokens.easing;

  function animate(el, presetName, options = {}) {
    if (!el) return Promise.resolve();
    const preset = config.presets[presetName];
    if (!preset) throw new Error(`Unknown motion preset: ${presetName}`);
    const duration = reduce() && config.reducedMotion?.respectUserPreference
      ? config.reducedMotion.fallbackDurationMs ?? 0
      : durations[preset.duration];
    const anim = el.animate(
      [keyframe(preset.from), keyframe(preset.to)],
      {
        duration,
        easing: easings[preset.easing],
        fill: 'both',
        ...options
      }
    );
    return anim.finished.catch(() => undefined);
  }

  async function stagger(elements, presetName, staggerMs = 30) {
    const list = [...elements];
    return Promise.all(list.map((el, index) => animate(el, presetName, { delay: index * staggerMs })));
  }

  async function scene(sceneName, bindings = {}) {
    const sceneConfig = config.scenes[sceneName];
    if (!sceneConfig) throw new Error(`Unknown motion scene: ${sceneName}`);
    const jobs = [];
    for (const [key, target] of Object.entries(bindings)) {
      const rule = sceneConfig[key];
      if (!rule || !target) continue;
      if (typeof rule === 'string') jobs.push(animate(target, rule));
      else jobs.push(stagger(target, rule.preset, rule.staggerMs));
    }
    return Promise.all(jobs);
  }

  return { animate, stagger, scene };
}
