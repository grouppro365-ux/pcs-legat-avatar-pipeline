import json
from pathlib import Path

path = Path('kaggle_avatar_pipeline.ipynb')
nb = json.loads(path.read_text(encoding='utf-8'))
marker = 'Create isolated Python 3.10 environments'
replacement = '''# Create isolated Python 3.10 environments with uv. Kaggle's notebook host uses Python 3.12,
# while EchoMimicV2 and MuseTalk target Python 3.10. uv downloads a managed interpreter
# into /tmp and does not require conda or a persistent server.
run([sys.executable, '-m', 'pip', 'install', '-q', 'uv>=0.8.0'])
UV = shutil.which('uv')
if not UV:
    raise RuntimeError('uv executable was not installed.')

UV_ENV = {
    **os.environ,
    'UV_PYTHON_INSTALL_DIR': str(RUNTIME / 'uv-python'),
    'UV_CACHE_DIR': str(RUNTIME / 'uv-cache'),
    'UV_LINK_MODE': 'copy',
}
run([UV, 'python', 'install', '3.10'], env=UV_ENV)

ECHO_ENV = RUNTIME / 'env-echo310'
MUSE_ENV = RUNTIME / 'env-muse310'
run([UV, 'venv', '--python', '3.10', '--seed', str(ECHO_ENV)], env=UV_ENV)
run([UV, 'venv', '--python', '3.10', '--seed', str(MUSE_ENV)], env=UV_ENV)
ECHO_PY = ECHO_ENV / 'bin/python'
MUSE_PY = MUSE_ENV / 'bin/python'
ECHO_PIP = [str(ECHO_PY), '-m', 'pip']
MUSE_PIP = [str(MUSE_PY), '-m', 'pip']
run(ECHO_PIP + ['install', '-U', 'pip', 'setuptools', 'wheel'])
run(MUSE_PIP + ['install', '-U', 'pip', 'setuptools', 'wheel'])
print(subprocess.check_output([str(ECHO_PY), '--version'], text=True).strip())
print(subprocess.check_output([str(MUSE_PY), '--version'], text=True).strip())
'''

matches = 0
for cell in nb.get('cells', []):
    source = ''.join(cell.get('source', []))
    if marker in source:
        cell['source'] = replacement.splitlines(keepends=True)
        cell['outputs'] = []
        cell['execution_count'] = None
        matches += 1

if matches != 1:
    raise RuntimeError(f'Expected exactly one environment cell, found {matches}.')

path.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'Patched {path} with uv-managed Python 3.10 environments.')
