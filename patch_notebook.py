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

# Stage receipts contain fixed public enums only. The provider traceback stays
# in private kernel logs; neither commands, prompts, source nor paths are copied.
AVATAR_STAGES = (
    ('from pathlib import Path', 'SETUP'),
    ('# GPU gate', 'GPU_CHECK'),
    ('# Locate the private master portrait.', 'PRIVATE_ASSET'),
    ('# Free stable test voices', 'TTS'),
    ('# Create isolated Python 3.10 environments', 'ENVIRONMENT'),
    ('# EchoMimicV2: official repository', 'ECHO_INSTALL'),
    ('# Download the official EchoMimicV2 accelerated weights', 'ECHO_WEIGHTS'),
    ('# EchoMimicV2 smoke render', 'ECHO_RENDER'),
    ('# MuseTalk 1.5 in its own', 'MUSE_INSTALL'),
    ('# Download MuseTalk 1.5 and auxiliary weights', 'MUSE_WEIGHTS'),
    ('# Lip-sync the same body-motion source', 'MUSE_RENDER'),
    ('# Normalize delivery files', 'EXPORT'),
    ('# Technical QA', 'QA'),
    ('# Validate the OpenMontage source', 'OPENMONTAGE'),
)

stage_helper = r"""# Fixed-shape diagnostics for the existing private avatar runtime.
import json as _pcs_stage_json
from pathlib import Path as _pcs_stage_path

_PCS_AVATAR_ERROR_TYPES = frozenset({
    'CalledProcessError', 'OSError', 'RuntimeError', 'ValueError', 'TypeError',
    'KeyError', 'FileNotFoundError', 'ModuleNotFoundError', 'ImportError',
    'AssertionError', 'PermissionError', 'TimeoutError',
})
_PCS_AVATAR_STAGES = frozenset({
    'SETUP', 'GPU_CHECK', 'PRIVATE_ASSET', 'TTS', 'ENVIRONMENT',
    'ECHO_INSTALL', 'ECHO_WEIGHTS', 'ECHO_RENDER', 'MUSE_INSTALL',
    'MUSE_WEIGHTS', 'MUSE_RENDER', 'EXPORT', 'QA', 'OPENMONTAGE',
})

def _pcs_avatar_stage(stage, status, error=None):
    if stage not in _PCS_AVATAR_STAGES or status not in {'RUNNING', 'COMPLETE', 'FAILED'}:
        raise RuntimeError('avatar_stage_identity_invalid')
    name = type(error).__name__ if error is not None else None
    error_type = name if name in _PCS_AVATAR_ERROR_TYPES else 'OTHER' if error is not None else None
    errno = getattr(error, 'errno', None)
    returncode = getattr(error, 'returncode', None)
    record = {
        'stage': stage, 'status': status, 'error_type': error_type,
        'errno': errno if type(errno) is int and -4095 <= errno <= 4095 else None,
        'returncode': returncode if type(returncode) is int and -255 <= returncode <= 255 else None,
    }
    # Diagnostics must not replace the original execution error if disk is full.
    try:
        directory = _pcs_stage_path('/kaggle/working/output')
        directory.mkdir(parents=True, exist_ok=True)
        temporary = directory / 'pcs-avatar-stage.json.part'
        temporary.write_text(_pcs_stage_json.dumps(record) + '\n', encoding='utf-8')
        temporary.replace(directory / 'pcs-avatar-stage.json')
    except OSError:
        pass
"""

stage_seen = set()
for cell in nb.get('cells', []):
    if cell.get('cell_type') != 'code':
        continue
    source = ''.join(cell.get('source', []))
    first_line = next((line.strip() for line in source.splitlines() if line.strip()), '')
    matches = [stage for prefix, stage in AVATAR_STAGES if first_line.startswith(prefix)]
    if len(matches) != 1 or matches[0] in stage_seen:
        raise RuntimeError('avatar_stage_markers_changed')
    stage = matches[0]
    stage_seen.add(stage)
    # A try block has no new Python scope: notebook variables remain available
    # to the following cells exactly as before instrumentation.
    wrapped = (stage_helper + '\n' if stage == 'SETUP' else '')
    wrapped += f"_pcs_avatar_stage({stage!r}, 'RUNNING')\ntry:\n"
    wrapped += ''.join('    ' + line if line.strip() else line for line in source.splitlines(keepends=True))
    if not wrapped.endswith('\n'):
        wrapped += '\n'
    wrapped += f"except Exception as _pcs_avatar_error:\n    _pcs_avatar_stage({stage!r}, 'FAILED', _pcs_avatar_error)\n    raise\nelse:\n    _pcs_avatar_stage({stage!r}, 'COMPLETE')\n"
    # Every generated code cell must compile before the source notebook is replaced.
    compile(wrapped, '<pcs-avatar-cell>', 'exec')
    cell['source'] = wrapped.splitlines(keepends=True)
    cell['outputs'] = []
    cell['execution_count'] = None
if stage_seen != {stage for _, stage in AVATAR_STAGES}:
    raise RuntimeError('avatar_stage_markers_changed')

path.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding='utf-8')
print(
    f'Patched {path}: uv-managed Python 3.10, setuptools<81, '
    'onnxruntime-gpu 1.20.2, no-build-isolation, and verified Whisper tiny.pt.'
)
