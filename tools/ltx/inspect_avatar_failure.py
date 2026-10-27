"""Read sanitized diagnostics for one accepted version; never submit a GPU job."""
import json
from pathlib import Path
import sys
import tempfile

from collect_gpu_diagnostics import collect
from kaggle_existing_run import CANONICAL

MAX_LOG_BYTES = 100_000_000


def inspect_version(api, version, directory):
    if type(version) is not int or not 1 <= version <= 2_147_483_647:
        raise ValueError('kernel_diagnostic_version_invalid')
    target = Path(directory)
    target.mkdir(parents=True, exist_ok=True)
    ref = CANONICAL + '/' + str(version)
    # Keep the provider's private raw log in a temporary directory only.
    with tempfile.TemporaryDirectory() as temporary:
        try:
            # Kaggle's summary log can contain only the outer notebook error.
            # The official pinned SDK stream API also reads the complete persisted
            # event blob for a completed version, without downloading output media.
            events = api.kernels_logs_stream(ref)
            total = 0
            has_text = False
            try:
                with Path(temporary, 'kernel-private.log').open('w', encoding='utf-8') as handle:
                    for event in events:
                        if not isinstance(event, dict) or not isinstance(event.get('data'), str):
                            raise RuntimeError('kernel_diagnostic_log_invalid')
                        has_text = has_text or bool(event['data'].strip())
                        data = event['data'] + '\n'
                        total += len(data.encode('utf-8'))
                        if total > MAX_LOG_BYTES:
                            raise RuntimeError('kernel_diagnostic_log_too_large')
                        handle.write(data)
                if not has_text:
                    raise RuntimeError('kernel_diagnostic_log_empty')
            finally:
                close = getattr(events, 'close', None)
                if callable(close):
                    close()
        except Exception:
            raise RuntimeError('kernel_diagnostic_log_unavailable') from None
        report = collect(temporary)
    report['log_source'] = 'VERSION_STREAM'
    report['inspected_run'] = {'kernel': CANONICAL, 'version': version, 'ref': ref}
    (target / 'pcs-gpu-diagnostics.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    if len(sys.argv) != 3 or not sys.argv[1].isascii() or not sys.argv[1].isdigit():
        raise ValueError('kernel_diagnostic_version_invalid')
    version = int(sys.argv[1])
    if not 1 <= version <= 2_147_483_647:
        raise ValueError('kernel_diagnostic_version_invalid')
    from kaggle.api.kaggle_api_extended import KaggleApi
    api = KaggleApi()
    api.authenticate()
    print(json.dumps(inspect_version(api, version, sys.argv[2])))
