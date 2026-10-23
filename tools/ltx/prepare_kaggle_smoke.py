"""Prepare a separate asset-free notebook for the EXISTING private Kaggle kernel."""
import json
from pathlib import Path
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]


def prepare(destination, run_id=None):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    run_id = run_id or str(uuid.uuid4())
    if not isinstance(run_id, str) or not 1 <= len(run_id) <= 160 or not all(c.isalnum() or c in '-_.' for c in run_id):
        raise ValueError('invalid_ltx_run_id')
    source = (ROOT / 'tools/ltx/pcs_ltx_smoke.py').read_text()
    setup = '''import subprocess, sys, pathlib
# Keep installed dependencies outside /kaggle/working so Kaggle outputs contain only artifacts.
venv = pathlib.Path('/tmp/pcs-ltx-venv')
subprocess.run([sys.executable, '-m', 'venv', str(venv)], check=True)
python = str(venv / 'bin/python')
subprocess.run([python, '-m', 'pip', 'install', '--disable-pip-version-check', 'torch==2.5.1', '--index-url', 'https://download.pytorch.org/whl/cu121'], check=True)
subprocess.run([python, '-m', 'pip', 'install', '--disable-pip-version-check', 'diffusers==0.36.0', 'transformers==4.57.3', 'accelerate==1.12.0', 'imageio==2.37.0', 'imageio-ffmpeg==0.6.0', 'sentencepiece==0.2.1', 'safetensors==0.6.2', 'huggingface-hub==0.36.0'], check=True)
'''
    code = 'import os\nos.environ["PCS_LTX_RUN_ID"] = '+repr(run_id)+'\n' + setup + "\nscript=pathlib.Path('/kaggle/working/pcs_ltx_smoke.py')\nscript.write_text(" + repr(source) + ")\nsubprocess.run([python, str(script)], check=True)\n"
    notebook = {'nbformat': 4, 'nbformat_minor': 5,
                'metadata': {'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'}},
                'cells': [{'cell_type': 'code', 'execution_count': None, 'id': 'pcs-ltx-cloud-smoke',
                           'metadata': {}, 'outputs': [], 'source': code.splitlines(keepends=True)}]}
    metadata = json.loads((ROOT / 'kernel-metadata.json').read_text())
    # Kaggle derives the URL slug from the title: changing it renames the
    # existing kernel and breaks both scheduled avatar and status requests.
    metadata.update(code_file='pcs_ltx_smoke.ipynb',
                    is_private=True, dataset_sources=[], competition_sources=[], model_sources=[],
                    kernel_sources=[], keywords=[])
    (destination / 'pcs_ltx_smoke.ipynb').write_text(json.dumps(notebook, indent=2) + '\n')
    (destination / 'kernel-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (destination / 'expected-run.json').write_text(json.dumps({'run_id':run_id}) + '\n')
    return metadata


if __name__ == '__main__':
    prepare(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
