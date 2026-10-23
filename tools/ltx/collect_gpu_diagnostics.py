"""Persist only allowlisted diagnostics; never upload raw private notebook logs."""
import json
from pathlib import Path
import re
import sys


def collect(directory):
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    classes, modules, imports = set(), set(), set()
    oom = False
    codes = set()
    signatures = {
        'VENV_ENSUREPIP_UNAVAILABLE': 'ensurepip is not available',
        'PYTORCH_WHEEL_UNAVAILABLE': 'No matching distribution found for torch',
        'GPU_RUNTIME_REQUIRED': 'requires_existing_kaggle_gpu_runtime',
        'GPU_UNAVAILABLE': 'gpu_unavailable',
        'DISK_FULL': 'No space left on device',
        'DEPENDENCY_RESOLUTION_FAILED': 'ResolutionImpossible',
        'TLS_CERTIFICATE_FAILED': 'CERTIFICATE_VERIFY_FAILED',
    }
    files = list(root.rglob('*.log'))[:10]
    for path in files:
        # Kernel logs may contain private assets/prompts: no verbatim lines leave here.
        text = path.read_bytes()[:2_000_000].decode('utf-8', errors='replace')
        # Kaggle logs can carry ANSI colors or JSON-escaped line breaks.
        text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text).replace('\\n', '\n')
        classes.update(re.findall(r'\b(?:[a-zA-Z_][a-zA-Z0-9_]*[.])*([A-Z][A-Za-z]{0,70}(?:Error|Exception)):', text))
        modules.update(re.findall(r"ModuleNotFoundError: No module named ['\"]([A-Za-z0-9_.]{1,150})['\"]", text))
        imports.update(re.findall(r"ImportError: cannot import name ['\"]([A-Za-z0-9_]{1,150})['\"]", text))
        oom = oom or 'CUDA out of memory' in text
        codes.update(code for code, signature in signatures.items() if signature in text)
    result = {'log_files_found': len(files), 'exception_types': sorted(classes)[:30],
              'missing_modules': sorted(modules)[:30], 'failed_import_names': sorted(imports)[:30],
              'cuda_out_of_memory': oom, 'diagnostic_codes': sorted(codes), 'raw_logs_included': False}
    (root / 'pcs-gpu-diagnostics.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    print(json.dumps(collect(sys.argv[1])))
