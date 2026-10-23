"""Bounded, local-file video adaptation using upstream FFmpeg.

Requires imageio-ffmpeg==0.6.0 (BSD-2-Clause wrapper, bundled FFmpeg; FFmpeg
license/build details: https://ffmpeg.org/legal.html). No inference, network
inputs, publication or semantic/brand approval is performed by this module.

process_manifest(manifest, input_root, output_root) returns a technical receipt.
Only audio='mute' is currently implemented; muting must be explicitly selected.
The caller must keep the output private until the separate editorial approval.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile

PRESETS = {
    'reel': (1080, 1920), 'story': (1080, 1920),
    'tiktok': (1080, 1920), 'shorts': (1080, 1920),
    'feed': (1080, 1350), 'pinterest': (1000, 1500),
    'landscape': (1280, 720),
}
FPS = 24
MAX_SHOTS, MAX_SECONDS = 8, 60
MAX_INPUT_BYTES, MAX_TOTAL_BYTES, MAX_OUTPUT_BYTES = 512 * 1024**2, 1024**3, 256 * 1024**2
DEMUXERS = {'.mp4': 'mov', '.mov': 'mov', '.m4v': 'mov', '.webm': 'matroska', '.mkv': 'matroska'}


class VideoError(ValueError):
    """Stable error code safe to show without leaking local file paths/logs."""


def _ffmpeg():
    import imageio_ffmpeg
    if importlib.metadata.version('imageio-ffmpeg') != '0.6.0':
        raise VideoError('ffmpeg_dependency_version_mismatch')
    return imageio_ffmpeg.get_ffmpeg_exe()


def _run(arguments, *, timeout=120):
    try:
        return subprocess.run([_ffmpeg(), '-nostdin', '-hide_banner',
                               '-max_alloc', '134217728', '-threads', '2', *arguments],
                              check=True, capture_output=True, timeout=timeout)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        # Decoder logs and source paths stay local, never in the job receipt.
        raise VideoError('video_processing_failed') from None


def _hash(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            result.update(chunk)
    return result.hexdigest()


def _number(value, low, high):
    return type(value) in (float, int) and math.isfinite(value) and low <= value <= high


def _source(root, relative):
    if (not isinstance(relative, str) or len(relative) > 300 or not relative
            or '\\' in relative or ':' in relative or '\x00' in relative):
        raise VideoError('video_source_invalid')
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts or path.suffix.lower() not in DEMUXERS:
        raise VideoError('video_source_invalid')
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise VideoError('video_source_invalid')
    size = resolved.stat().st_size
    if not 1024 <= size <= MAX_INPUT_BYTES:
        raise VideoError('video_source_size_invalid')
    return resolved


def validate_manifest(manifest, input_root):
    """Resolve only regular local video containers beneath the trusted root."""
    if not isinstance(manifest, dict) or set(manifest) != {'job_id', 'platform', 'fit', 'audio', 'shots'}:
        raise VideoError('video_manifest_invalid')
    job = manifest['job_id']
    if not isinstance(job, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', job):
        raise VideoError('video_job_identity_invalid')
    if (not isinstance(manifest['platform'], str) or manifest['platform'] not in PRESETS
            or manifest['fit'] not in ('contain', 'cover')):
        raise VideoError('video_adaptation_invalid')
    if manifest['audio'] != 'mute':
        raise VideoError('video_audio_policy_unsupported')
    shots = manifest['shots']
    if not isinstance(shots, list) or not 1 <= len(shots) <= MAX_SHOTS:
        raise VideoError('video_shot_limit')
    root = Path(input_root).resolve()
    if not root.is_dir():
        raise VideoError('video_input_root_invalid')
    total, total_bytes, resolved, source_receipts = 0, 0, [], []
    seen = {}
    for shot in shots:
        if (not isinstance(shot, dict) or set(shot) != {'path', 'start', 'duration'}
                or not _number(shot['start'], 0, 3600)
                or not _number(shot['duration'], 1 / FPS, 15)):
            raise VideoError('video_shot_invalid')
        path = _source(root, shot['path'])
        total += shot['duration']
        if path not in seen:
            total_bytes += path.stat().st_size
            seen[path] = _hash(path)
        resolved.append((path, shot['start'], shot['duration']))
        source_receipts.append({'path': shot['path'], 'sha256': seen[path],
                                'start': shot['start'], 'duration': shot['duration']})
    if total > MAX_SECONDS or total_bytes > MAX_TOTAL_BYTES:
        raise VideoError('video_resource_limit')
    canonical = {**manifest, 'shots': source_receipts}
    fingerprint = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    rounded_seconds = sum(round(shot[2] * FPS) for shot in resolved) / FPS
    if rounded_seconds > MAX_SECONDS:
        raise VideoError('video_resource_limit')
    return resolved, rounded_seconds, fingerprint


def _metadata(path):
    import imageio_ffmpeg
    demuxer = DEMUXERS.get(path.suffix.lower())
    if demuxer is None:
        raise VideoError('video_source_invalid')
    reader = imageio_ffmpeg.read_frames(str(path), input_params=[
        '-max_alloc', '134217728', '-threads', '2',
        '-protocol_whitelist', 'file,pipe', '-f', demuxer])
    try:
        metadata = next(reader)
    except Exception:
        raise VideoError('video_probe_failed') from None
    finally:
        reader.close()
    size, duration = metadata.get('size', ()), metadata.get('duration', 0)
    if (len(size) != 2 or not all(type(v) is int and 1 <= v <= 4096 for v in size)
            or size[0] * size[1] > 4096 * 2160
            or not _number(duration, 1 / FPS, 3660)):
        raise VideoError('video_source_geometry_invalid')
    return metadata


def technical_qa(path, *, width, height, expected_seconds):
    """Decode every output frame, verify length/geometry and reject black runs."""
    if (not _number(expected_seconds, 1 / FPS, MAX_SECONDS)
            or type(width) is not int or type(height) is not int
            or not 1 <= width <= 4096 or not 1 <= height <= 4096):
        raise VideoError('video_qa_expectation_invalid')
    path = Path(path)
    if not path.is_file() or not 1024 <= path.stat().st_size <= MAX_OUTPUT_BYTES:
        raise VideoError('video_output_size_invalid')
    meta = _metadata(path)
    if tuple(meta['size']) != (width, height) or not math.isclose(meta.get('fps', 0), FPS, abs_tol=0.001):
        raise VideoError('video_output_geometry_mismatch')
    result = _run(['-v', 'info', '-xerror', '-protocol_whitelist', 'file,pipe',
                   '-f', 'mov', '-i', str(path), '-an', '-vf',
                   'blackdetect=d=0:pix_th=0.08:pic_th=0.98',
                   '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'],
                  timeout=max(30, int(expected_seconds * 4)))
    progress = result.stdout.decode('utf-8', errors='replace')
    counts = re.findall(r'(?m)^frame=(\d+)$', progress)
    if not counts or 'progress=end' not in progress:
        raise VideoError('video_decode_receipt_missing')
    frames = int(counts[-1])
    if frames != round(expected_seconds * FPS):
        raise VideoError('video_output_duration_mismatch')
    black = re.findall(r'black_start:([0-9.]+) black_end:([0-9.]+) black_duration:([0-9.]+)',
                       result.stderr.decode('utf-8', errors='replace'))
    # A final single black frame has a zero-duration interval in FFmpeg's
    # timestamp convention. It is still a frame, and must not slip through.
    if black:
        raise VideoError('video_black_frames_detected')
    return {'decode_verified': True, 'black_frame_check': 'PASSED', 'width': width,
            'height': height, 'fps': FPS, 'frames': frames, 'duration_seconds': frames / FPS,
            'bytes': path.stat().st_size, 'sha256': _hash(path), 'codec': meta.get('codec')}


def process_manifest(manifest, input_root, output_root):
    """Create one private platform adaptation, atomically after technical QA.

    Existing output is replayed only if the manifest, source bytes and exact
    output bytes match the stored receipt. Incomplete or changed output fails
    closed rather than overwriting or silently declaring another job complete.
    """
    shots, seconds, fingerprint = validate_manifest(manifest, input_root)
    _ffmpeg()
    root = Path(output_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    stem = manifest['job_id'] + '-' + manifest['platform']
    target, receipt_path, cover = root / (stem + '.mp4'), root / (stem + '.json'), root / (stem + '.png')
    if target.exists() or receipt_path.exists() or cover.exists():
        try:
            receipt = json.loads(receipt_path.read_text())
            if (receipt['manifest_sha256'] == fingerprint and receipt['artifact']['sha256'] == _hash(target)
                    and receipt['cover']['sha256'] == _hash(cover)):
                return {**receipt, 'replayed': True}
        except (OSError, ValueError, KeyError, TypeError):
            pass
        raise VideoError('video_output_conflict')
    width, height = PRESETS[manifest['platform']]
    if manifest['fit'] == 'cover':
        adaptation = f'scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}'
    else:
        adaptation = f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black'
    with tempfile.TemporaryDirectory(prefix='.pcs-video-', dir=root) as tmp:
        directory = Path(tmp)
        source_geometry = []
        for index, (source, start, duration) in enumerate(shots):
            metadata = _metadata(source)
            source_geometry.append({'width': metadata['size'][0], 'height': metadata['size'][1]})
            if start + duration > metadata['duration'] + 0.03:
                raise VideoError('video_trim_outside_source')
            _run(['-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe',
                  '-ss', str(start), '-f', DEMUXERS[source.suffix.lower()], '-i', str(source),
                  '-t', str(duration), '-an', '-vf', adaptation + f',fps={FPS},setsar=1,format=yuv420p',
                  '-frames:v', str(round(duration * FPS)), '-c:v', 'libx264', '-preset', 'veryfast',
                  # No reordered DTS across stream-copied scene boundaries.
                  # B-frame delay differs for short scenes and distorts average FPS.
                  '-bf', '0', '-crf', '23', '-threads', '2', '-filter_threads', '1', '-map_metadata', '-1',
                  '-movflags', '+faststart', str(directory / f'shot-{index}.mp4')],
                 timeout=max(30, int(duration * 10)))
        # Names are entirely generated here, never interpolated from manifest paths.
        listing = directory / 'shots.txt'
        listing.write_text(''.join(f"file 'shot-{index}.mp4'\n" for index in range(len(shots))))
        output = directory / 'output.mp4'
        _run(['-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe',
              '-f', 'concat', '-safe', '1', '-i', str(listing), '-an', '-c:v', 'copy',
              '-map_metadata', '-1', '-movflags', '+faststart', str(output)])
        qa = technical_qa(output, width=width, height=height, expected_seconds=seconds)
        generated_cover = directory / 'cover.png'
        _run(['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', str(output),
              '-ss', str(min(seconds / 2, 0.5)), '-frames:v', '1', '-c:v', 'png', '-threads', '1',
              str(generated_cover)])
        if not generated_cover.is_file() or generated_cover.stat().st_size < 100:
            raise VideoError('video_cover_missing')
        receipt = {'job_id': manifest['job_id'], 'platform': manifest['platform'],
                   'manifest_sha256': fingerprint, 'outcome': 'TECHNICAL_QA_PASSED',
                   'artifact': {'file': target.name, **qa},
                   'cover': {'file': cover.name, 'sha256': _hash(generated_cover)},
                   'fit': manifest['fit'], 'audio': 'muted', 'source_shots': len(shots),
                   'source_geometry': source_geometry,
                   'upscaled': any(width > item['width'] or height > item['height'] for item in source_geometry),
                   'implementation': 'FFmpeg via imageio-ffmpeg==0.6.0',
                   'manual_review_required': True,
                   'unverified_checks': ['brand', 'language', 'claims', 'captions', 'safe_zones',
                                         'generation_artifacts', 'semantic_duplicates'],
                   'published': False}
        # Exclusive names prevent concurrent jobs from silently replacing each other.
        # The completion receipt is written last; a crash cannot appear complete.
        try:
            staged_receipt = directory / 'receipt.json'
            staged_receipt.write_text(json.dumps(receipt, sort_keys=True, indent=2) + '\n')
            os.link(output, target)
            os.link(generated_cover, cover)
            os.link(staged_receipt, receipt_path)
        except FileExistsError:
            raise VideoError('video_output_conflict') from None
        return receipt
