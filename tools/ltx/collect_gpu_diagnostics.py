"""Persist bounded diagnostic codes; never upload raw private notebook logs."""
import json
from pathlib import Path
import re
import sys

STAGES = frozenset('SETUP GPU_CHECK PRIVATE_ASSET TTS ENVIRONMENT ECHO_INSTALL ECHO_WEIGHTS ECHO_RENDER MUSE_INSTALL MUSE_WEIGHTS MUSE_RENDER EXPORT QA OPENMONTAGE'.split())
ERROR_TYPES = frozenset('CalledProcessError OSError RuntimeError ValueError TypeError KeyError FileNotFoundError ModuleNotFoundError ImportError AssertionError PermissionError TimeoutError OTHER'.split())
SIGNATURES = {
    'VENV_ENSUREPIP_UNAVAILABLE': 'ensurepip is not available',
    'PYTORCH_WHEEL_UNAVAILABLE': 'No matching distribution found for torch',
    'GPU_RUNTIME_REQUIRED': 'requires_existing_kaggle_gpu_runtime',
    'GPU_UNAVAILABLE': 'gpu_unavailable',
    'DISK_FULL': 'No space left on device',
    'DEPENDENCY_RESOLUTION_FAILED': 'ResolutionImpossible',
    'TLS_CERTIFICATE_FAILED': 'CERTIFICATE_VERIFY_FAILED',
    'MODEL_FILES_MISSING': 'does not appear to have a file named',
    'MODEL_LOAD_FAILED': "Can't load the model for",
    'MODEL_CONFIG_LOAD_FAILED': "Can't load the config for",
    'MODEL_ACCESS_DENIED': 'GatedRepoError:',
    'MODEL_REPOSITORY_NOT_FOUND': 'RepositoryNotFoundError:',
    'NETWORK_CONNECTION_FAILED': 'ConnectionError:',
}


def stage_receipt(root):
    # The exact filename and a fixed schema prevent arbitrary JSON output from
    # becoming a public diagnostics attachment. No exception messages are read.
    paths = list(root.rglob('pcs-avatar-stage.json'))[:2]
    if not paths:
        return {'status': 'UNAVAILABLE'}
    if len(paths) != 1:
        return {'status': 'INVALID'}
    try:
        with paths[0].open('rb') as handle:
            raw = handle.read(2049)
        if len(raw) > 2048:
            return {'status': 'INVALID'}
        value = json.loads(raw)
        if (not isinstance(value, dict) or set(value) != {'stage', 'status', 'error_type', 'errno', 'returncode'}
                or value['stage'] not in STAGES or value['status'] not in {'RUNNING', 'COMPLETE', 'FAILED'}
                or value['error_type'] is not None and value['error_type'] not in ERROR_TYPES):
            return {'status': 'INVALID'}
        for name, bound in [('errno', 4095), ('returncode', 255)]:
            number = value[name]
            if number is not None and (type(number) is not int or not -bound <= number <= bound):
                return {'status': 'INVALID'}
        if value['status'] != 'FAILED' and any(value[k] is not None for k in ('error_type', 'errno', 'returncode')):
            return {'status': 'INVALID'}
        if value['status'] == 'FAILED' and value['error_type'] is None:
            return {'status': 'INVALID'}
        return value
    except (OSError, ValueError, TypeError):
        return {'status': 'INVALID'}


def summarize(text):
    # Kaggle logs can carry ANSI colors or JSON-escaped line breaks.
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text).replace('\\n', '\n')
    classes = set(re.findall(r'\b(?:[a-zA-Z_][a-zA-Z0-9_]*[.])*([A-Z][A-Za-z]{0,70}(?:Error|Exception)):', text))
    modules = set(re.findall(r"ModuleNotFoundError: No module named ['\"]([A-Za-z0-9_.]{1,150})['\"]", text))
    imports = set(re.findall(r"ImportError: cannot import name ['\"]([A-Za-z0-9_]{1,150})['\"]", text))
    return {'exception_types': sorted(classes)[:30], 'missing_modules': sorted(modules)[:30],
            'failed_import_names': sorted(imports)[:30], 'cuda_out_of_memory': 'CUDA out of memory' in text,
            'diagnostic_codes': sorted(code for code, signature in SIGNATURES.items() if signature in text)}


def collect(directory):
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    files = sorted(root.rglob('*.log'))[:10]
    reports = []
    for path in files:
        # Never echo a provider filename: it may contain private information.
        scope = 'CURRENT_VERSION' if path.name == 'kernel-private.log' else 'PREVIOUS_VERSION' if path.name == 'previous.log' else 'UNATTRIBUTED'
        with path.open('rb') as handle:
            text = handle.read(2_000_000).decode('utf-8', errors='replace')
        reports.append({'scope': scope, **summarize(text)})
    result = {'log_files_found': len(files)}
    for field in ('exception_types', 'missing_modules', 'failed_import_names', 'diagnostic_codes'):
        result[field] = sorted({value for report in reports for value in report[field]})[:30]
    result.update(cuda_out_of_memory=any(r['cuda_out_of_memory'] for r in reports),
                  log_diagnostics=reports, avatar_stage=stage_receipt(root), raw_logs_included=False)
    (root / 'pcs-gpu-diagnostics.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    print(json.dumps(collect(sys.argv[1])))
