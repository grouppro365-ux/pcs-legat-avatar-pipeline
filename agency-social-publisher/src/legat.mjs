import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText } from './openai.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, '../config/legat-abc.json');

export async function loadLegatConfig() {
  return JSON.parse(await fs.readFile(configPath, 'utf8'));
}

export async function generateLegatPlan({
  subject,
  facts = {},
  channels = ['instagram', 'facebook', 'telegram', 'vk', 'dzen', 'tenchat'],
  goal = 'traffic',
  language = 'auto',
  includeVisual = true,
  includeVideo = true,
}) {
  const cfg = await loadLegatConfig();
  const selected = channels.filter((x) => cfg.channels.includes(x));

  const prompt = `
You are the editorial engine for ${cfg.project}.

SUBJECT:
${subject}

BUSINESS GOAL:
${goal}

CONFIRMED FACTS ONLY:
${JSON.stringify(facts, null, 2)}

CHANNELS:
${selected.join(', ')}

LANGUAGE MODE:
${language}

PROJECT RULES:
${JSON.stringify(cfg, null, 2)}

Create a practical social package. Do not invent facts. If a necessary factual field is missing, mark it as NEEDS_CONFIRMATION instead of filling it in.

Return valid JSON only with this structure:
{
  "master_angle": "...",
  "fact_gaps": ["..."],
  "landing_recommendation": "...",
  "channels": {
    "instagram": {"format":"reel|carousel|post|stories", "hook":"...", "caption":"...", "on_visual":"...", "cta":"..."},
    "facebook": {"hook":"...", "text":"...", "cta":"..."},
    "telegram": {"title":"...", "text":"...", "cta":"..."},
    "vk": {"hook":"...", "text":"...", "cta":"..."},
    "dzen": {"title":"...", "angle":"...", "outline":["..."]},
    "tenchat": {"title":"...", "text":"...", "cta":"..."}
  },
  "visual_prompt": ${includeVisual ? '"..."' : 'null'},
  "video_prompt": ${includeVideo ? '"..."' : 'null'},
  "distribution": {"partner_repost":"...", "utm_campaign":"...", "utm_content":"..."}
}

Only include channel keys requested in CHANNELS.
`;

  const raw = await generateText({
    prompt,
    instructions: 'Be factual, concise, human, non-corporate, and channel-native. Output JSON only.',
  });

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('Planning model did not return valid JSON');
  }
}
