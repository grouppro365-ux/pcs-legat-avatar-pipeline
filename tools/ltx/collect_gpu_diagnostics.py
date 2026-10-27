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


# Every result below is a fixed public enum. Match locally, but never copy the
# provider's library name, symbol, model identifier, URL, filename or frame.
PATTERN_SIGNATURES = {
    'NATIVE_LIBRARY_MISSING': r'(?:OSError|ImportError|RuntimeError):[^\n]{0,1200}(?:cannot open shared object file|could not load (?:dynamic|shared) library|DLL load failed)',
    'NATIVE_SYMBOL_UNRESOLVED': r'(?:OSError|ImportError|RuntimeError):[^\n]{0,1200}(?:undefined symbol|symbol not found)',
    'NATIVE_ABI_MISMATCH': r'(?:OSError|ImportError|RuntimeError):[^\n]{0,1200}(?:GLIBC(?:XX)?_[0-9.]+|CXXABI_[0-9.]+)[^\n]{0,300}not found',
    'CUDA_SHARED_LIBRARY_MISSING': r'(?:OSError|ImportError|RuntimeError):[^\n]{0,1200}(?:libcuda|libcudart|libcudnn|libcublas|libcusparse)[^\n]{0,300}(?:cannot open|not found|could not load)',
    'CUDA_KERNEL_UNSUPPORTED': r'(?:RuntimeError|CUDAError):[^\n]{0,1200}(?:no kernel image is available|invalid device function|not compiled with CUDA enabled)',
    'OS_FILE_NOT_FOUND': r'(?:OSError|FileNotFoundError):\s*(?:\[Errno 2\]\s*)?No such file or directory',
    'FFMPEG_EXECUTABLE_MISSING': r'(?:OSError|FileNotFoundError):[^\n]{0,1200}No such file or directory[^\n]{0,300}ffmpeg',
    'MODEL_WEIGHTS_MISSING': r'(?:OSError|EnvironmentError):[^\n]{0,1200}(?:no file named [^\n]{0,300}(?:[.]bin|[.]safetensors|[.]pth|[.]pt|[.]ckpt)[^\n]{0,300}found|none of the following files)',
    'MODEL_TOKENIZER_LOAD_FAILED': r'(?:OSError|EnvironmentError):[^\n]{0,1200}(?:can.t load tokenizer for|could not load tokenizer)',
    'MODEL_PROCESSOR_LOAD_FAILED': r'(?:OSError|EnvironmentError):[^\n]{0,1200}(?:can.t load (?:image processor|feature extractor|processor) for|could not load (?:image processor|feature extractor))',
    'MODEL_PARAMETER_SHAPE_MISMATCH': r'RuntimeError:[^\n]{0,1200}(?:size mismatch for|mismatching parameter shapes|shape mismatch)',
    'MODEL_WEIGHT_FORMAT_INVALID': r'(?:SafetensorError|RuntimeError):[^\n]{0,1200}(?:error while deserializing header|invalid header|metadata incomplete buffer|failed finding central directory)',
    'HF_LOCAL_CACHE_MISS': r'(?:LocalEntryNotFoundError:|(?:OSError|EnvironmentError):[^\n]{0,1200}(?:couldn.t find[^\n]{0,500}cached files|local_files_only[^\n]{0,300}(?:not found|cannot find)))',
    'HF_MODEL_ACCESS_UNAUTHORIZED': r'(?:HfHubHTTPError|HTTPError|OSError):[^\n]{0,1200}(?:401|403)[^\n]{0,500}huggingface[.]co',
}
COMPONENT_PATHS = {
    'ECHO_RUNTIME': r'(?:/echomimic_v2/|/infer_acc[.]py\b)',
    'DIFFUSERS': r'/diffusers/', 'TRANSFORMERS': r'/transformers/',
    'WHISPER': r'/whisper/', 'ONNXRUNTIME': r'/onnxruntime/',
    'INSIGHTFACE': r'/insightface/', 'TORCH': r'/torch/',
    'TORCHVISION': r'/torchvision/', 'CV2': r'/cv2/',
    'XFORMERS': r'/xformers/', 'SAFETENSORS': r'/safetensors/',
}


def normalized_log(text):
    # A Kaggle log may itself be JSON. Decode the common serialized formatting
    # needed for matching, without printing or returning any decoded source.
    text = text.replace('\\u001b', '\x1b').replace('\\x1b', '\x1b')
    text = text.replace('\\r', '\r').replace('\\n', '\n').replace('\\"', '"')
    return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)


def traceback_components(text):
    # Only actual Python frame lines contribute component hints. A normal model
    # download message or a printed command is not evidence of a failing frame.
    frames = re.findall(r'(?m)^\s*File\s+[^\n]{1,1500}[.]py(?:["\x27],\s*line\s+\d+|:\d+)[^\n]{0,300}', text)
    return sorted(name for name, pattern in COMPONENT_PATHS.items()
                  if any(re.search(pattern, frame.replace('\\', '/'), re.IGNORECASE) for frame in frames))


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
    text = normalized_log(text)
    classes = set(re.findall(r'\b(?:[a-zA-Z_][a-zA-Z0-9_]*[.])*([A-Z][A-Za-z]{0,70}(?:Error|Exception)):', text))
    modules = set(re.findall(r"ModuleNotFoundError: No module named ['\"]([A-Za-z0-9_.]{1,150})['\"]", text))
    imports = set(re.findall(r"ImportError: cannot import name ['\"]([A-Za-z0-9_]{1,150})['\"]", text))
    codes = {code for code, signature in SIGNATURES.items() if signature in text}
    codes.update(code for code, pattern in PATTERN_SIGNATURES.items()
                 if re.search(pattern, text, re.IGNORECASE))
    return {'exception_types': sorted(classes)[:30], 'missing_modules': sorted(modules)[:30],
            'failed_import_names': sorted(imports)[:30], 'cuda_out_of_memory': 'CUDA out of memory' in text,
            'diagnostic_codes': sorted(codes), 'component_hints': traceback_components(text)}


def collect(directory):
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    files = sorted(root.rglob('*.log'))[:10]
    reports = []
    for path in files:
        # Never echo a provider filename: it may contain private information.
        scope = 'CURRENT_VERSION' if path.name == 'kernel-private.log' else 'PREVIOUS_VERSION' if path.name == 'previous.log' else 'UNATTRIBUTED'
        with path.open('rb') as handle:
            raw = handle.read(2_000_001)
            truncated = len(raw) > 2_000_000
            if truncated:
                handle.seek(-1_000_000, 2)
                raw = raw[:1_000_000] + b'\n' + handle.read(1_000_000)
        text = raw.decode('utf-8', errors='replace')
        reports.append({'scope': scope, 'log_truncated': truncated, **summarize(text)})
    result = {'log_files_found': len(files)}
    for field in ('exception_types', 'missing_modules', 'failed_import_names', 'diagnostic_codes', 'component_hints'):
        result[field] = sorted({value for report in reports for value in report[field]})[:30]
    result.update(cuda_out_of_memory=any(r['cuda_out_of_memory'] for r in reports),
                  log_diagnostics=reports, avatar_stage=stage_receipt(root), raw_logs_included=False)
    (root / 'pcs-gpu-diagnostics.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    print(json.dumps(collect(sys.argv[1])))
