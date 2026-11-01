"""One canonical PCS video job per existing GitHub/Kaggle worker invocation.

GitHub OIDC authenticates each API call. No PCS credential is stored in GitHub
or sent to Kaggle. This module never publishes or sends customer messages.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlencode, urlparse
from urllib.request import Request, HTTPRedirectHandler, build_opener
from urllib.error import HTTPError, URLError
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/ltx'))
from kaggle_existing_run import start, wait, output
from pcs_ltx_smoke import MODEL, REVISION, PACKAGES, artifact_receipt
from prepare_content_video import prepare, provider_input
from ltx_provider import job_digest
from postprocess import process_manifest, PRESETS
from captions import CaptionError

MANAGER = 'https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-manager-live2'
BUCKET = 'pcs-content-video'
AUDIENCE = 'pcs-content-video-worker'


class WorkerError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise WorkerError('video_http_redirect_refused')


urlopen = build_opener(NoRedirect()).open


def _json_response(request, timeout=40):
    with urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise WorkerError('video_api_response_invalid')
        data = response.read(2_000_001)
    if len(data) > 2_000_000:
        raise WorkerError('video_api_response_too_large')
    return json.loads(data)


def oidc_token(environment=None, transport=_json_response):
    environment = os.environ if environment is None else environment
    url, key = environment.get('ACTIONS_ID_TOKEN_REQUEST_URL', ''), environment.get('ACTIONS_ID_TOKEN_REQUEST_TOKEN', '')
    parsed = urlparse(url)
    if (not key or parsed.scheme != 'https' or not parsed.hostname
            or not parsed.hostname.endswith('.actions.githubusercontent.com')):
        raise WorkerError('github_oidc_unavailable')
    url += ('&' if parsed.query else '?') + urlencode({'audience': AUDIENCE})
    result = transport(Request(url, headers={'Authorization': 'Bearer ' + key}))
    token = result.get('value')
    if not isinstance(token, str) or not 100 <= len(token) <= 30000:
        raise WorkerError('github_oidc_response_invalid')
    return token


class ManagerAPI:
    def __init__(self, token=oidc_token, transport=_json_response, sleep=time.sleep):
        self.token, self.transport, self.sleep = token, transport, sleep

    def call(self, action, **fields):
        command = {'action': action, 'request_id': str(uuid.uuid4()), **fields}
        encoded = json.dumps(command).encode()
        # Network retries reuse the exact command, including its request ID.
        for attempt in range(3):
            try:
                request = Request(MANAGER + '?op=content-video-worker', data=encoded,
                    headers={'Authorization': 'Bearer ' + self.token(), 'Content-Type': 'application/json'})
                result = self.transport(request)
                if result.get('ok') is not True:
                    raise WorkerError('video_api_action_not_confirmed')
                return result
            except HTTPError as error:
                quota_exceeded = False
                try:
                    if error.code == 503:
                        data = error.read(4097)
                        detail = json.loads(data) if len(data) <= 4096 else None
                        quota_exceeded = isinstance(detail, dict) and detail.get('code') == 'database_quota_exceeded'
                except (ValueError, OSError):
                    pass
                finally:
                    error.close()
                if quota_exceeded:
                    raise WorkerError('DATABASE_QUOTA_EXCEEDED') from None
                if error.code < 500 or attempt == 2:
                    raise WorkerError('video_api_http_' + str(error.code)) from None
            except (URLError, TimeoutError, ConnectionError):
                if attempt == 2:
                    raise WorkerError('video_api_connection_failed') from None
            self.sleep(2 ** attempt)
        raise WorkerError('video_api_action_failed')


def verify_generated(job, directory):
    minimal = provider_input(job)
    root = Path(directory)
    receipts = list(root.rglob('result.json'))
    if len(receipts) != 1:
        raise WorkerError('video_generation_receipt_missing')
    receipt = json.loads(receipts[0].read_text())
    if (receipt.get('job_id') != job['id'] or receipt.get('run_id') != job['claim_id']
            or receipt.get('input_sha256') != job_digest(minimal)
            or receipt.get('outcome') != 'GENERATED_VIDEO_SHOTS'
            or receipt.get('model') != MODEL or receipt.get('model_revision') != REVISION
            or receipt.get('implementation') != 'diffusers.LTXPipeline'
            or receipt.get('published') is not False or receipt.get('customer_send') is not False
            or receipt.get('private_assets_used') is not False
            or not isinstance(receipt.get('gpu'), str) or not receipt['gpu']):
        raise WorkerError('video_generation_receipt_invalid')
    for name, version in PACKAGES.items():
        if str(receipt.get('dependencies', {}).get(name, '')).split('+')[0] != version:
            raise WorkerError('video_generation_dependencies_invalid')
    shots = receipt.get('shots')
    if not isinstance(shots, list) or len(shots) != len(minimal['spec']['shots']):
        raise WorkerError('video_generation_shots_invalid')
    paths = []
    for index, (shot, expected) in enumerate(zip(shots, minimal['spec']['shots'])):
        name = f'shot-{index + 1:03d}.mp4'
        if shot.get('file') != name:
            raise WorkerError('video_generation_filename_invalid')
        path = receipts[0].parent / name
        if path.is_symlink() or artifact_receipt(path, frames=expected['frames']) != shot:
            raise WorkerError('video_generation_artifact_mismatch')
        paths.append(path)
    return receipt, paths


def upload_file(url, path, *, mime, transport=urlopen):
    parsed = urlparse(url)
    if (parsed.scheme != 'https' or parsed.netloc != 'nnlzgertmmxuteozoeel.supabase.co'
            or not parsed.path.startswith('/storage/v1/object/upload/sign/' + BUCKET + '/jobs/')):
        raise WorkerError('video_upload_destination_invalid')
    data = Path(path).read_bytes()
    cap = 25 * 1024**2 if mime == 'video/mp4' else 2 * 1024**2
    if not data or len(data) > cap:
        raise WorkerError('video_upload_size_invalid')
    request = Request(url, data=data, method='PUT', headers={'Content-Type': mime, 'x-upsert': 'false'})
    with transport(request, timeout=120) as response:
        if response.status not in (200, 201):
            raise WorkerError('video_upload_not_confirmed')
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def process_one(api, kaggle, workspace, *, adapt=process_manifest, launch=start, await_gpu=wait,
                download=output, verify=verify_generated, build=prepare, upload=upload_file):
    claimed = api.call('claim')
    job = claimed.get('job')
    if job is None:
        return {'outcome': 'EMPTY_QUEUE'}
    if not isinstance(job, dict) or not job.get('id') or not job.get('claim_id'):
        raise WorkerError('video_claim_invalid')
    workspace = Path(workspace)
    workspace.mkdir(parents=True, exist_ok=True)
    error_code = 'VIDEO_PREPARATION_FAILED'

    def action(name, **fields):
        nonlocal job
        result = api.call(name, job_id=job['id'], claim_id=job['claim_id'],
                          expected_version=job['version'], **fields)
        if isinstance(result.get('job'), dict):
            job = result['job']
        if job.get('stage') == 'CANCELLED':
            raise WorkerError('video_job_cancelled')
        return result

    try:
        provider_input(job)
        finishing = None
        if job['spec']['version'] == 2:
            from captions import validate_finishing
            width, height = PRESETS[job['spec']['preset']]
            finishing = validate_finishing(job['spec']['finishing'], width=width, height=height,
                                          total_frames=sum(shot['frames'] for shot in job['spec']['shots']) * 3)
        kernel_dir = workspace / 'kernel'
        build(job, kernel_dir)
        action('progress', stage='GENERATING')
        error_code = 'GPU_LAUNCH_UNKNOWN'
        launched = launch(kaggle, kernel_dir, workspace / 'kaggle-run.json')
        provider_receipt = {key: launched[key] for key in ('kernel', 'version', 'ref')}
        provider_receipt['run_id'] = job['claim_id']
        action('progress', stage='GENERATING', provider_receipt=provider_receipt)
        error_code = 'VIDEO_GENERATION_FAILED'
        await_gpu(kaggle, launched['ref'])
        raw = workspace / 'raw'
        download(kaggle, workspace / 'kaggle-run.json', raw)
        generation, paths = verify(job, raw)
        action('progress', stage='POST_PROCESSING', provider_receipt=provider_receipt)
        error_code = 'VIDEO_POSTPROCESS_FAILED'
        manifest = {'job_id': job['id'], 'platform': job['spec']['preset'], 'fit': job['spec']['fit'],
                    'audio': 'mute', 'shots': [{'path': path.name, 'start': 0,
                        'duration': source['frames'] / 8} for path, source in zip(paths, job['spec']['shots'])]}
        if job['spec']['version'] == 2:
            manifest['finishing'] = job['spec']['finishing']
        processed = workspace / 'processed'
        technical = adapt(manifest, paths[0].parent, processed)
        if technical.get('outcome') != 'TECHNICAL_QA_PASSED' or technical.get('manual_review_required') is not True:
            raise WorkerError('video_technical_qa_not_confirmed')
        if job['spec']['version'] == 2:
            evidence = technical.get('finishing', {})
            if evidence != finishing:
                raise WorkerError('video_captions_not_confirmed')
        action('progress', stage='QA')
        error_code = 'VIDEO_UPLOAD_FAILED'
        stored = {}
        for kind, mime, entry in [('video', 'video/mp4', technical['artifact']),
                                 ('cover', 'image/png', technical['cover'])]:
            signed = action('upload', kind=kind)
            info = upload(signed['upload']['signed_url'], processed / entry['file'], mime=mime)
            if info['sha256'] != entry['sha256']:
                raise WorkerError('video_postprocess_hash_changed')
            stored[kind] = {'bucket': BUCKET, 'path': signed['upload']['path'], **info}
        artifact = {**stored['video'], **{key: technical['artifact'][key] for key in
            ('width', 'height', 'fps', 'frames', 'duration_seconds', 'decode_verified', 'codec')},
            'technical_qa': 'PASSED', 'manual_review_required': True, 'cover': stored['cover'],
            'source_model': MODEL, 'model_revision': REVISION, 'manifest_sha256': technical['manifest_sha256']}
        action('complete', artifact=artifact)
        return {'outcome': 'READY_FOR_REVIEW', 'job_id': job['id']}
    except Exception as error:
        if isinstance(error, WorkerError) and str(error) == 'DATABASE_QUOTA_EXCEEDED':
            # Preserve the current claim/receipt for expiry recovery. Repeating
            # another DB write cannot resolve a provider quota suspension.
            raise
        if isinstance(error, CaptionError):
            error_code = {'caption_glyph_unsupported': 'CAPTION_GLYPH_UNSUPPORTED',
                          'caption_line_too_wide': 'CAPTION_LINE_TOO_WIDE',
                          'caption_font_unavailable': 'CAPTION_FONT_UNAVAILABLE',
                          'caption_font_integrity_failed': 'CAPTION_FONT_UNAVAILABLE',
                          'caption_fonttools_version_mismatch': 'CAPTION_FONT_UNAVAILABLE'}.get(str(error), 'VIDEO_CAPTIONS_INVALID')
        # A failed/uncertain launch is never retried here. Queue state and its
        # operator review gate remain authoritative for any later attempt.
        try:
            if job.get('stage') != 'CANCELLED':
                action('fail', error_code=error_code)
        except Exception:
            pass
        raise WorkerError(error_code) from None


if __name__ == '__main__':
    if (os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('GITHUB_REPOSITORY') != 'grouppro365-ux/pcs-legat-avatar-pipeline'
            or os.environ.get('GITHUB_REF') != 'refs/heads/main'):
        raise WorkerError('requires_existing_github_cloud_worker')
    from kaggle.api.kaggle_api_extended import KaggleApi
    client = KaggleApi()
    client.authenticate()
    print(json.dumps(process_one(ManagerAPI(), client, 'pcs-content-video-work')))
