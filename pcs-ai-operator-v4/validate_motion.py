import json, pathlib, sys
p=pathlib.Path(__file__).with_name('motion.config.json')
try:
    cfg=json.loads(p.read_text(encoding='utf-8'))
    assert cfg.get('version')==1
    assert isinstance(cfg.get('presets'), dict) and cfg['presets']
    for name,v in cfg['presets'].items():
        assert isinstance(v, dict), name
        if 'duration' in v: assert 0 <= int(v['duration']) <= 2000, name
        if 'stagger' in v: assert 0 <= int(v['stagger']) <= 500, name
    print('motion.config.json: PASS')
except Exception as e:
    print('motion.config.json: FAIL', e)
    sys.exit(1)
