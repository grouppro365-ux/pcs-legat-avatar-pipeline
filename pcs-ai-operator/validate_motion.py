import json
from pathlib import Path

CONFIG = Path(__file__).with_name('motion.config.json')

REQUIRED_PRESET_KEYS = {'from', 'to', 'duration', 'easing'}
ALLOWED_TRANSFORM_KEYS = {'opacity', 'translateX', 'translateY', 'scale', 'rotate'}


def fail(message: str) -> None:
    raise SystemExit(f'MOTION CONFIG INVALID: {message}')


def main() -> None:
    data = json.loads(CONFIG.read_text(encoding='utf-8'))
    tokens = data.get('tokens', {})
    durations = tokens.get('duration', {})
    easings = tokens.get('easing', {})
    presets = data.get('presets', {})

    if not presets:
        fail('presets is empty')

    for name, preset in presets.items():
        missing = REQUIRED_PRESET_KEYS - preset.keys()
        if missing:
            fail(f'{name}: missing {sorted(missing)}')
        if preset['duration'] not in durations:
            fail(f"{name}: unknown duration token {preset['duration']}")
        if preset['easing'] not in easings:
            fail(f"{name}: unknown easing token {preset['easing']}")
        for side in ('from', 'to'):
            unknown = set(preset[side]) - ALLOWED_TRANSFORM_KEYS
            if unknown:
                fail(f'{name}.{side}: unsupported keys {sorted(unknown)}')

    for scene_name, scene in data.get('scenes', {}).items():
        for key, value in scene.items():
            if isinstance(value, str):
                preset_name = value
            elif isinstance(value, dict):
                preset_name = value.get('preset')
                stagger = value.get('staggerMs', 0)
                if not isinstance(stagger, int) or stagger < 0 or stagger > 300:
                    fail(f'{scene_name}.{key}: invalid staggerMs')
            else:
                fail(f'{scene_name}.{key}: invalid scene value')
            if preset_name not in presets:
                fail(f'{scene_name}.{key}: unknown preset {preset_name}')

    print(f'MOTION CONFIG PASS: {len(presets)} presets, {len(data.get("scenes", {}))} scenes')


if __name__ == '__main__':
    main()
