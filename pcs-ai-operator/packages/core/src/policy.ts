import type { Intent } from './intents.js';

export type Risk = 'low' | 'medium' | 'high';
export type Decision = 'auto' | 'approval' | 'human';

export interface AiCandidate {
  intent: Intent;
  confidence: number;
  risk: Risk;
  requires_human: boolean;
  answer: string;
  next_action?: string;
  knowledge_item_ids?: string[];
}

export interface PolicyInput {
  candidate: AiCandidate;
  globalAutoSend: boolean;
  chatMode?: 'inherit' | 'auto' | 'approval' | 'human' | 'ignore';
  minimumConfidence: number;
}

const HUMAN_INTENTS = new Set<Intent>(['complaint', 'legal', 'partnership']);
const FINANCIAL = /(?:\bTHB\b|\bUSD\b|\bRUB\b|฿|\$|₽|\b\d[\d ,.]*\s*(?:бат|baht|thb|usd|rub)\b)/i;

export function decidePolicy(input: PolicyInput): { decision: Decision; reason: string } {
  const { candidate, chatMode = 'inherit' } = input;
  if (chatMode === 'ignore') return { decision: 'human', reason: 'chat ignored by automation' };
  if (chatMode === 'human') return { decision: 'human', reason: 'chat forced to human' };
  if (candidate.requires_human || candidate.risk === 'high' || HUMAN_INTENTS.has(candidate.intent)) {
    return { decision: 'human', reason: 'risk/intent requires human' };
  }
  if (candidate.confidence < input.minimumConfidence) return { decision: 'approval', reason: 'confidence below threshold' };
  if (FINANCIAL.test(candidate.answer) && !(candidate.knowledge_item_ids?.length)) {
    return { decision: 'human', reason: 'financial claim has no active knowledge source' };
  }
  if (chatMode === 'approval') return { decision: 'approval', reason: 'chat forced to approval' };
  if (chatMode === 'auto') return { decision: 'auto', reason: 'chat auto override' };
  if (!input.globalAutoSend) return { decision: 'approval', reason: 'global auto-send disabled' };
  return { decision: 'auto', reason: 'safe auto-send policy passed' };
}
