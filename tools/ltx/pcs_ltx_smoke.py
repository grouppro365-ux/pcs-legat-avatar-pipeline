"""Cloud-only LTX smoke through upstream Diffusers; never reads PCS/customer assets.

Inference: https://huggingface.co/docs/diffusers/v0.36.0/en/api/pipelines/ltx_video
Diffusers code is Apache-2.0. Model weights have their own Lightricks license:
https://huggingface.co/Lightricks/LTX-Video-0.9.5/blob/e58e28c39631af4d1468ee57a853764e11c1d37e/ltx-video-2b-v0.9.5.license.txt
This smoke proves one generated artifact, not video factory completion.
"""
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import subprocess
import sys

MODEL = 'Lightricks/LTX-Video-0.9.5'
REVISION = 'e58e28c39631af4d1468ee57a853764e11c1d37e'
PROMPT = ('A small green leaf moves gently in a breeze against a plain light background. '
          'A steady close camera records the natural movement, soft daylight, no text or people.')
WIDTH, HEIGHT, FRAMES, FPS = 320, 256, 17, 8
PACKAGES = {'torch': '2.5.1', 'diffusers': '0.36.0', 'transformers': '4.57.3',
            'accelerate': '1.12.0', 'imageio': '2.37.0', 'imageio-ffmpeg': '0.6.0',
            'sentencepiece': '0.2.1', 'safetensors': '0.6.2', 'huggingface-hub': '0.36.0'}


def artifact_receipt(path, *, width=WIDTH, height=HEIGHT, frames=FRAMES, fps=FPS):
    """Read the actual encoded MP4; an empty/non-decodable file cannot pass QA."""
    path = Path(path)
    if not path.is_file() or path.stat().st_size < 1024:
        raise RuntimeError('video_missing_or_empty')
    import imageio_ffmpeg
    reader = imageio_ffmpeg.read_frames(str(path))
    count = 0
    try:
        meta = next(reader)
        if tuple(meta.get('size', ())) != (width, height) or not math.isclose(meta.get('fps', 0), fps):
            raise RuntimeError('video_geometry_mismatch')
        for frame in reader:
            count += 1
            if len(frame) != width * height * 3 or count > frames:
                raise RuntimeError('video_geometry_mismatch')
    finally:
        reader.close()
    if count != frames:
        raise RuntimeError('video_geometry_mismatch')
    # Use the same pinned FFmpeg wheel that Diffusers export already requires.
    # Enforce the decoder exit status too: a permissive reader may stop at EOF
    # after a corrupt frame instead of raising it to Python.
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-xerror',
                    '-i', str(path), '-f', 'null', '-'], check=True,
                   capture_output=True, timeout=30)
    return {'file': path.name, 'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'width': width, 'height': height, 'frames': frames, 'fps': fps,
            'duration_seconds': frames / fps, 'codec': meta['codec'], 'decode_verified': True}


def run(output_dir='/kaggle/working/pcs-ltx-output'):
    # Guard against accidental execution on the user's computer or a CPU runner.
    if not Path('/kaggle/working').is_dir() or not os.environ.get('KAGGLE_KERNEL_RUN_TYPE'):
        raise RuntimeError('requires_existing_kaggle_gpu_runtime')
    run_id = os.environ.get('PCS_LTX_RUN_ID')
    if not run_id:
        raise RuntimeError('ltx_run_identity_missing')
    import torch
    import numpy as np
    from diffusers import LTXPipeline
    from diffusers.utils import export_to_video
    if not torch.cuda.is_available():
        raise RuntimeError('gpu_unavailable')
    actual = {name: importlib.metadata.version(name) for name in PACKAGES}
    for name, expected in PACKAGES.items():
        if actual[name].split('+')[0] != expected:
            raise RuntimeError('dependency_version_mismatch:' + name)
    torch.manual_seed(42)
    # P100 has no native BF16. FP32 plus upstream sequential CPU offload avoids
    # unsupported BF16 kernels and FP16 overflow in the T5 encoder.
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32
    pipeline = LTXPipeline.from_pretrained(MODEL, revision=REVISION,
                                          torch_dtype=dtype, low_cpu_mem_usage=True)
    pipeline.enable_sequential_cpu_offload()
    pipeline.vae.enable_tiling()
    video = pipeline(prompt=PROMPT, negative_prompt='text, logo, watermark, flickering, distortion',
                     width=WIDTH, height=HEIGHT, num_frames=FRAMES,
                     frame_rate=FPS, num_inference_steps=30, guidance_scale=3.0,
                     generator=torch.Generator(device='cpu').manual_seed(42),
                     max_sequence_length=128).frames[0]
    pixels = np.asarray(video)
    if not np.isfinite(pixels).all() or pixels.shape[0] != FRAMES or pixels.std() < 0.002:
        raise RuntimeError('generated_frames_invalid_or_blank')
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / 'ltx-smoke.mp4'
    export_to_video(video, str(target), fps=FPS)
    receipt = {'run_id': run_id, 'outcome': 'GENERATED_SMOKE', 'model': MODEL, 'model_revision': REVISION,
               'implementation': 'diffusers.LTXPipeline', 'dependencies': actual,
               'gpu': torch.cuda.get_device_name(0),
               'gpu_vram_bytes': torch.cuda.get_device_properties(0).total_memory,
               'dtype': str(dtype), 'seed': 42, 'private_assets_used': False,
               'customer_send': False, 'published': False,
               'artifact': artifact_receipt(target)}
    (directory / 'result.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))
    return receipt


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        out = Path('/kaggle/working/pcs-ltx-output')
        if Path('/kaggle/working').is_dir():
            out.mkdir(parents=True, exist_ok=True)
            # No environment dumps, credentials, customer text, or dataset inputs.
            (out / 'failure.json').write_text(json.dumps({'run_id':os.environ.get('PCS_LTX_RUN_ID'), 'outcome': 'FAILED',
                'error_type': type(error).__name__, 'stage': 'ltx_smoke',
                'model': MODEL, 'model_revision': REVISION}) + '\n')
        raise
