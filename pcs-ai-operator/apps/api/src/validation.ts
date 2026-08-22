const CONTACT_STATUSES = new Set(['NEW','QUALIFYING','QUALIFIED','OFFER_SENT','WAITING_CLIENT','IN_PROGRESS','BOOKED','PAID','COMPLETED','LOST','SPAM']);
const PRIORITIES = new Set(['LOW','NORMAL','HOT','URGENT']);
const MODES = new Set(['INHERIT','AUTO','APPROVAL','HUMAN','IGNORE']);
const KNOWLEDGE_STATUSES = new Set(['ACTIVE','DRAFT','OUTDATED','DISABLED']);
const TASK_PRIORITIES = new Set(['LOW','NORMAL','HIGH','URGENT']);

export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('JSON object body required'), { statusCode: 400 });
  return value as Record<string, unknown>;
}

export function cleanText(value: unknown, field: string, max = 4096, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw Object.assign(new Error(`${field} is required`), { statusCode: 400 });
    return undefined;
  }
  if (typeof value !== 'string') throw Object.assign(new Error(`${field} must be a string`), { statusCode: 400 });
  const clean = value.trim();
  if (required && !clean) throw Object.assign(new Error(`${field} is required`), { statusCode: 400 });
  if (clean.length > max) throw Object.assign(new Error(`${field} is too long`), { statusCode: 400 });
  return clean;
}

export function contactPatch(body: unknown) {
  const b = objectBody(body); const out: Record<string, unknown> = {};
  for (const key of ['username','name','phone','language','city','country','category','intent','summary','need','budget','deadline','nextAction'] as const) {
    const v = cleanText(b[key], key, key === 'summary' ? 10000 : 1000); if (v !== undefined) out[key] = v || null;
  }
  if (b.status !== undefined) { const v=String(b.status).toUpperCase(); if(!CONTACT_STATUSES.has(v)) throw Object.assign(new Error('invalid contact status'),{statusCode:400}); out.status=v; }
  if (b.priority !== undefined) { const v=String(b.priority).toUpperCase(); if(!PRIORITIES.has(v)) throw Object.assign(new Error('invalid priority'),{statusCode:400}); out.priority=v; }
  if (b.nextActionAt !== undefined) { const d=b.nextActionAt ? new Date(String(b.nextActionAt)) : null; if(d && Number.isNaN(d.getTime())) throw Object.assign(new Error('invalid nextActionAt'),{statusCode:400}); out.nextActionAt=d; }
  return out;
}

export function conversationPatch(body: unknown) {
  const b=objectBody(body); const out:Record<string,unknown>={};
  if(b.mode!==undefined){const v=String(b.mode).toUpperCase();if(!MODES.has(v))throw Object.assign(new Error('invalid conversation mode'),{statusCode:400});out.mode=v;}
  if(b.summary!==undefined)out.summary=cleanText(b.summary,'summary',10000)||null;
  if(b.unreadCount!==undefined){const n=Number(b.unreadCount);if(!Number.isInteger(n)||n<0)throw Object.assign(new Error('invalid unreadCount'),{statusCode:400});out.unreadCount=n;}
  return out;
}

export function knowledgeInput(body: unknown, partial=false) {
  const b=objectBody(body); const out:Record<string,unknown>={};
  for(const key of ['title','category','description'] as const){const v=cleanText(b[key],key,key==='description'?20000:500,!partial);if(v!==undefined)out[key]=v;}
  for(const key of ['country','city','currency','conditions','restrictions','source','operatorComment'] as const){const v=cleanText(b[key],key,key==='conditions'||key==='restrictions'||key==='operatorComment'?10000:1000);if(v!==undefined)out[key]=v||null;}
  if(b.price!==undefined){if(b.price===null||b.price==='')out.price=null;else{const n=Number(b.price);if(!Number.isFinite(n)||n<0)throw Object.assign(new Error('invalid price'),{statusCode:400});out.price=n;}}
  if(b.validAt!==undefined){const d=b.validAt?new Date(String(b.validAt)):null;if(d&&Number.isNaN(d.getTime()))throw Object.assign(new Error('invalid validAt'),{statusCode:400});out.validAt=d;}
  if(b.status!==undefined){const v=String(b.status).toUpperCase();if(!KNOWLEDGE_STATUSES.has(v))throw Object.assign(new Error('invalid knowledge status'),{statusCode:400});out.status=v;}
  if(b.autoAnswerAllowed!==undefined)out.autoAnswerAllowed=Boolean(b.autoAnswerAllowed);
  return out;
}

export function automationInput(body: unknown) {
  const b=objectBody(body); const out:Record<string,unknown>={};
  if(b.enabled!==undefined)out.enabled=Boolean(b.enabled);
  if(b.autoSend!==undefined)out.autoSend=Boolean(b.autoSend);
  if(b.minimumConfidence!==undefined){const n=Number(b.minimumConfidence);if(!Number.isFinite(n)||n<0||n>1)throw Object.assign(new Error('minimumConfidence must be 0..1'),{statusCode:400});out.minimumConfidence=n;}
  for(const key of ['workStart','workEnd'] as const){if(b[key]!==undefined){const v=cleanText(b[key],key,5);if(v&&!/^\d{2}:\d{2}$/.test(v))throw Object.assign(new Error(`invalid ${key}`),{statusCode:400});out[key]=v||null;}}
  for(const key of ['allowedCategories','blockedCategories'] as const){if(b[key]!==undefined){if(!Array.isArray(b[key])||!(b[key] as unknown[]).every(x=>typeof x==='string'))throw Object.assign(new Error(`invalid ${key}`),{statusCode:400});out[key]=(b[key] as string[]).slice(0,100);}}
  return out;
}

export function taskInput(body: unknown, partial=false) {
  const b=objectBody(body); const out:Record<string,unknown>={};
  if(!partial){out.contactId=cleanText(b.contactId,'contactId',100,true);out.title=cleanText(b.title,'title',500,true);}
  else if(b.title!==undefined)out.title=cleanText(b.title,'title',500,true);
  if(b.conversationId!==undefined)out.conversationId=cleanText(b.conversationId,'conversationId',100)||null;
  if(b.comment!==undefined)out.comment=cleanText(b.comment,'comment',10000)||null;
  if(b.priority!==undefined){const v=String(b.priority).toUpperCase();if(!TASK_PRIORITIES.has(v))throw Object.assign(new Error('invalid task priority'),{statusCode:400});out.priority=v;}
  for(const key of ['dueAt','completedAt'] as const){if(b[key]!==undefined){const d=b[key]?new Date(String(b[key])):null;if(d&&Number.isNaN(d.getTime()))throw Object.assign(new Error(`invalid ${key}`),{statusCode:400});out[key]=d;}}
  return out;
}
