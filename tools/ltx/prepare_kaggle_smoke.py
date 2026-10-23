"""Prepare a separate asset-free notebook for the EXISTING private Kaggle kernel."""
import json
from pathlib import Path
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]


ENVIRONMENT_SETUP = '''import subprocess, sys, pathlib, json
report_path = pathlib.Path('/kaggle/working/pcs-ltx-output/bootstrap.json')
report_path.parent.mkdir(parents=True, exist_ok=True)
def execute(stage, arguments, **options):
    report = {'run_id': os.environ['PCS_LTX_RUN_ID'], 'stage': stage, 'python_version': sys.version.split()[0], 'outcome': 'RUNNING'}
    report_path.write_text(json.dumps(report))
    try:
        subprocess.run(arguments, check=True, **options)
    except Exception as error:
        report.update(outcome='FAILED', error_type=type(error).__name__)
        if isinstance(error, subprocess.CalledProcessError):
            report['returncode'] = error.returncode
        report_path.write_text(json.dumps(report))
        raise
    report['outcome'] = 'COMPLETED'
    report_path.write_text(json.dumps(report))
# Keep installed dependencies outside /kaggle/working so Kaggle outputs contain only artifacts.
venv = pathlib.Path('/tmp/pcs-ltx-venv')
bootstrap = pathlib.Path('/tmp/pcs-ltx-bootstrap')
execute('INSTALL_ENV_BOOTSTRAP', [sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--target', str(bootstrap), 'virtualenv==20.35.3'])
bootstrap_env = dict(os.environ, PYTHONPATH=str(bootstrap))
execute('CREATE_VENV', [sys.executable, '-m', 'virtualenv', '--no-download', '--no-periodic-update', '--copies', '--app-data', '/tmp/pcs-ltx-venv-cache', str(venv)], env=bootstrap_env)
python = str(venv / 'bin/python')
execute('INSTALL_TORCH', [python, '-m', 'pip', 'install', '--disable-pip-version-check', 'torch==2.5.1', '--index-url', 'https://download.pytorch.org/whl/cu121'])
execute('INSTALL_DIFFUSERS', [python, '-m', 'pip', 'install', '--disable-pip-version-check', 'diffusers==0.36.0', 'transformers==4.57.3', 'accelerate==1.12.0', 'imageio==2.37.0', 'imageio-ffmpeg==0.6.0', 'sentencepiece==0.2.1', 'safetensors==0.6.2', 'huggingface-hub==0.36.0'])
'''


def prepare(destination, run_id=None):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    run_id = run_id or str(uuid.uuid4())
    if not isinstance(run_id, str) or not 1 <= len(run_id) <= 160 or not all(c.isalnum() or c in '-_.' for c in run_id):
        raise ValueError('invalid_ltx_run_id')
    source = (ROOT / 'tools/ltx/pcs_ltx_smoke.py').read_text()
    setup = ENVIRONMENT_SETUP
    code = 'import os\nos.environ["PCS_LTX_RUN_ID"] = '+repr(run_id)+'\n' + setup + "\nscript=pathlib.Path('/kaggle/working/pcs_ltx_smoke.py')\nscript.write_text(" + repr(source) + ")\nexecute('INFERENCE', [python, str(script)])\n"
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
