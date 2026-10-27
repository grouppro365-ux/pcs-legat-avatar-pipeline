import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/ltx'))
from collect_gpu_diagnostics import collect, summarize


class AvatarDiagnosticCodeTests(unittest.TestCase):
    def test_echo_render_missing_model_and_traceback_emit_only_fixed_codes(self):
        text = '''Traceback (most recent call last):
  File "/tmp/PRIVATE-PERSON/echomimic_v2/infer_acc.py", line 212, in main
  File "/tmp/PRIVATE-PERSON/site-packages/diffusers/models/modeling_utils.py", line 200, in from_pretrained
OSError: Error no file named diffusion_pytorch_model.safetensors found in directory /private/customer/passport.
PRIVATE-TOKEN-123
'''
        result = summarize(text)
        self.assertIn('MODEL_WEIGHTS_MISSING', result['diagnostic_codes'])
        self.assertEqual(result['component_hints'], ['DIFFUSERS', 'ECHO_RUNTIME'])
        encoded = json.dumps(result)
        for private in ['PRIVATE-PERSON', 'PRIVATE-TOKEN', 'passport', '/tmp/', 'diffusion_pytorch_model']:
            self.assertNotIn(private, encoded)

    def test_native_errors_have_fixed_diagnostic_codes_without_symbol_or_path(self):
        cases = [
            ("OSError: libCUSTOM_PRIVATE.so: cannot open shared object file: No such file or directory", 'NATIVE_LIBRARY_MISSING'),
            ("ImportError: /private/extension.so: undefined symbol: _CUSTOM_PRIVATE_SYMBOL", 'NATIVE_SYMBOL_UNRESOLVED'),
            ("ImportError: /private/lib.so: version 'GLIBCXX_3.4.30' not found", 'NATIVE_ABI_MISMATCH'),
            ("OSError: libcudnn.so.8: cannot open shared object file: No such file or directory", 'CUDA_SHARED_LIBRARY_MISSING'),
            ("RuntimeError: CUDA error: no kernel image is available for execution on the device", 'CUDA_KERNEL_UNSUPPORTED'),
        ]
        for text, expected in cases:
            with self.subTest(expected=expected):
                result = summarize(text)
                self.assertIn(expected, result['diagnostic_codes'])
                self.assertNotIn('PRIVATE', json.dumps(result))
                self.assertNotIn('3.4.30', json.dumps(result))

    def test_model_and_filesystem_causes_stay_distinct(self):
        cases = [
            ("OSError: Can't load tokenizer for '/private/model'", 'MODEL_TOKENIZER_LOAD_FAILED'),
            ("OSError: Can't load image processor for '/private/model'", 'MODEL_PROCESSOR_LOAD_FAILED'),
            ("LocalEntryNotFoundError: private unavailable cache entry", 'HF_LOCAL_CACHE_MISS'),
            ("HfHubHTTPError: 403 Client Error for https://huggingface.co/private/model", 'HF_MODEL_ACCESS_UNAUTHORIZED'),
            ("RuntimeError: size mismatch for private.weight", 'MODEL_PARAMETER_SHAPE_MISMATCH'),
            ("SafetensorError: Error while deserializing header: invalid header", 'MODEL_WEIGHT_FORMAT_INVALID'),
            ("FileNotFoundError: [Errno 2] No such file or directory: '/private/data'", 'OS_FILE_NOT_FOUND'),
            ("FileNotFoundError: [Errno 2] No such file or directory: 'ffmpeg'", 'FFMPEG_EXECUTABLE_MISSING'),
        ]
        for text, expected in cases:
            with self.subTest(expected=expected):
                self.assertIn(expected, summarize(text)['diagnostic_codes'])
        generic = summarize('OSError: private unrecognized failure')
        self.assertEqual(generic['diagnostic_codes'], [])
        self.assertEqual(generic['component_hints'], [])

    def test_serialized_ansi_and_frame_quotes_are_normalized_privately(self):
        actual = '\x1b[31mTraceback (most recent call last):\x1b[0m\n  File "/private/site-packages/transformers/modeling_utils.py", line 20, in f\nOSError: Can\'t load tokenizer for PRIVATE\n'
        result = summarize(json.dumps({'text': actual}))
        self.assertIn('MODEL_TOKENIZER_LOAD_FAILED', result['diagnostic_codes'])
        self.assertEqual(result['component_hints'], ['TRANSFORMERS'])
        self.assertNotIn('PRIVATE', json.dumps(result))
        # Normal source/command mentions are not traceback evidence.
        self.assertEqual(summarize('download /private/transformers/model.py\n$ python /tmp/echomimic_v2/infer_acc.py')['component_hints'], [])

    def test_current_and_previous_codes_are_not_conflated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'kernel-private.log').write_text("OSError: Can't load tokenizer for PRIVATE")
            (root / 'previous.log').write_text("ImportError: /PRIVATE/native.so: undefined symbol: PRIVATE")
            result = collect(root)
            reports = {r['scope']: r for r in result['log_diagnostics']}
            self.assertEqual(reports['CURRENT_VERSION']['diagnostic_codes'], ['MODEL_TOKENIZER_LOAD_FAILED'])
            self.assertEqual(reports['PREVIOUS_VERSION']['diagnostic_codes'], ['NATIVE_SYMBOL_UNRESOLVED'])
            self.assertFalse(result['raw_logs_included'])
            self.assertNotIn('PRIVATE', (root / 'pcs-gpu-diagnostics.json').read_text())

    def test_bounded_reader_keeps_failure_at_the_end_of_a_large_install_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'kernel-private.log').write_bytes(b'package download\n' * 160000 + b'\nOSError: Error no file named diffusion_pytorch_model.bin found in directory PRIVATE\n')
            result = collect(root)
            self.assertTrue(result['log_diagnostics'][0]['log_truncated'])
            self.assertIn('MODEL_WEIGHTS_MISSING', result['diagnostic_codes'])
            self.assertNotIn('PRIVATE', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
