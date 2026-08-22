import { db } from './runtime.js';

export async function getRelevantKnowledge(intent: string, text: string) {
  const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length > 3).slice(0, 8);
  const items = await db.knowledgeItem.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { category: intent },
        ...tokens.map(token => ({ description: { contains: token, mode: 'insensitive' as const } })),
        ...tokens.map(token => ({ title: { contains: token, mode: 'insensitive' as const } }))
      ]
    }, orderBy: { updatedAt: 'desc' }, take: 12
  });
  return items;
}
