import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fetchApprovedMedia } from './source.mjs';
import { uploadBuffer } from './postiz.mjs';

const MAX_IMAGES = 8;
const MAX_DURATION_SECONDS = 30;
const FONT_REGULAR = process.env.REEL_FONT_REGULAR || '/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf';
const FONT_BOLD = process.env.REEL_FONT_BOLD || '/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf';

function run(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${command} exited ${code}: ${stderr.slice(-4000)}`));
    });
  });
}

function extensionForMime(mimeType) {
  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('webp')) return '.webp';
  if (mimeType.includes('gif')) return '.gif';
  return '.jpg';
}

function escapeConcatPath(filePath) {
  return filePath.replace(/'/g, "'\\''");
}

async function writeTextFile(dir, name, value) {
  if (!value) return null;
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, String(value).slice(0, 500), 'utf8');
  return filePath;
}

export async function renderReelFromImages({
  imageUrls,
  title = '',
  subtitle = '',
  footer = 'legat-abc.com',
  width = 1080,
  height = 1920,
  fps = 30,
  secondsPerImage = 2.5,
  filename = 'legat-reel.mp4',
}) {
  if (!Array.isArray(imageUrls) || imageUrls.length < 1 || imageUrls.length > MAX_IMAGES) {
    throw new Error(`imageUrls must contain 1-${MAX_IMAGES} approved image URLs`);
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 320 || width > 2160 || height > 2160) {
    throw new Error('Unsupported reel dimensions');
  }
  if (!Number.isInteger(fps) || fps < 24 || fps > 60) throw new Error('fps must be 24-60');
  if (secondsPerImage < 1 || secondsPerImage > 6) throw new Error('secondsPerImage must be 1-6');
  const totalDuration = imageUrls.length * secondsPerImage;
  if (totalDuration > MAX_DURATION_SECONDS) throw new Error(`Rendered reel would exceed ${MAX_DURATION_SECONDS}s`);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'legat-reel-'));
  try {
    const segments = [];
    for (let index = 0; index < imageUrls.length; index += 1) {
      const media = await fetchApprovedMedia(imageUrls[index], { kind: 'image' });
      const inputPath = path.join(dir, `image-${index}${extensionForMime(media.mimeType)}`);
      const segmentPath = path.join(dir, `segment-${index}.mp4`);
      await fs.writeFile(inputPath, media.buffer);

      const frames = Math.max(1, Math.round(secondsPerImage * fps));
      const vf = [
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        `crop=${width}:${height}`,
        `zoompan=z='min(zoom+0.0008,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`,
        'format=yuv420p',
      ].join(',');

      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-loop', '1', '-t', String(secondsPerImage), '-i', inputPath,
        '-vf', vf,
        '-r', String(fps),
        '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        segmentPath,
      ]);
      segments.push(segmentPath);
    }

    const concatFile = path.join(dir, 'segments.txt');
    await fs.writeFile(
      concatFile,
      segments.map((segment) => `file '${escapeConcatPath(segment)}'`).join('\n'),
      'utf8'
    );

    const basePath = path.join(dir, 'base.mp4');
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-c', 'copy', basePath,
    ]);

    const titleFile = await writeTextFile(dir, 'title.txt', title);
    const subtitleFile = await writeTextFile(dir, 'subtitle.txt', subtitle);
    const footerFile = await writeTextFile(dir, 'footer.txt', footer);
    const filters = [];

    if (titleFile) {
      filters.push(
        `drawtext=fontfile=${FONT_BOLD}:textfile=${titleFile}:fontcolor=white:fontsize=${Math.round(width * 0.066)}:x=(w-text_w)/2:y=h*0.085:box=1:boxcolor=0x071B33B8:boxborderw=${Math.round(width * 0.025)}:enable='between(t,0,3.5)'`
      );
    }
    if (subtitleFile) {
      filters.push(
        `drawtext=fontfile=${FONT_REGULAR}:textfile=${subtitleFile}:fontcolor=white:fontsize=${Math.round(width * 0.036)}:x=(w-text_w)/2:y=h*0.17:box=1:boxcolor=0x071B3390:boxborderw=${Math.round(width * 0.018)}:enable='between(t,0,4.5)'`
      );
    }
    if (footerFile) {
      filters.push(
        `drawtext=fontfile=${FONT_BOLD}:textfile=${footerFile}:fontcolor=white:fontsize=${Math.round(width * 0.028)}:x=w-text_w-${Math.round(width * 0.05)}:y=h-text_h-${Math.round(height * 0.04)}:box=1:boxcolor=0x071B3380:boxborderw=${Math.round(width * 0.012)}`
      );
    }

    const outputPath = path.join(dir, filename.replace(/[^a-zA-Z0-9._-]/g, '_'));
    if (filters.length) {
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', basePath,
        '-vf', filters.join(','),
        '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outputPath,
      ]);
    } else {
      await fs.copyFile(basePath, outputPath);
    }

    const buffer = await fs.readFile(outputPath);
    const media = await uploadBuffer(buffer, path.basename(outputPath), 'video/mp4');
    return {
      media,
      durationSeconds: totalDuration,
      dimensions: { width, height },
      fps,
      sourceImages: imageUrls.length,
      generatedWithAi: false,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
