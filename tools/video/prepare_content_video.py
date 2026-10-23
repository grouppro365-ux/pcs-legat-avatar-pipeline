"""Prepare a minimal job in the existing private kernel, never a new kernel."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/ltx'))
from prepare_kaggle_smoke import ENVIRONMENT_SETUP
from ltx_provider import validate_job


def provider_input(job):
    # The canonical queue's editorial snapshot is NOT sent to Kaggle. Only the
    # exact prompts and bounded settings explicitly confirmed by the operator.
    return validate_job({key: job[key] for key in ('id', 'claim_id', 'spec')})


def prepare(job, destination):
    minimized = provider_input(job)
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    sources = {
        'pcs_ltx_smoke.py': (ROOT / 'tools/ltx/pcs_ltx_smoke.py').read_text(),
        'ltx_provider.py': (ROOT / 'tools/video/ltx_provider.py').read_text(),
    }
    code = 'import os\nos.environ["PCS_LTX_RUN_ID"] = ' + repr(minimized['claim_id']) + '\n' + ENVIRONMENT_SETUP
    code += "\ncode_dir = pathlib.Path('/kaggle/working/pcs-content-video-code')\ncode_dir.mkdir(exist_ok=True)\n"
    for name, content in sources.items():
        code += '(code_dir / ' + repr(name) + ').write_text(' + repr(content) + ')\n'
    code += "job_path = code_dir / 'job.json'\njob_path.write_text(" + repr(json.dumps(minimized, ensure_ascii=False)) + ')\n'
    code += "execute('INFERENCE', [python, str(code_dir / 'ltx_provider.py'), str(job_path)])\n"
    notebook = {'nbformat': 4, 'nbformat_minor': 5,
        'metadata': {'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'}},
        'cells': [{'cell_type': 'code', 'execution_count': None, 'id': 'pcs-content-video',
                   'metadata': {}, 'outputs': [], 'source': code.splitlines(keepends=True)}]}
    metadata = json.loads((ROOT / 'kernel-metadata.json').read_text())
    metadata.update(code_file='pcs_content_video.ipynb', is_private=True, dataset_sources=[],
                    competition_sources=[], model_sources=[], kernel_sources=[], keywords=[])
    (destination / 'pcs_content_video.ipynb').write_text(json.dumps(notebook, indent=2) + '\n')
    (destination / 'kernel-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    return metadata
