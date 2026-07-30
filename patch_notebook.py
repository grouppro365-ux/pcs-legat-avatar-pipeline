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
weight_matches = 0

old_echo = "run(ECHO_PIP + ['install', '-r', str(ECHO/'requirements.txt')])"
new_echo = "echo_requirements = ECHO / 'requirements.txt'\necho_req_text = echo_requirements.read_text(encoding='utf-8')\nif 'onnxruntime-gpu==1.20.1' not in echo_req_text:\n    raise RuntimeError('Expected onnxruntime-gpu==1.20.1 in EchoMimicV2 requirements.')\necho_requirements.write_text(echo_req_text.replace('onnxruntime-gpu==1.20.1', 'onnxruntime-gpu==1.20.2'), encoding='utf-8')\nrun(ECHO_PIP + ['install', '--no-build-isolation', '-r', str(echo_requirements)])"

weights_marker = "required_echo = ["
tiny_weight_block = '''# The EchoMimicV2 model snapshot does not always include Whisper tiny.pt.
# Download the exact checkpoint referenced by the official EchoMimicV2 README and verify it.
import hashlib
import urllib.request

tiny_weight = ECHO / 'pretrained_weights' / 'audio_processor' / 'tiny.pt'
tiny_weight.parent.mkdir(parents=True, exist_ok=True)
tiny_sha256 = '65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9'
tiny_url = 'https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt'

def file_sha256(file_path):
    digest = hashlib.sha256()
    with open(file_path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

if not tiny_weight.exists() or file_sha256(tiny_weight) != tiny_sha256:
    tiny_tmp = tiny_weight.with_suffix('.pt.part')
    tiny_tmp.unlink(missing_ok=True)
    print('Downloading official Whisper tiny.pt...')
    urllib.request.urlretrieve(tiny_url, tiny_tmp)
    actual_sha256 = file_sha256(tiny_tmp)
    if actual_sha256 != tiny_sha256:
        tiny_tmp.unlink(missing_ok=True)
        raise RuntimeError(
            f'Whisper tiny.pt checksum mismatch: expected {tiny_sha256}, got {actual_sha256}'
        )
    tiny_tmp.replace(tiny_weight)
print('Whisper tiny.pt ready:', tiny_weight, tiny_weight.stat().st_size)

'''

for cell in nb.get('cells', []):
    source = ''.join(cell.get('source', []))
    changed = False

    if env_marker in source:
        source = env_replacement
        env_matches += 1
        changed = True
    else:
        occurrences = source.count(old_echo)
        if occurrences:
            source = source.replace(old_echo, new_echo)
            echo_matches += occurrences
            changed = True

        weight_occurrences = source.count(weights_marker)
        if weight_occurrences:
            source = source.replace(weights_marker, tiny_weight_block + weights_marker)
            weight_matches += weight_occurrences
            changed = True

    if changed:
        cell['source'] = source.splitlines(keepends=True)
        cell['outputs'] = []
        cell['execution_count'] = None

if env_matches != 1:
    raise RuntimeError(f'Expected exactly one environment cell, found {env_matches}.')
if echo_matches != 1:
    raise RuntimeError(f'Expected exactly one EchoMimicV2 requirements install, found {echo_matches}.')
if weight_matches != 1:
    raise RuntimeError(f'Expected exactly one EchoMimicV2 weight validation block, found {weight_matches}.')

path.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding='utf-8')
print(
    f'Patched {path}: uv-managed Python 3.10, setuptools<81, '
    'onnxruntime-gpu 1.20.2, no-build-isolation, and verified Whisper tiny.pt.'
)
