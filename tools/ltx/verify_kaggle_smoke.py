"""Verify downloaded cloud output, independently of the generation process exit code."""
import json
from pathlib import Path
import sys
from pcs_ltx_smoke import artifact_receipt, MODEL, REVISION, PACKAGES


def verify(directory, expected_run_id):
    if not isinstance(expected_run_id, str) or not expected_run_id:
        raise RuntimeError('ltx_expected_run_required')
    root = Path(directory)
    receipts = list(root.rglob('result.json'))
    if len(receipts) != 1:
        raise RuntimeError('exactly_one_ltx_receipt_required')
    receipt = json.loads(receipts[0].read_text())
    if (receipt.get('run_id') != expected_run_id or receipt.get('outcome') != 'GENERATED_SMOKE' or receipt.get('model') != MODEL or
            receipt.get('model_revision') != REVISION or receipt.get('implementation') != 'diffusers.LTXPipeline' or
            receipt.get('private_assets_used') is not False or receipt.get('customer_send') is not False or
            receipt.get('published') is not False or not isinstance(receipt.get('gpu'), str) or not receipt['gpu']):
        raise RuntimeError('ltx_receipt_invalid')
    for name, version in PACKAGES.items():
        if str(receipt.get('dependencies', {}).get(name, '')).split('+')[0] != version:
            raise RuntimeError('ltx_dependency_receipt_invalid')
    videos = list(root.rglob('ltx-smoke.mp4'))
    if len(videos) != 1 or artifact_receipt(videos[0]) != receipt.get('artifact'):
        raise RuntimeError('ltx_artifact_receipt_mismatch')
    return receipt


if __name__ == '__main__':
    expected=json.loads(Path(sys.argv[2]).read_text())['run_id']
    print(json.dumps(verify(sys.argv[1], expected)))
