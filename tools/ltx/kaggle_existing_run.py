"""Use the official Kaggle client, pinning every read to the accepted version.

Never create a kernel when the configured one cannot be resolved. The single
legacy alias is the observed rename caused by the first LTX smoke release.
"""
import json
from pathlib import Path
import sys
import tempfile
import time
from urllib.parse import urlparse

CANONICAL = 'tatyanathai/pcs-legat-ai-avatar-pipeline'
RENAMED = 'tatyanathai/pcs-ltx-cloud-smoke'
TITLE = 'PCS Legat AI Avatar Pipeline'


def resolve_existing(api):
    for ref in (CANONICAL, RENAMED):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                api.kernels_pull(ref, tmp, metadata=True, quiet=True)
            except Exception as error:
                if getattr(getattr(error, 'response', None), 'status_code', None) == 404:
                    continue
                raise RuntimeError('existing_kernel_lookup_failed') from None
            meta = json.loads((Path(tmp) / 'kernel-metadata.json').read_text())
            number = meta.get('id_no')
            if (meta.get('id') != ref or type(number) is not int or number <= 0
                    or meta.get('is_private') is not True):
                raise RuntimeError('existing_private_kernel_identity_invalid')
            return ref, number
    raise RuntimeError('existing_private_kernel_not_found')


def state(response):
    value = str(response.status).lower().rsplit('.', 1)[-1]
    if value not in {'queued', 'running', 'complete', 'completed', 'error', 'failed', 'cancelled', 'canceled'}:
        raise RuntimeError('kernel_status_unrecognized')
    return value


def wait(api, ref, *, sleep=time.sleep, attempts=180, idle=False):
    for index in range(attempts):
        try:
            status = state(api.kernels_status(ref))
        except Exception as error:
            # The newly accepted version can take a moment to become readable.
            # Retry this exact read only; never push another GPU job here.
            if (not idle and index < 5 and index + 1 < attempts
                    and getattr(getattr(error, 'response', None), 'status_code', None) == 404):
                sleep(30)
                continue
            raise
        print(json.dumps({'kernel': ref, 'status': status}), flush=True)
        if status in {'complete', 'completed'} or idle and status in {'error', 'failed', 'cancelled', 'canceled'}:
            return
        if status in {'error', 'failed', 'cancelled', 'canceled'}:
            raise RuntimeError('kernel_execution_failed')
        if index + 1 < attempts:
            sleep(30)
    raise RuntimeError('kernel_wait_timeout')


def start(api, folder, receipt_path, *, sleep=time.sleep):
    target = Path(receipt_path)
    if target.exists():
        raise RuntimeError('kernel_start_receipt_already_exists')
    folder = Path(folder)
    path = folder / 'kernel-metadata.json'
    metadata = json.loads(path.read_text())
    if metadata.get('id') != CANONICAL or metadata.get('title') != TITLE or metadata.get('is_private') is not True:
        raise RuntimeError('configured_private_kernel_identity_invalid')
    ref, number = resolve_existing(api)
    # Do not interrupt a previous run on this shared kernel, including the
    # version that was already accepted before its old URL returned 404.
    wait(api, ref, sleep=sleep, idle=True)
    # Read the preceding run's log for allowlisted diagnostics only. This does
    # not start another run and never prints raw notebook output.
    try:
        from collect_gpu_diagnostics import collect
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'previous.log').write_text(api.kernels_logs(ref))
            print(json.dumps({'previous_run_diagnostics': collect(tmp)}), flush=True)
    except Exception:
        print(json.dumps({'previous_run_diagnostics': 'UNAVAILABLE'}), flush=True)
    metadata.update(id=ref, id_no=number)
    path.write_text(json.dumps(metadata, indent=2) + '\n')
    result = api.kernels_push(str(folder), timeout='3600', acc='NvidiaTeslaT4')
    if result is None or result.error:
        raise RuntimeError('kernel_push_not_accepted')
    url = urlparse(result.url)
    version = result.versionNumber
    actual = url.path.removeprefix('/code/').strip('/')
    if (url.scheme != 'https' or url.netloc not in {'www.kaggle.com', 'kaggle.com'}
            or actual != CANONICAL or type(version) is not int or version <= 0):
        raise RuntimeError('kernel_push_receipt_invalid')
    receipt = {'kernel': actual, 'version': version, 'ref': actual + '/' + str(version), 'id_no': number}
    target.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt), flush=True)
    return receipt


def read_receipt(path):
    receipt = json.loads(Path(path).read_text())
    version = receipt.get('version')
    if (receipt.get('kernel') != CANONICAL or type(version) is not int or version <= 0
            or receipt.get('ref') != CANONICAL + '/' + str(version)):
        raise RuntimeError('kernel_run_receipt_invalid')
    return receipt['ref']


def output(api, receipt_path, directory):
    ref = read_receipt(receipt_path)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    # Retrieve even on failure. Logs are only an input to sanitized diagnostics;
    # neither the workflow nor its artifacts expose raw notebook logs.
    errors = []
    try:
        api.kernels_output(ref, str(directory), force=True, quiet=True)
    except Exception:
        errors.append('kernel_output_unavailable')
    try:
        (directory / 'kernel-private.log').write_text(api.kernels_logs(ref))
    except Exception:
        errors.append('kernel_log_unavailable')
    print(json.dumps({'kernel': ref, 'download_errors': errors}), flush=True)


if __name__ == '__main__':
    from kaggle.api.kaggle_api_extended import KaggleApi
    api = KaggleApi()
    api.authenticate()
    action = sys.argv[1]
    if action == 'start':
        start(api, sys.argv[2], sys.argv[3])
    elif action == 'wait':
        wait(api, read_receipt(sys.argv[2]))
    elif action == 'output':
        output(api, sys.argv[2], sys.argv[3])
    else:
        raise ValueError('unknown_kernel_action')
