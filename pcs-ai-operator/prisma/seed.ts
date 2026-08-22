import { PrismaClient, KnowledgeStatus } from '@prisma/client';
import argon2 from 'argon2';

const db = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await db.user.upsert({ where: { email }, update: { passwordHash }, create: { email, passwordHash } });
  }
  await db.automationRule.upsert({
    where: { scope: 'global' },
    update: {},
    create: { scope: 'global', enabled: true, autoSend: false, minimumConfidence: 0.90 }
  });

  const facts = [
    {
      title: 'Car rental — driver requirements', category: 'car_rent',
      description: 'For PCS vehicle rental, driver requirements include an international driving permit and passport; minimum driver age is 21 years.',
      conditions: 'International driving permit + passport; age 21+.', restrictions: 'Subject to vehicle-specific availability and contract terms.',
      source: 'PCS owner-supplied operating rules', status: KnowledgeStatus.ACTIVE, autoAnswerAllowed: true
    },
    {
      title: 'Car rental — mileage limit', category: 'car_rent',
      description: 'Standard PCS vehicle rental mileage rule: up to 5,000 km per month or 100 km per day, depending on the rental format.',
      conditions: '5,000 km/month or 100 km/day.', source: 'PCS owner-supplied operating rules', status: KnowledgeStatus.ACTIVE, autoAnswerAllowed: true
    },
    {
      title: 'Car rental — deposit range', category: 'car_rent',
      description: 'Typical PCS rental deposit range is 5,000–15,000 THB depending on the vehicle and terms.',
      price: 5000, currency: 'THB', conditions: 'Deposit varies by vehicle; upper bound in current rules is 15,000 THB.',
      source: 'PCS owner-supplied operating rules', status: KnowledgeStatus.ACTIVE, autoAnswerAllowed: true
    },
    {
      title: 'Car delivery — Pattaya', category: 'car_rent', city: 'Pattaya', country: 'Thailand',
      description: 'Vehicle delivery in Pattaya starts from 500 THB.', price: 500, currency: 'THB',
      conditions: 'From 500 THB; exact delivery quote depends on location and current operating conditions.',
      source: 'PCS owner-supplied operating rules', status: KnowledgeStatus.ACTIVE, autoAnswerAllowed: true
    },
    {
      title: 'Car delivery — Bangkok', category: 'car_rent', city: 'Bangkok', country: 'Thailand',
      description: 'Vehicle delivery to Bangkok starts from 2,000 THB.', price: 2000, currency: 'THB',
      conditions: 'From 2,000 THB; exact delivery quote depends on location and current operating conditions.',
      source: 'PCS owner-supplied operating rules', status: KnowledgeStatus.ACTIVE, autoAnswerAllowed: true
    }
  ];
  for (const fact of facts) {
    const exists = await db.knowledgeItem.findFirst({ where: { title: fact.title } });
    if (!exists) await db.knowledgeItem.create({ data: fact as any });
  }
}

main().finally(() => db.$disconnect());
