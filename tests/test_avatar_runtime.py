import ast
import gzip
import json
import os
import textwrap
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/ltx'))
from collect_gpu_diagnostics import collect, STAGES


def original_notebook():
    return json.loads(gzip.decompress(b''.join(path.read_bytes() for path in sorted(ROOT.glob('notebook.gz.part*')))))


def patched(directory, notebook=None):
    path = Path(directory, 'kaggle_avatar_pipeline.ipynb')
    path.write_text(json.dumps(original_notebook() if notebook is None else notebook))
    result = subprocess.run([sys.executable, str(ROOT / 'patch_notebook.py')], cwd=directory, capture_output=True, text=True)
    return result, path


class AvatarRuntimeTests(unittest.TestCase):
    def test_current_and_previous_diagnostics_are_not_mixed(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'previous.log').write_text("ModuleNotFoundError: No module named 'wrapt'\n")
            Path(tmp, 'kernel-private.log').write_text("OSError: Can't load the model for '/private/portrait'\n")
            receipt = collect(tmp)
            reports = {row['scope']: row for row in receipt['log_diagnostics']}
            self.assertEqual(reports['CURRENT_VERSION']['missing_modules'], [])
            self.assertEqual(reports['CURRENT_VERSION']['diagnostic_codes'], ['MODEL_LOAD_FAILED'])
            self.assertEqual(reports['PREVIOUS_VERSION']['missing_modules'], ['wrapt'])
            self.assertNotIn('portrait', json.dumps(receipt))
            self.assertEqual(receipt['avatar_stage'], {'status': 'UNAVAILABLE'})

    def test_only_safe_exact_stage_schema_is_reported(self):
        safe = dict(stage='ECHO_RENDER', status='FAILED', error_type='CalledProcessError', errno=None, returncode=1)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, 'pcs-avatar-stage.json')
            path.write_text(json.dumps(safe)); self.assertEqual(collect(tmp)['avatar_stage'], safe)
            invalid = [[], {}, {**safe, 'stage': 'PRIVATE PASSPORT'}, {**safe, 'error_type': 'PrivateCustomerError'},
                       {**safe, 'message': 'secret'}, {**safe, 'errno': True}, {**safe, 'returncode': 10000},
                       {**safe, 'status': 'COMPLETE'}, {**safe, 'stage': []}, {**safe, 'error_type': None}]
            for value in invalid:
                path.write_text(json.dumps(value)); report = collect(tmp)
                self.assertEqual(report['avatar_stage'], {'status': 'INVALID'})
                self.assertNotIn('secret', json.dumps(report))
            path.write_text('X'*2049); self.assertEqual(collect(tmp)['avatar_stage'], {'status': 'INVALID'})
            path.write_text(json.dumps(safe)); other = Path(tmp, 'duplicate'); other.mkdir()
            (other / path.name).write_text(json.dumps(safe))
            self.assertEqual(collect(tmp)['avatar_stage'], {'status': 'INVALID'})

    def test_actual_compressed_notebook_is_patched_and_all_cells_compile(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, path = patched(tmp)
            self.assertEqual(result.returncode, 0, result.stderr)
            notebook = json.loads(path.read_text())
            code = [''.join(cell['source']) for cell in notebook['cells'] if cell['cell_type']=='code']
            self.assertEqual(len(code), len(STAGES))
            for source in code:
                ast.parse(source)
            combined = '\n'.join(code)
            for stage in STAGES:
                self.assertIn(repr(stage), combined)
            self.assertIn('pcs-avatar-stage.json', combined)
            self.assertNotIn('traceback.format_exc', combined)

    def test_generated_helper_records_real_errors_without_messages_and_preserves_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, path = patched(tmp)
            self.assertEqual(result.returncode, 0)
            code = [''.join(cell['source']) for cell in json.loads(path.read_text())['cells'] if cell['cell_type'] == 'code']
            module = ast.parse(code[0])
            helper_nodes = []
            for node in module.body:
                if isinstance(node, ast.Expr): break
                helper_nodes.append(node)
            namespace = {}
            exec(compile(ast.Module(body=helper_nodes, type_ignores=[]), '<actual-stage-helper>', 'exec'), namespace)
            namespace['_pcs_stage_path'] = lambda _: Path(tmp)
            helper = namespace['_pcs_avatar_stage']
            error = subprocess.CalledProcessError(1, ['PRIVATE COMMAND', '/passport.jpg'])
            helper('ECHO_RENDER', 'FAILED', error)
            record = json.loads(Path(tmp, 'pcs-avatar-stage.json').read_text())
            self.assertEqual(record, dict(stage='ECHO_RENDER', status='FAILED', error_type='CalledProcessError', errno=None, returncode=1))
            self.assertNotIn('PRIVATE', json.dumps(record))
            self.assertEqual(collect(tmp)['avatar_stage'], record)
            helper('QA', 'COMPLETE')
            self.assertEqual(collect(tmp)['avatar_stage']['error_type'], None)
            class PrivateCustomerError(Exception): pass
            helper('QA', 'FAILED', PrivateCustomerError('private customer text'))
            self.assertEqual(collect(tmp)['avatar_stage']['error_type'], 'OTHER')
            class BrokenDirectory:
                def mkdir(self, **kwargs): raise OSError('disk full /private/path')
            namespace['_pcs_stage_path'] = lambda _: BrokenDirectory()
            wrapped = ast.parse(code[1])
            execution = next(node for node in wrapped.body if isinstance(node, ast.Try))
            execution.body = [ast.Raise(exc=ast.Name(id='original_error', ctx=ast.Load()))]
            ast.fix_missing_locations(wrapped)
            original = RuntimeError('private original error')
            namespace['original_error'] = original
            with self.assertRaises(RuntimeError) as raised:
                exec(compile(wrapped, '<actual-generated-wrapper>', 'exec'), namespace)
            self.assertIs(raised.exception, original)

    def test_workflow_selects_only_the_changed_existing_workload_and_rejects_bad_refs(self):
        workflow = (ROOT / '.github/workflows/daily-kaggle.yml').read_text()
        selector = workflow.split('- name: Select the existing workload for a source push', 1)[1].split('- name: Prepare asset-free LTX', 1)[0]
        script = textwrap.dedent(selector.split('run: |', 1)[1])
        with tempfile.TemporaryDirectory() as tmp:
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=tmp, text=True).strip()
            git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
            patch = Path(tmp, 'patch_notebook.py'); patch.write_text('original')
            git('add', '.'); git('commit', '-qm', 'base'); before = git('rev-parse', 'HEAD')
            Path(tmp, 'ltx.py').write_text('ltx'); git('add', '.'); git('commit', '-qm', 'ltx')
            after = git('rev-parse', 'HEAD')
            output = Path(tmp, 'workflow-env')
            def select(old, new):
                output.write_text('')
                result = subprocess.run(['bash', '-e', '-c', script], cwd=tmp, env={**os.environ, 'PCS_PUSH_BEFORE': old, 'GITHUB_SHA': new, 'GITHUB_ENV': str(output)}, capture_output=True)
                return result.returncode, output.read_text()
            self.assertEqual(select(before, after), (0, 'PCS_GPU_ENGINE=ltx-smoke\n'))
            patch.write_text('patched'); git('add', '.'); git('commit', '-qm', 'avatar'); patched_sha = git('rev-parse', 'HEAD')
            self.assertEqual(select(after, patched_sha), (0, 'PCS_GPU_ENGINE=avatar\n'))
            for old in ['$(touch forbidden)', '0'*40, 'f'*40]:
                code, values = select(old, patched_sha)
                self.assertNotEqual(code, 0); self.assertEqual(values, '')
            self.assertFalse(Path(tmp, 'forbidden').exists())

    def test_notebook_drift_fails_before_writing_any_partial_patch(self):
        for mode in ['unknown', 'duplicate', 'missing']:
            notebook = original_notebook()
            if mode == 'unknown': notebook['cells'][2]['source'] = ['# Different GPU setup\npass\n']
            elif mode == 'duplicate': notebook['cells'].insert(2, dict(notebook['cells'][2]))
            else: notebook['cells'].pop(2)
            with tempfile.TemporaryDirectory() as tmp:
                result, path = patched(tmp, notebook)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(json.loads(path.read_text()), notebook)


if __name__ == '__main__':
    unittest.main()
