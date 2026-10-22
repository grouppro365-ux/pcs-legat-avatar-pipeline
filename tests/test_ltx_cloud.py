import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/ltx'))
from pcs_ltx_smoke import artifact_receipt, MODEL, REVISION, PACKAGES, run
from prepare_kaggle_smoke import prepare
from collect_gpu_diagnostics import collect
from verify_kaggle_smoke import verify


class LtxCloudTests(unittest.TestCase):
    def test_notebook_reuses_private_kernel_without_customer_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            metadata = prepare(tmp)
            original = json.loads((ROOT / 'kernel-metadata.json').read_text())
            self.assertEqual(metadata['id'], original['id'])
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
            self.assertIn(REVISION, code)
            self.assertNotIn('/kaggle/input/', code)
            self.assertIn("pathlib.Path('/tmp/pcs-ltx-venv')", code)
            self.assertNotIn("pathlib.Path('/kaggle/working/pcs-ltx-venv')", code)
            self.assertEqual(notebook['cells'][0]['outputs'], [])

    def test_refuses_to_run_generation_on_this_machine(self):
        if not Path('/kaggle/working').is_dir():
            with self.assertRaisesRegex(RuntimeError, 'requires_existing_kaggle_gpu_runtime'):
                run()

    def test_raw_kernel_log_secrets_and_paths_do_not_enter_diagnostics(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'kernel.log').write_text("PRIVATE TOKEN abcdef123\n/customer/passport.jpg\n"
                "ModuleNotFoundError: No module named 'onnxruntime'\n"
                "ImportError: cannot import name 'CachedFile' from 'some_module'\n"
                "RuntimeError: secret private request\nsubprocess.CalledProcessError: private subprocess arguments\nCUDA out of memory\n")
            receipt = collect(tmp)
            encoded = json.dumps(receipt)
            self.assertEqual(receipt['missing_modules'], ['onnxruntime'])
            self.assertEqual(receipt['failed_import_names'], ['CachedFile'])
            self.assertTrue(receipt['cuda_out_of_memory'])
            self.assertIn('CalledProcessError', receipt['exception_types'])
            self.assertNotIn('abcdef123', encoded)
            self.assertNotIn('passport', encoded)
            self.assertNotIn('secret private request', encoded)
            self.assertFalse(receipt['raw_logs_included'])

    def test_decodes_actual_video_and_rejects_wrong_geometry_and_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp, 'ltx-smoke.mp4')
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
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
