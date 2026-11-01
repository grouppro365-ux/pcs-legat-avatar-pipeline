import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/video'))
from captions import CaptionError, FONT, FONT_SHA256, prepare_caption_file, validate_finishing
from postprocess import PRESETS, VideoError, process_manifest


def finishing():
    return {'version': 1, 'style': 'readable-v1', 'language': 'ru', 'cues': [
        {'start_frame': 3, 'end_frame': 8, 'text': 'Точный текст оператора'},
        {'start_frame': 12, 'end_frame': 18, 'text': 'Exact operator text\nCafé, 100%: yes / no'},
    ]}


def request(platform='landscape'):
    return {'job_id': 'caption-fixture', 'platform': platform, 'fit': 'cover', 'audio': 'mute',
            'shots': [{'path': 'source.mp4', 'start': 0, 'duration': 1}], 'finishing': finishing()}


def visible_pixels(frame, width):
    whites, blacks = [], []
    for pixel, offset in enumerate(range(0, len(frame), 3)):
        r, g, b = frame[offset:offset + 3]
        if min(r, g, b) > 200:
            whites.append((pixel % width, pixel // width))
        elif max(r, g, b) < 30:
            blacks.append((pixel % width, pixel // width))
    return whites, blacks


class VideoCaptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory()
        cls.root = Path(cls.workspace.name)
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-v', 'error',
                        '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=24:d=1',
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', str(cls.root / 'source.mp4')],
                       check=True, capture_output=True, timeout=15)

    @classmethod
    def tearDownClass(cls):
        cls.workspace.cleanup()

    def test_real_ru_en_captions_exist_only_on_exact_requested_frames_inside_safe_area(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = process_manifest(request(), self.root, tmp)
            self.assertEqual(result['artifact']['frames'], 24)
            self.assertEqual(result['artifact']['fps'], 24)
            self.assertEqual(result['artifact']['duration_seconds'], 1)
            evidence = result['finishing']
            self.assertTrue(evidence['applied'])
            self.assertEqual(evidence['cue_count'], 2)
            self.assertEqual(evidence['font_sha256'], FONT_SHA256)
            self.assertEqual(evidence['max_lines'], 2)
            self.assertNotIn('Точный', str(evidence))
            reader = imageio_ffmpeg.read_frames(str(Path(tmp) / result['artifact']['file']))
            try:
                metadata = next(reader)
                selected = {index: frame for index, frame in enumerate(reader) if index in {2, 3, 7, 8, 11, 12, 17, 18}}
            finally:
                reader.close()
            self.assertEqual(metadata['size'], (1280, 720))
            bounds = evidence['safe_area']
            for index, frame in selected.items():
                white, black = visible_pixels(frame, 1280)
                if index in {3, 7, 12, 17}:
                    self.assertGreater(len(white), 100, index)
                    self.assertGreater(len(black), 500, index)
                    for pixels in [white, black]:
                        self.assertGreaterEqual(min(x for x, _ in pixels), bounds['left'] - 2)
                        self.assertLessEqual(max(x for x, _ in pixels), bounds['right'] + 2)
                        self.assertGreaterEqual(min(y for _, y in pixels), bounds['top'] - 2)
                        self.assertLessEqual(max(y for _, y in pixels), bounds['bottom'] + 2)
                else:
                    self.assertEqual(len(white), 0, index)
                    self.assertEqual(len(black), 0, index)
            for key in ['artifact', 'cover']:
                data = Path(tmp, result[key]['file']).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), result[key]['sha256'])

    def test_portrait_export_burns_readable_text_and_keeps_exact_geometry(self):
        value = request('reel')
        value['finishing']['cues'] = [{'start_frame': 0, 'end_frame': 24, 'text': 'Проверенный текст\nExact operator text'}]
        with tempfile.TemporaryDirectory() as tmp:
            result = process_manifest(value, self.root, tmp)
            self.assertEqual((result['artifact']['width'], result['artifact']['height']), PRESETS['reel'])
            self.assertEqual(result['artifact']['frames'], 24)
            reader = imageio_ffmpeg.read_frames(str(Path(tmp) / result['artifact']['file']))
            try:
                next(reader)
                frame = next(reader)
            finally:
                reader.close()
            white, black = visible_pixels(frame, 1080)
            self.assertGreater(len(white), 100)
            self.assertGreater(len(black), 500)
            area = result['finishing']['safe_area']
            self.assertLessEqual(max(y for _, y in black), area['bottom'] + 2)
            self.assertGreaterEqual(min(x for x, _ in black), area['left'] - 2)

    def test_exact_replay_binds_operator_text_and_pinned_font_to_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            initial = process_manifest(request(), self.root, tmp)
            replay = process_manifest(request(), self.root, tmp)
            self.assertTrue(replay['replayed'])
            self.assertEqual(replay['artifact']['sha256'], initial['artifact']['sha256'])
            changed = request()
            changed['finishing']['cues'][0]['text'] = 'Изменённый текст'
            with self.assertRaisesRegex(VideoError, 'video_output_conflict'):
                process_manifest(changed, self.root, tmp)
            self.assertEqual(hashlib.sha256(FONT.read_bytes()).hexdigest(), FONT_SHA256)
            self.assertEqual(initial['finishing']['font_sha256'], FONT_SHA256)

    def test_ass_commands_controls_paths_missing_glyphs_and_font_overflow_fail_before_ffmpeg(self):
        invalid = []
        for value in [r'{\pos(0,0)}text', r'operator\Ninjection', 'hello\x00world', 'hello\rworld',
                      'hello\u202eworld', 'hello\u00adworld', 'hello\u2028world', 'hello\u061cworld',
                      'hello\u200bworld', 'hello\ufeffworld', '', '  ', 'a\n \nb', 'a\nb\nc',
                      'a' * 37, 'a' * 36 + '\n' + 'b' * 36, '\U0010ffff', 'W' * 36]:
            f = finishing()
            f['cues'][0]['text'] = value
            invalid.append(f)
        for patch_value in [{'version': True}, {'style': 'injected'}, {'language': 'th'},
                            {'font_path': '/tmp/private.ttf'}, {'cues': []}, {'cues': finishing()['cues'] * 7}]:
            invalid.append({**finishing(), **patch_value})
        for patch_value in [{'start_frame': True}, {'start_frame': -1}, {'end_frame': 25},
                            {'end_frame': 3}, {'start_frame': 1.1}, {'path': '/tmp/file'}]:
            f = finishing()
            f['cues'][0].update(patch_value)
            invalid.append(f)
        f = finishing()
        f['cues'][1]['start_frame'] = 7
        invalid.append(f)
        with patch('subprocess.run') as run:
            for f in invalid:
                with self.subTest(finishing=f), self.assertRaises(CaptionError):
                    validate_finishing(f, width=1280, height=720, total_frames=24)
            run.assert_not_called()
        with tempfile.TemporaryDirectory() as tmp, patch('subprocess.run') as run:
            f = request()
            f['finishing']['cues'][0]['text'] = r'{\an9}injected'
            with self.assertRaisesRegex(VideoError, 'caption_text_invalid'):
                process_manifest(f, self.root, tmp)
            run.assert_not_called()
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_caption_files_use_only_generated_escapes_and_private_fixed_font_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            path, evidence = prepare_caption_file(finishing(), tmp, width=1280, height=720, total_frames=24)
            content = path.read_text()
            self.assertIn('0:00:00.12,0:00:00.33', content)
            self.assertIn(r'Exact operator text\NCafé, 100%: yes / no', content)
            self.assertNotIn('{', content)
            self.assertEqual(hashlib.sha256(Path(tmp, 'fonts/DejaVuSans.ttf').read_bytes()).hexdigest(), FONT_SHA256)
            self.assertNotIn('http', Path(tmp, 'fonts.conf').read_text())
            self.assertTrue(evidence['applied'])

    def test_changed_or_unavailable_font_cannot_borrow_cached_metrics(self):
        validate_finishing(finishing(), width=1280, height=720, total_frames=24)
        with patch('captions.FONT_SHA256', '0' * 64):
            with self.assertRaisesRegex(CaptionError, 'caption_font_integrity_failed'):
                validate_finishing(finishing(), width=1280, height=720, total_frames=24)
        with tempfile.TemporaryDirectory() as tmp, patch('captions.FONT', Path(tmp) / 'missing.ttf'):
            with self.assertRaisesRegex(CaptionError, 'caption_font_unavailable'):
                validate_finishing(finishing(), width=1280, height=720, total_frames=24)


if __name__ == '__main__':
    unittest.main()
