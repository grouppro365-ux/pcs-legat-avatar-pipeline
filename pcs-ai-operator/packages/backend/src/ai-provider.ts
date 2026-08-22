import { parseAiCandidate, classifyIntent } from '@pcs/core';
import { config } from './runtime.js';

type Context = { inboundText: string; language?: string | null; summary?: string | null; facts?: unknown; recentMessages: Array<{direction:string;text:string|null}>; knowledge: Array<any> };

function prompt(ctx: Context) {
  const detected = classifyIntent(ctx.inboundText);
  const kb = ctx.knowledge.map(k => ({ id:k.id, title:k.title, category:k.category, description:k.description, price:k.price?.toString?.() ?? k.price, currency:k.currency, conditions:k.conditions, restrictions:k.restrictions, autoAnswerAllowed:k.autoAnswerAllowed }));
  return [
    { role: 'system', content: `You are PCS AI Operator for Premium Concierge Service Thailand. Reply naturally, briefly and in the client's language. Move the conversation to one concrete next action. Never invent price, availability, timing, discounts, commissions, legal/visa requirements or guarantees. Use only supplied active knowledge for such facts. If missing, ask one useful clarifying question or set requires_human=true. Complaints, partnerships, contracts, unusual legal/visa or financial commitments require human review. Return JSON only with keys: intent, confidence, risk, requires_human, answer, next_action, crm_updates, knowledge_item_ids. intent must be one of the PCS intents. knowledge_item_ids must contain exact IDs used for factual/financial claims.` },
    { role: 'user', content: JSON.stringify({ suggested_intent: detected, inbound: ctx.inboundText, summary: ctx.summary, facts: ctx.facts, recent_messages: ctx.recentMessages, active_knowledge: kb }) }
  ];
}

async function call(model: string, ctx: Context) {
  const r = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
    method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${config.openrouterApiKey}`, 'HTTP-Referer':config.appUrl, 'X-Title':'PCS AI Operator' },
    body: JSON.stringify({ model, temperature: 0.2, messages: prompt(ctx), response_format: { type:'json_object' } })
  });
  if (!r.ok) throw new Error(`OpenRouter ${model} failed: ${r.status} ${(await r.text()).slice(0,300)}`);
  const payload = await r.json() as any;
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error(`OpenRouter ${model} returned no text content`);
  return parseAiCandidate(content);
}

export async function generateAi(ctx: Context) {
  try { return { provider:'openrouter', model:config.aiModel, candidate: await call(config.aiModel, ctx) }; }
  catch (primaryError) {
    try { return { provider:'openrouter', model:config.aiFallbackModel, candidate: await call(config.aiFallbackModel, ctx) }; }
    catch (fallbackError) { throw new AggregateError([primaryError, fallbackError], 'Primary and fallback AI models failed'); }
  }
}
