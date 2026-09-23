// Shared operational availability policy. Mini App bookings live in Neon
// applications, not in the legacy Supabase pcs_reservations table.
const BLOCKING_BOOKINGS = new Set(['AWAITING_PARTNER_CONFIRMATION', 'CONFIRMED', 'SERVICE_IN_PROGRESS']);
const NONBLOCKING_BOOKINGS = new Set(['NEW','TRIAGE','NEEDS_CLIENT_INFO','MATCHING','PARTNER_ALTERNATIVE_PROPOSED','QUOTE_READY','QUOTE_SENT','AWAITING_CLIENT_DECISION','COMPLETED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER','REJECTED','EXPIRED','FAILED']);

function day(value) {
  const s = (value instanceof Date ? (Number.isFinite(value.getTime()) ? value.toISOString() : '') : String(value || '')).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const n = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(n) && new Date(n).toISOString().slice(0,10) === s ? n : null;
}

function overlaps(start, end, rowStart, rowEnd) {
  const a = day(rowStart), b = day(rowEnd);
  // Corrupt/missing reservation dates must not make inventory look free.
  if (a === null || b === null || b < a) return true;
  return a < end && Math.max(b, a + 86_400_000) > start;
}

export function operationallyFree(startDate, endDate, bookings, periods, now = Date.now()) {
  const start = day(startDate), end = day(endDate);
  if (start === null || end === null || end <= start || !Array.isArray(bookings) || !Array.isArray(periods)) return false;
  for (const row of bookings) {
    const status = String(row.operational_status || '').toUpperCase();
    if (NONBLOCKING_BOOKINGS.has(status)) continue;
    if (!BLOCKING_BOOKINGS.has(status)) return false;
    if (overlaps(start,end,row.start_date,row.end_date)) return false;
  }
  for (const row of periods) {
    const status = String(row.status || '').toUpperCase();
    if (status === 'AVAILABLE') continue;
    if (status === 'HOLD' && row.hold_until && Number.isFinite(Date.parse(row.hold_until)) && Date.parse(row.hold_until) <= now) continue;
    if (overlaps(start,end,row.starts_at,row.ends_at)) return false;
  }
  return true;
}

export async function readOperationalAvailability(sql, itemId, start, end) {
  // Tagged parameters only. Fetch one item's records; never load contact details.
  const [bookings, periods] = await Promise.all([
    sql`select operational_status, qualification_data->>'start_date' as start_date,
      qualification_data->>'end_date' as end_date from applications
      where item_id=${itemId} and category='booking'`,
    sql`select status,starts_at,ends_at,hold_until from availability_periods where item_id=${itemId}`,
  ]);
  return operationallyFree(start,end,bookings,periods);
}
