import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import os
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/ltx'))
from pcs_ltx_smoke import artifact_receipt, MODEL, REVISION, PACKAGES, run
from prepare_kaggle_smoke import prepare
from collect_gpu_diagnostics import collect
from verify_kaggle_smoke import verify
from kaggle_existing_run import start, wait, output, read_receipt, CANONICAL, RENAMED, TITLE


class NotFound(Exception):
    response = SimpleNamespace(status_code=404)


class FakeKaggle:
    def __init__(self, *, renamed=False, missing=False, private=True, statuses=None):
        self.renamed, self.missing, self.private = renamed, missing, private
        self.statuses = iter(statuses or ['complete'])
        self.status_calls, self.pushes, self.output_calls = [], [], []
        self.result = SimpleNamespace(error='', url='https://www.kaggle.com/' + CANONICAL, versionNumber=95)

    def kernels_pull(self, ref, directory, **kwargs):
        if self.missing or self.renamed and ref == CANONICAL:
            raise NotFound()
        Path(directory, 'kernel-metadata.json').write_text(json.dumps(
            {'id': ref, 'id_no': 123, 'is_private': self.private}))

    def kernels_status(self, ref):
        self.status_calls.append(ref)
        status = next(self.statuses)
        if isinstance(status, Exception):
            raise status
        return SimpleNamespace(status=status)

    def kernels_push(self, folder, **kwargs):
        self.pushes.append((json.loads(Path(folder, 'kernel-metadata.json').read_text()), kwargs))
        return self.result

    def kernels_output(self, ref, directory, **kwargs):
        self.output_calls.append(ref)

    def kernels_logs(self, ref):
        self.output_calls.append(ref)
        return 'private raw log never printed'


class LtxCloudTests(unittest.TestCase):
    def test_restores_existing_renamed_kernel_without_creating_another(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepare(tmp)
            api = FakeKaggle(renamed=True, statuses=['running', 'complete'])
            receipt = Path(tmp, 'run.json')
            result = start(api, tmp, receipt, sleep=lambda _: None)
            self.assertEqual(api.status_calls, [RENAMED, RENAMED])
            self.assertEqual(len(api.pushes), 1)
            metadata, options = api.pushes[0]
            self.assertEqual(metadata['id_no'], 123)
            self.assertEqual(metadata['id'], RENAMED)
            self.assertEqual(metadata['title'], TITLE)
            self.assertEqual(options['acc'], 'NvidiaTeslaT4')
            self.assertEqual(result['ref'], CANONICAL + '/95')
            self.assertEqual(read_receipt(receipt), result['ref'])
            output(api, receipt, Path(tmp, 'out'))
            self.assertEqual(api.output_calls, [RENAMED, result['ref'], result['ref']])
            with self.assertRaisesRegex(RuntimeError, 'receipt_already_exists'):
                start(api, tmp, receipt)
            self.assertEqual(len(api.pushes), 1)

    def test_missing_or_public_kernel_never_creates_a_new_one(self):
        for options in [{'missing': True}, {'private': False}]:
            with tempfile.TemporaryDirectory() as tmp:
                prepare(tmp)
                api = FakeKaggle(**options)
                with self.assertRaises(RuntimeError):
                    start(api, tmp, Path(tmp, 'run.json'))
                self.assertEqual(api.pushes, [])

    def test_only_successfully_accepted_expected_version_gets_receipt(self):
        for result in [None, SimpleNamespace(error='rejected'),
                       SimpleNamespace(error='', url='https://example.org/' + CANONICAL, versionNumber=95),
                       SimpleNamespace(error='', url='https://www.kaggle.com/another/kernel', versionNumber=95),
                       SimpleNamespace(error='', url='https://www.kaggle.com/' + CANONICAL, versionNumber=0)]:
            with tempfile.TemporaryDirectory() as tmp:
                prepare(tmp)
                api = FakeKaggle()
                api.result = result
                receipt = Path(tmp, 'run.json')
                with self.assertRaises(RuntimeError):
                    start(api, tmp, receipt)
                self.assertFalse(receipt.exists())

    def test_polling_uses_exact_version_and_never_restarts_a_failed_job(self):
        ref = CANONICAL + '/95'
        api = FakeKaggle(statuses=[NotFound(), 'queued', 'running', 'complete'])
        wait(api, ref, sleep=lambda _: None, attempts=4)
        self.assertEqual(api.status_calls, [ref] * 4)
        self.assertEqual(api.pushes, [])
        for states in [['error'], ['running', 'running'], ['unrecognized']]:
            api = FakeKaggle(statuses=states)
            with self.assertRaises(RuntimeError):
                wait(api, ref, sleep=lambda _: None, attempts=len(states))
            self.assertEqual(api.pushes, [])

    def test_unversioned_receipt_cannot_download_previous_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            api = FakeKaggle()
            receipt = Path(tmp, 'run.json')
            receipt.write_text(json.dumps({'kernel': CANONICAL, 'version': 95, 'ref': CANONICAL}))
            with self.assertRaisesRegex(RuntimeError, 'receipt_invalid'):
                output(api, receipt, Path(tmp, 'out'))
            self.assertEqual(api.output_calls, [])

    def test_notebook_reuses_private_kernel_without_customer_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            metadata = prepare(tmp)
            original = json.loads((ROOT / 'kernel-metadata.json').read_text())
            self.assertEqual(metadata['id'], original['id'])
            self.assertEqual(metadata['title'], original['title'])
            self.assertTrue(metadata['is_private'])
            expected=json.loads((Path(tmp) / 'expected-run.json').read_text())
            self.assertTrue(expected['run_id'])
            self.assertIn(expected['run_id'], (Path(tmp) / metadata['code_file']).read_text())
            for key in ['dataset_sources', 'competition_sources', 'model_sources', 'kernel_sources']:
                self.assertEqual(metadata[key], [])
            notebook = json.loads((Path(tmp) / metadata['code_file']).read_text())
            code = ''.join(notebook['cells'][0]['source'])
            compile(code, '<generated-kaggle-smoke>', 'exec')
            self.assertIn('torch==2.5.1', code)
            self.assertIn('virtualenv==20.35.3', code)
            self.assertNotIn("'-m', 'venv'", code)
            self.assertIn(REVISION, code)
            self.assertNotIn('/kaggle/input/', code)
            self.assertIn("pathlib.Path('/tmp/pcs-ltx-venv')", code)
            self.assertNotIn("pathlib.Path('/kaggle/working/pcs-ltx-venv')", code)
            self.assertEqual(notebook['cells'][0]['outputs'], [])

    def test_bootstrap_reports_stage_and_runtime_before_inference(self):
        with tempfile.TemporaryDirectory() as tmp:
            metadata = prepare(tmp, 'bootstrap-fixture')
            notebook = json.loads((Path(tmp) / metadata['code_file']).read_text())
            code = ''.join(notebook['cells'][0]['source']).replace('/kaggle/working/', tmp + '/')
            error = subprocess.CalledProcessError(1, ['private-subprocess-argument'])
            with patch('subprocess.run', side_effect=[None, None, error]), patch.dict(os.environ):
                with self.assertRaises(subprocess.CalledProcessError):
                    exec(compile(code, '<bootstrap-fixture>', 'exec'), {})
            report = json.loads(Path(tmp, 'pcs-ltx-output/bootstrap.json').read_text())
            self.assertEqual(report['stage'], 'INSTALL_TORCH')
            self.assertEqual(report['outcome'], 'FAILED')
            self.assertEqual(report['run_id'], 'bootstrap-fixture')
            self.assertEqual(report['returncode'], 1)
            self.assertNotIn('private-subprocess-argument', json.dumps(report))

    def test_refuses_to_run_generation_on_this_machine(self):
        if not Path('/kaggle/working').is_dir():
            with self.assertRaisesRegex(RuntimeError, 'requires_existing_kaggle_gpu_runtime'):
                run()

    def test_raw_kernel_log_secrets_and_paths_do_not_enter_diagnostics(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'kernel.log').write_text("PRIVATE TOKEN abcdef123\n/customer/passport.jpg\n"
                "ModuleNotFoundError: No module named 'onnxruntime'\n"
                "ImportError: cannot import name 'CachedFile' from 'some_module'\n"
                "12.0s 7 \x1b[31mRuntimeError: secret private request\x1b[0m\n12.0s 8 subprocess.CalledProcessError: private subprocess arguments\nCUDA out of memory\nNo matching distribution found for torch\n")
            receipt = collect(tmp)
            encoded = json.dumps(receipt)
            self.assertEqual(receipt['missing_modules'], ['onnxruntime'])
            self.assertEqual(receipt['failed_import_names'], ['CachedFile'])
            self.assertTrue(receipt['cuda_out_of_memory'])
            self.assertEqual(receipt['diagnostic_codes'], ['PYTORCH_WHEEL_UNAVAILABLE'])
            self.assertIn('CalledProcessError', receipt['exception_types'])
            self.assertNotIn('abcdef123', encoded)
            self.assertNotIn('passport', encoded)
            self.assertNotIn('secret private request', encoded)
            self.assertFalse(receipt['raw_logs_included'])

    def test_decodes_actual_video_and_rejects_wrong_geometry_and_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp, 'ltx-smoke.mp4')
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-f', 'lavfi', '-i',
                'testsrc2=size=320x256:rate=8', '-frames:v', '17', '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p', str(video)], check=True, capture_output=True)
            artifact = artifact_receipt(video)
            self.assertTrue(artifact['decode_verified'])
            self.assertEqual(artifact['frames'], 17)
            with self.assertRaisesRegex(RuntimeError, 'video_geometry_mismatch'):
                artifact_receipt(video, width=640)
            # Synthetic fixture tests validation only; it is never a production model artifact.
            receipt = {'run_id':'synthetic-run-id', 'outcome': 'GENERATED_SMOKE', 'model': MODEL, 'model_revision': REVISION,
                'implementation': 'diffusers.LTXPipeline', 'dependencies': PACKAGES,
                'gpu': 'TEST_FIXTURE_ONLY', 'private_assets_used': False,
                'customer_send': False, 'published': False, 'artifact': artifact}
            path = Path(tmp, 'result.json')
            path.write_text(json.dumps(receipt))
            self.assertEqual(verify(tmp, 'synthetic-run-id'), receipt)
            with self.assertRaisesRegex(RuntimeError, 'ltx_receipt_invalid'):
                verify(tmp, 'a-different-run')
            receipt['artifact']['sha256'] = '0' * 64
            path.write_text(json.dumps(receipt))
            with self.assertRaisesRegex(RuntimeError, 'ltx_artifact_receipt_mismatch'):
                verify(tmp, 'synthetic-run-id')
            video.write_bytes(b'not a video')
            with self.assertRaisesRegex(RuntimeError, 'video_missing_or_empty'):
                artifact_receipt(video)


if __name__ == '__main__':
    unittest.main()
