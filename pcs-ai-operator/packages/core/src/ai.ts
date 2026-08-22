import { INTENTS, type Intent } from './intents.js';
import type { AiCandidate, Risk } from './policy.js';

function isIntent(v: unknown): v is Intent { return typeof v === 'string' && (INTENTS as readonly string[]).includes(v); }
function isRisk(v: unknown): v is Risk { return v === 'low' || v === 'medium' || v === 'high'; }

export function parseAiCandidate(raw: string): AiCandidate & { crm_updates: Record<string, unknown> } {
  let value: any;
  try { value = JSON.parse(raw); } catch { throw new Error('AI output is not valid JSON'); }
  if (!isIntent(value.intent)) throw new Error('AI output intent is invalid');
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) throw new Error('AI confidence must be 0..1');
  if (!isRisk(value.risk)) throw new Error('AI risk is invalid');
  if (typeof value.requires_human !== 'boolean') throw new Error('AI requires_human must be boolean');
  if (typeof value.answer !== 'string' || !value.answer.trim()) throw new Error('AI answer is required');
  if (value.knowledge_item_ids && (!Array.isArray(value.knowledge_item_ids) || value.knowledge_item_ids.some((x: any) => typeof x !== 'string'))) throw new Error('AI knowledge_item_ids invalid');
  return {
    intent: value.intent,
    confidence: value.confidence,
    risk: value.risk,
    requires_human: value.requires_human,
    answer: value.answer.trim(),
    next_action: typeof value.next_action === 'string' ? value.next_action : undefined,
    knowledge_item_ids: value.knowledge_item_ids ?? [],
    crm_updates: typeof value.crm_updates === 'object' && value.crm_updates !== null ? value.crm_updates : {}
  };
}
