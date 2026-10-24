"""Bounded operator-authored captions using the existing FFmpeg/libass renderer.

No inference, translation, arbitrary style, font path or ASS instructions are
accepted. DejaVu Sans is distributed unchanged with its license in fonts/.
fontTools==4.61.1 inspects the actual pinned font before a job may use the GPU.
"""
from __future__ import annotations

from functools import lru_cache
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import re
import shutil

FPS = 24
FONT = Path(__file__).resolve().parent / 'fonts' / 'DejaVuSans.ttf'
FONT_SHA256 = 'ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280'
FORBIDDEN = re.compile(r'[{}\\\x00-\x09\x0b-\x1f\x7f-\x9f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]')


class CaptionError(ValueError):
    """Stable local error code; never include text or file paths in errors."""


@lru_cache(maxsize=1)
def _font_metrics():
    try:
        if hashlib.sha256(FONT.read_bytes()).hexdigest() != FONT_SHA256:
            raise CaptionError('caption_font_integrity_failed')
        if importlib.metadata.version('fonttools') != '4.61.1':
            raise CaptionError('caption_fonttools_version_mismatch')
        from fontTools.ttLib import TTFont
        with TTFont(FONT) as font:
            cmap = font.getBestCmap()
            metrics = font['hmtx'].metrics
            advances = {cp: metrics[glyph][0] for cp, glyph in cmap.items()}
            glyphs = font['glyf']
            bounds = {cp: (getattr(glyphs[glyph], 'xMin', 0), getattr(glyphs[glyph], 'xMax', 0)) for cp, glyph in cmap.items()}
            return advances, bounds, font['head'].unitsPerEm, font['hhea'].ascent - font['hhea'].descent + font['hhea'].lineGap
    except CaptionError:
        raise
    except (OSError, KeyError, ImportError, importlib.metadata.PackageNotFoundError):
        raise CaptionError('caption_font_unavailable') from None


def _hash_json(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def validate_finishing(finishing, *, width, height, total_frames):
    """Validate the exact canonical contract and actual font/safe-area fit.

    Returns non-text rendering evidence; the input remains unchanged. The
    caller can invoke this before generation to reject invalid captions early.
    """
    if (type(width) is not int or type(height) is not int or type(total_frames) is not int
            or not 1 <= width <= 4096 or not 1 <= height <= 4096 or not 1 <= total_frames <= 1440):
        raise CaptionError('caption_geometry_invalid')
    if (not isinstance(finishing, dict) or set(finishing) != {'version', 'style', 'language', 'cues'}
            or type(finishing['version']) is not int or finishing['version'] != 1
            or finishing['style'] != 'readable-v1' or finishing['language'] not in ('ru', 'en')
            or not isinstance(finishing['cues'], list) or not 1 <= len(finishing['cues']) <= 12):
        raise CaptionError('caption_finishing_invalid')
    # Verify the bytes on every invocation, including after a previous job
    # populated the metrics cache; a replaced font cannot replay accepted QA.
    try:
        if hashlib.sha256(FONT.read_bytes()).hexdigest() != FONT_SHA256:
            raise CaptionError('caption_font_integrity_failed')
    except OSError:
        raise CaptionError('caption_font_unavailable') from None
    advances, bounds, units, line_height = _font_metrics()
    font_size = max(18, round(min(width * .043, height * .058)))
    padding = max(4, round(font_size * .18))
    left, right, top, bottom = math.ceil(width * .08), math.floor(width * .92), math.ceil(height * .10), math.floor(height * .80)
    available_width = right - left - 2 * padding
    previous_end, lines_max = 0, 0
    for cue in finishing['cues']:
        if (not isinstance(cue, dict) or set(cue) != {'start_frame', 'end_frame', 'text'}
                or type(cue['start_frame']) is not int or type(cue['end_frame']) is not int
                or not previous_end <= cue['start_frame'] < cue['end_frame'] <= total_frames):
            raise CaptionError('caption_timing_invalid')
        text = cue['text']
        if not isinstance(text, str) or not 1 <= len(text) <= 72 or FORBIDDEN.search(text):
            raise CaptionError('caption_text_invalid')
        lines = text.split('\n')
        if not 1 <= len(lines) <= 2 or any(not line.strip() or len(line) > 36 for line in lines):
            raise CaptionError('caption_text_invalid')
        for line in lines:
            if any(ord(char) not in advances for char in line):
                raise CaptionError('caption_glyph_unsupported')
            # Unkerned advance plus symmetric ink overhang is conservative
            # for the supported font, including accented glyph sidebearings.
            cursor, ink_left, ink_right = 0, 0, 0
            for char in line:
                low, high = bounds[ord(char)]
                ink_left = min(ink_left, cursor + low)
                ink_right = max(ink_right, cursor + high)
                cursor += advances[ord(char)]
            extent = cursor + 2 * max(-ink_left, ink_right - cursor, 0)
            if extent * font_size / units > available_width:
                raise CaptionError('caption_line_too_wide')
        if len(lines) * line_height * font_size / units + 2 * padding > bottom - top:
            raise CaptionError('caption_block_too_tall')
        previous_end = cue['end_frame']
        lines_max = max(lines_max, len(lines))
    return {'applied': True, 'style': 'readable-v1', 'language': finishing['language'],
            'cue_count': len(finishing['cues']), 'fps': FPS, 'font_sha256': FONT_SHA256,
            'font_family': 'DejaVu Sans', 'font_size': font_size, 'max_lines': lines_max,
            'safe_area': {'left': left, 'right': right, 'top': top, 'bottom': bottom},
            'finishing_sha256': _hash_json(finishing), 'renderer': 'FFmpeg/libass',
            'font_inspector': 'fontTools==4.61.1'}


def _ass_time(frame):
    # ASS uses centiseconds. Flooring both boundaries includes exactly the
    # requested [start,end) frames on the fixed 24fps grid (frame spacing>10ms).
    ticks = frame * 100 // FPS
    hours, rest = divmod(ticks, 360000)
    minutes, rest = divmod(rest, 6000)
    seconds, centis = divmod(rest, 100)
    return f'{hours}:{minutes:02d}:{seconds:02d}.{centis:02d}'


def prepare_caption_file(finishing, directory, *, width, height, total_frames):
    evidence = validate_finishing(finishing, width=width, height=height, total_frames=total_frames)
    directory = Path(directory)
    fonts = directory / 'fonts'
    fonts.mkdir(exist_ok=True)
    shutil.copyfile(FONT, fonts / 'DejaVuSans.ttf')
    # Isolate Fontconfig from host-installed fonts: the vendored, hash-checked
    # font is the only candidate. Paths and config are generated by us.
    (directory / 'fonts.conf').write_text('<?xml version="1.0"?><fontconfig><dir prefix="relative">fonts</dir><cachedir prefix="relative">font-cache</cachedir></fontconfig>\n')
    font_size = evidence['font_size']
    padding = max(4, round(font_size * .18))
    margin_x = evidence['safe_area']['left'] + padding
    margin_y = height - evidence['safe_area']['bottom'] + padding
    header = f'''[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,{font_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,3,{padding},0,2,{margin_x},{margin_x},{margin_y},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    entries = []
    for cue in finishing['cues']:
        # Only the newline generated here becomes an ASS escape. Braces and
        # user backslashes were rejected before constructing this document.
        text = cue['text'].replace('\n', r'\N')
        entries.append(f"Dialogue: 0,{_ass_time(cue['start_frame'])},{_ass_time(cue['end_frame'])},Caption,,0,0,0,,{text}\n")
    path = directory / 'captions.ass'
    path.write_text(header + ''.join(entries), encoding='utf-8')
    return path, evidence
