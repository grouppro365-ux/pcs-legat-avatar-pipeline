from pathlib import Path
import hashlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/video'))
from postprocess import PRESETS, VideoError, process_manifest, validate_manifest, technical_qa


def fixture_video(path, color, *, duration=1):
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-v', 'error',
                    '-f', 'lavfi', '-i', f'color=c={color}:s=320x240:r=24:d={duration}',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', str(path)],
                   check=True, capture_output=True, timeout=15)


def manifest(platform='reel', fit='cover'):
    return {'job_id': 'test-job', 'platform': platform, 'fit': fit, 'audio': 'mute',
            'shots': [{'path': 'red.mp4', 'start': 0.25, 'duration': 0.25},
                      {'path': 'blue.mp4', 'start': 0.5, 'duration': 0.25}]}


class VideoPostprocessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory()
        cls.inputs = Path(cls.workspace.name) / 'inputs'
        cls.inputs.mkdir()
        for color in ['red', 'blue', 'black']:
            fixture_video(cls.inputs / (color + '.mp4'), color)

    @classmethod
    def tearDownClass(cls):
        cls.workspace.cleanup()

    def test_multishot_export_decodes_real_frames_in_order_and_replays_exact_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = process_manifest(manifest(), self.inputs, tmp)
            self.assertEqual(result['outcome'], 'TECHNICAL_QA_PASSED')
            self.assertTrue(result['manual_review_required'])
            self.assertFalse(result['published'])
            self.assertEqual(result['source_shots'], 2)
            self.assertEqual((result['artifact']['width'], result['artifact']['height']), (1080, 1920))
            self.assertEqual(result['artifact']['frames'], 12)
            self.assertEqual(result['artifact']['duration_seconds'], 0.5)
            self.assertEqual(result['audio'], 'muted')
            self.assertTrue(result['upscaled'])
            self.assertEqual(result['source_geometry'], [{'width': 320, 'height': 240}] * 2)
            self.assertIn('claims', result['unverified_checks'])
            reader = imageio_ffmpeg.read_frames(str(Path(tmp) / result['artifact']['file']))
            try:
                meta = next(reader)
                pixels = []
                offset = ((meta['size'][1] // 2) * meta['size'][0] + meta['size'][0] // 2) * 3
                for frame in reader:
                    pixels.append(tuple(frame[offset:offset + 3]))
            finally:
                reader.close()
            self.assertGreater(pixels[0][0], pixels[0][2] + 100)
            self.assertGreater(pixels[-1][2], pixels[-1][0] + 100)
            replay = process_manifest(manifest(), self.inputs, tmp)
            self.assertTrue(replay['replayed'])
            self.assertEqual(replay['artifact']['sha256'], result['artifact']['sha256'])
            changed = manifest()
            changed['fit'] = 'contain'
            with self.assertRaisesRegex(VideoError, 'video_output_conflict'):
                process_manifest(changed, self.inputs, tmp)
            Path(tmp, result['artifact']['file']).write_bytes(b'tampered bytes')
            with self.assertRaisesRegex(VideoError, 'video_output_conflict'):
                process_manifest(manifest(), self.inputs, tmp)

    def test_platform_presets_create_distinct_real_geometry_and_cover(self):
        self.assertEqual(set(PRESETS), {'reel', 'story', 'tiktok', 'shorts', 'feed', 'pinterest', 'landscape'})
        for platform in ['feed', 'pinterest', 'landscape']:
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as tmp:
                request = manifest(platform, 'contain')
                request['shots'] = request['shots'][:1]
                result = process_manifest(request, self.inputs, tmp)
                self.assertEqual((result['artifact']['width'], result['artifact']['height']), PRESETS[platform])
                self.assertEqual(result['artifact']['black_frame_check'], 'PASSED')
                self.assertTrue(Path(tmp, result['cover']['file']).is_file())
                self.assertEqual(Path(tmp, result['cover']['file']).read_bytes()[:8], b'\x89PNG\r\n\x1a\n')
                self.assertEqual(result['artifact']['frames'], 6)

    def test_ltx_source_frame_rates_preserve_every_scene_and_png_storage_contract(self):
        # Encoded fixtures match LTX source geometry/timing; they are not model evidence.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for frames, color in [(17, 'red'), (33, 'blue')]:
                subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-v', 'error',
                                '-f', 'lavfi', '-i', f'color=c={color}:s=320x256:r=8',
                                '-frames:v', str(frames), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                                '-threads', '1', str(root / f'shot-{frames}.mp4')],
                               check=True, capture_output=True, timeout=15)
            request = {'job_id': 'ltx-timing-fixture', 'platform': 'landscape', 'fit': 'contain',
                       'audio': 'mute', 'shots': [{'path': f'shot-{frames}.mp4', 'start': 0,
                                                  'duration': frames / 8} for frames in [17, 33]]}
            result = process_manifest(request, root, root / 'output')
            self.assertEqual(result['artifact']['frames'], (17 + 33) * 3)
            self.assertEqual(result['artifact']['fps'], 24)
            self.assertEqual(result['artifact']['duration_seconds'], (17 + 33) / 8)
            self.assertEqual(result['source_geometry'], [{'width': 320, 'height': 256}] * 2)
            self.assertEqual(result['artifact']['codec'], 'h264')
            for kind in ['artifact', 'cover']:
                actual = (root / 'output' / result[kind]['file']).read_bytes()
                self.assertEqual(hashlib.sha256(actual).hexdigest(), result[kind]['sha256'])
                if kind == 'cover':
                    self.assertTrue(result[kind]['file'].endswith('.png'))
                    self.assertEqual(actual[:8], b'\x89PNG\r\n\x1a\n')
            reader = imageio_ffmpeg.read_frames(str(root / 'output' / result['artifact']['file']))
            try:
                meta = next(reader)
                offset = ((meta['size'][1] // 2) * meta['size'][0] + meta['size'][0] // 2) * 3
                colors = [tuple(frame[offset:offset + 3]) for frame in reader]
            finally:
                reader.close()
            self.assertEqual(len(colors), 150)
            self.assertGreater(colors[50][0], colors[50][2] + 100)
            self.assertGreater(colors[51][2], colors[51][0] + 100)

    def test_failed_qa_black_output_never_gets_a_completion_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            request = manifest()
            request['shots'] = [{'path': 'black.mp4', 'start': 0, 'duration': 0.5}]
            with self.assertRaisesRegex(VideoError, 'video_black_frames_detected'):
                process_manifest(request, self.inputs, tmp)
            self.assertEqual(list(Path(tmp).iterdir()), [])
        with tempfile.TemporaryDirectory() as tmp:
            request = manifest()
            request['shots'][1] = {'path': 'black.mp4', 'start': 0, 'duration': 1 / 24}
            with self.assertRaisesRegex(VideoError, 'video_black_frames_detected'):
                process_manifest(request, self.inputs, tmp)
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_missing_frames_or_wrong_geometry_cannot_pass_technical_qa(self):
        with self.assertRaisesRegex(VideoError, 'video_output_geometry_mismatch'):
            technical_qa(self.inputs / 'red.mp4', width=1280, height=720, expected_seconds=1)
        with self.assertRaisesRegex(VideoError, 'video_output_duration_mismatch'):
            technical_qa(self.inputs / 'red.mp4', width=320, height=240, expected_seconds=0.5)
        with self.assertRaisesRegex(VideoError, 'video_output_duration_mismatch'):
            technical_qa(self.inputs / 'red.mp4', width=320, height=240, expected_seconds=25 / 24)

    def test_trim_outside_source_and_corrupt_container_fail_before_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            request = manifest()
            request['shots'][0]['start'] = 10
            with self.assertRaisesRegex(VideoError, 'video_trim_outside_source'):
                process_manifest(request, self.inputs, tmp)
            self.assertEqual(list(Path(tmp).iterdir()), [])
        corrupt = self.inputs / 'corrupt.mp4'
        corrupt.write_bytes(b'not a video container' * 100)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                request = manifest()
                request['shots'][0]['path'] = 'corrupt.mp4'
                with self.assertRaisesRegex(VideoError, 'video_probe_failed'):
                    process_manifest(request, self.inputs, tmp)
                self.assertEqual(list(Path(tmp).iterdir()), [])
        finally:
            corrupt.unlink()

    def test_untrusted_paths_and_resource_limits_never_start_ffmpeg(self):
        invalid = []
        for value in ['https://example.com/movie.mp4', '../red.mp4', '/tmp/red.mp4', 'a\\b.mp4', 'playlist.m3u8']:
            request = manifest()
            request['shots'][0]['path'] = value
            invalid.append(request)
        for key, value in [('fit', 'injected;filter'), ('audio', 'preserve'), ('job_id', '../other'), ('platform', 'arbitrary'), ('platform', [])]:
            request = manifest()
            request[key] = value
            invalid.append(request)
        request = manifest()
        request['shots'] *= 5
        invalid.append(request)
        request = manifest()
        request['shots'] = [{'path': 'red.mp4', 'start': 0, 'duration': 15}] * 5
        invalid.append(request)
        for value in [True, float('nan'), float('inf'), -1]:
            request = manifest()
            request['shots'][0]['duration'] = value
            invalid.append(request)
        with patch('subprocess.run') as run:
            for request in invalid:
                with self.subTest(request=request), self.assertRaises(VideoError):
                    process_manifest(request, self.inputs, self.inputs / 'unused-out')
            run.assert_not_called()

    def test_source_symlink_cannot_escape_root_and_partial_output_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            outside = Path(tmp, 'outside.mp4')
            outside.write_bytes((self.inputs / 'red.mp4').read_bytes())
            link = self.inputs / 'outside-link.mp4'
            try:
                link.symlink_to(outside)
                request = manifest()
                request['shots'][0]['path'] = link.name
                with self.assertRaisesRegex(VideoError, 'video_source_invalid'):
                    validate_manifest(request, self.inputs)
            finally:
                link.unlink(missing_ok=True)
            output = Path(tmp, 'output')
            output.mkdir()
            partial = output / 'test-job-reel.mp4'
            partial.write_bytes(b'existing incomplete job')
            with self.assertRaisesRegex(VideoError, 'video_output_conflict'):
                process_manifest(manifest(), self.inputs, output)
            self.assertEqual(partial.read_bytes(), b'existing incomplete job')


if __name__ == '__main__':
    unittest.main()
