import type { AutomationRule } from '@prisma/client';
import { config } from './runtime.js';

function jsonStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function minuteOfDay(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function localMinute(timeZone: string, date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function autoEligibility(rule: AutomationRule | null, intent: string, date = new Date()): { allowed: boolean; reason?: string } {
  if (!rule?.enabled) return { allowed: false, reason: 'AI automation disabled' };
  const blocked = jsonStrings(rule.blockedCategories);
  if (blocked.includes(intent)) return { allowed: false, reason: 'intent is blocked from auto-send' };
  const allowed = jsonStrings(rule.allowedCategories);
  if (allowed.length && !allowed.includes(intent)) return { allowed: false, reason: 'intent is not in auto-send allowlist' };
  if (rule.workStart && rule.workEnd) {
    const start = minuteOfDay(rule.workStart);
    const end = minuteOfDay(rule.workEnd);
    if (start !== null && end !== null) {
      const now = localMinute(config.defaultTimezone, date);
      const inside = start <= end ? now >= start && now <= end : now >= start || now <= end;
      if (!inside) return { allowed: false, reason: 'outside configured working hours' };
    }
  }
  return { allowed: true };
}
