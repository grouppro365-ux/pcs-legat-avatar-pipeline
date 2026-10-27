"""Read sanitized diagnostics for one accepted version; never submit a GPU job."""
import json
from pathlib import Path
import sys
import tempfile

from collect_gpu_diagnostics import collect
from kaggle_existing_run import CANONICAL


def inspect_version(api, version, directory):
    if type(version) is not int or not 1 <= version <= 2_147_483_647:
        raise ValueError('kernel_diagnostic_version_invalid')
    target = Path(directory)
    target.mkdir(parents=True, exist_ok=True)
    ref = CANONICAL + '/' + str(version)
    # Keep the provider's private raw log in a temporary directory only.
    with tempfile.TemporaryDirectory() as temporary:
        try:
            raw = api.kernels_logs(ref)
        except Exception:
            raise RuntimeError('kernel_diagnostic_log_unavailable') from None
        if not isinstance(raw, str):
            raise RuntimeError('kernel_diagnostic_log_invalid')
        Path(temporary, 'kernel-private.log').write_text(raw, encoding='utf-8')
        report = collect(temporary)
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
