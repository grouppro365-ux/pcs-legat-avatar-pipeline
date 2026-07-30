import json
from pathlib import Path

path = Path('kaggle_avatar_pipeline.ipynb')
nb = json.loads(path.read_text(encoding='utf-8'))

env_marker = 'Create isolated Python 3.10 environments'
env_replacement = '''# Create isolated Python 3.10 environments with uv. Kaggle's notebook host uses Python 3.12,
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

# OpenAI CLIP's legacy setup.py still imports pkg_resources. setuptools 81+ removed it,
# so keep setuptools below 81 and disable build isolation for EchoMimicV2 requirements.
run(ECHO_PIP + ['install', '-U', 'pip', 'setuptools<81', 'wheel'])
run(MUSE_PIP + ['install', '-U', 'pip', 'setuptools<81', 'wheel'])
print(subprocess.check_output([str(ECHO_PY), '--version'], text=True).strip())
print(subprocess.check_output([str(MUSE_PY), '--version'], text=True).strip())
'''

env_matches = 0
echo_matches = 0

old_echo = "run(ECHO_PIP + ['install', '-r', str(ECHO/'requirements.txt')])"
new_echo = "run(ECHO_PIP + ['install', '--no-build-isolation', '-r', str(ECHO/'requirements.txt')])"

for cell in nb.get('cells', []):
    source = ''.join(cell.get('source', []))
    changed = False

    if env_marker in source:
        cell['source'] = env_replacement.splitlines(keepends=True)
        env_matches += 1
        changed = True
    else:
        occurrences = source.count(old_echo)
        if occurrences:
            source = source.replace(old_echo, new_echo)
            cell['source'] = source.splitlines(keepends=True)
            echo_matches += occurrences
            changed = True

    if changed:
        cell['outputs'] = []
        cell['execution_count'] = None

if env_matches != 1:
    raise RuntimeError(f'Expected exactly one environment cell, found {env_matches}.')
if echo_matches != 1:
    raise RuntimeError(f'Expected exactly one EchoMimicV2 requirements install, found {echo_matches}.')

path.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding='utf-8')
print(
    f'Patched {path}: uv-managed Python 3.10, setuptools<81, '
    'and no-build-isolation for EchoMimicV2 requirements.'
)
