"""Bounded text-to-video adapter for the already verified private Kaggle GPU.

Uses the pinned upstream Diffusers LTXPipeline; credentials, CRM records,
reference assets and publication are not accepted by this provider.
"""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ltx'))
from pcs_ltx_smoke import MODEL, REVISION, PACKAGES, artifact_receipt


def validate_job(job):
    if not isinstance(job, dict) or set(job) != {'id', 'claim_id', 'spec'}:
        raise ValueError('video_provider_job_invalid')
    for key in ('id', 'claim_id'):
        try:
            if str(uuid.UUID(job[key])) != job[key]:
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise ValueError('video_provider_identity_invalid') from None
    spec = job['spec']
    if (not isinstance(spec, dict) or type(spec.get('version')) is not int or spec.get('version') != 1 or spec.get('mode') != 'TEXT_TO_VIDEO'
            or spec.get('preset') not in {'reel', 'story', 'tiktok', 'shorts', 'feed', 'pinterest', 'landscape'}
            or spec.get('fit') not in {'contain', 'cover'} or not isinstance(spec.get('shots'), list)
            or not 1 <= len(spec['shots']) <= 3):
        raise ValueError('video_provider_spec_invalid')
    if set(spec) - {'version', 'mode', 'preset', 'fit', 'shots', 'width', 'height', 'fps', 'steps'}:
        raise ValueError('video_provider_spec_invalid')
    for key, value in {'width': 320, 'height': 256, 'fps': 8, 'steps': 30}.items():
        if key in spec and (type(spec[key]) is not int or spec[key] != value):
            raise ValueError('video_provider_capability_unsupported')
    for shot in spec['shots']:
        if (not isinstance(shot, dict) or set(shot) != {'prompt', 'negative_prompt', 'seed', 'frames'}
                or not isinstance(shot['prompt'], str) or not 10 <= len(shot['prompt'].strip()) <= 2000
                or not isinstance(shot['negative_prompt'], str) or len(shot['negative_prompt']) > 1000
                or type(shot['seed']) is not int or not 0 <= shot['seed'] <= 2147483647
                or type(shot['frames']) is not int or shot['frames'] not in {17, 33}):
            raise ValueError('video_provider_shot_invalid')
    return job


def job_digest(job):
    return hashlib.sha256(json.dumps(validate_job(job), sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False).encode()).hexdigest()


def run(job, output_dir='/kaggle/working/pcs-content-video-output'):
    validate_job(job)
    if not Path('/kaggle/working').is_dir() or not os.environ.get('KAGGLE_KERNEL_RUN_TYPE'):
        raise RuntimeError('requires_existing_kaggle_gpu_runtime')
    import torch
    import numpy as np
    from diffusers import LTXPipeline
    from diffusers.utils import export_to_video
    if not torch.cuda.is_available():
        raise RuntimeError('gpu_unavailable')
    actual = {key: importlib.metadata.version(key) for key in PACKAGES}
    if any(actual[key].split('+')[0] != version for key, version in PACKAGES.items()):
        raise RuntimeError('video_dependency_version_mismatch')
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32
    pipeline = LTXPipeline.from_pretrained(MODEL, revision=REVISION, torch_dtype=dtype, low_cpu_mem_usage=True)
    pipeline.enable_sequential_cpu_offload()
    pipeline.vae.enable_tiling()
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    receipts = []
    for index, shot in enumerate(job['spec']['shots']):
        target = directory / f'shot-{index + 1:03d}.mp4'
        if target.exists():
            raise RuntimeError('video_provider_output_already_exists')
        video = pipeline(prompt=shot['prompt'], negative_prompt=shot['negative_prompt'],
                         width=320, height=256, num_frames=shot['frames'], frame_rate=8,
                         num_inference_steps=30, guidance_scale=3.0, max_sequence_length=128,
                         generator=torch.Generator(device='cpu').manual_seed(shot['seed'])).frames[0]
        pixels = np.asarray(video)
        if not np.isfinite(pixels).all() or len(video) != shot['frames'] or pixels.std() < 0.002:
            raise RuntimeError('generated_frames_invalid_or_blank')
        export_to_video(video, str(target), fps=8)
        receipts.append(artifact_receipt(target, frames=shot['frames']))
    result = {'job_id': job['id'], 'run_id': job['claim_id'], 'input_sha256': job_digest(job),
              'outcome': 'GENERATED_VIDEO_SHOTS', 'model': MODEL, 'model_revision': REVISION,
              'implementation': 'diffusers.LTXPipeline', 'dependencies': actual,
              'gpu': torch.cuda.get_device_name(0),
              'gpu_vram_bytes': torch.cuda.get_device_properties(0).total_memory,
              'dtype': str(dtype), 'shots': receipts, 'published': False,
              'customer_send': False, 'private_assets_used': False}
    (directory / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    # No prompts, credentials, source facts or customer data enter the receipt.
    print(json.dumps({'job_id': job['id'], 'outcome': result['outcome'], 'shots': len(receipts)}))
    return result


if __name__ == '__main__':
    try:
        run(json.loads(Path(sys.argv[1]).read_text()))
    except Exception as error:
        if Path('/kaggle/working').is_dir():
            directory = Path('/kaggle/working/pcs-content-video-output')
            directory.mkdir(parents=True, exist_ok=True)
            (directory / 'failure.json').write_text(json.dumps({'outcome': 'FAILED',
                'stage': 'VIDEO_GENERATION', 'error_type': type(error).__name__}) + '\n')
        raise
