// Shared operational availability policy. Mini App bookings live in Neon
// applications, not in the legacy Supabase pcs_reservations table.
const BLOCKING_BOOKINGS = new Set(['AWAITING_PARTNER_CONFIRMATION', 'CONFIRMED', 'SERVICE_IN_PROGRESS']);
const NONBLOCKING_BOOKINGS = new Set(['NEW','TRIAGE','NEEDS_CLIENT_INFO','MATCHING','PARTNER_ALTERNATIVE_PROPOSED','QUOTE_READY','QUOTE_SENT','AWAITING_CLIENT_DECISION','COMPLETED','CANCELLED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER','REJECTED','EXPIRED','FAILED']);

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
  if (start === null || end === null || end <= start || !Array.isArray(bookings) || !Array.isArray(periods) || !Number.isFinite(now) || bookings.length>200 || periods.length>200) return false;
  for (const row of bookings) {
    const status = String(row.operational_status || '').toUpperCase();
    if (NONBLOCKING_BOOKINGS.has(status)) continue;
    if (!BLOCKING_BOOKINGS.has(status)) return false;
    if (overlaps(start,end,row.start_date,row.end_date)) return false;
  }
  const from=Date.parse(new Date(start).toISOString().slice(0,10)+'T00:00:00+07:00'),to=Date.parse(new Date(end).toISOString().slice(0,10)+'T00:00:00+07:00');
  for (const row of periods) {
    const a=row.starts_at instanceof Date?row.starts_at.getTime():Date.parse(row.starts_at),b=row.ends_at instanceof Date?row.ends_at.getTime():Date.parse(row.ends_at);
    if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return false;
    if(a>=to||b<=from)continue;
    const status = String(row.status || '').toUpperCase();
    if (status === 'AVAILABLE' && (row.quantity==null || row.quantity===1)) continue;
    if (['HOLD','HELD'].includes(status) && row.hold_until && Number.isFinite(Date.parse(row.hold_until)) && Date.parse(row.hold_until) <= now) continue;
    return false;
  }
  return true;
}

export async function readOperationalAvailability(sql, itemId, start, end) {
  // Tagged parameters only. Fetch one item's records; never load contact details.
  const [bookings, periods] = await Promise.all([
    sql`select operational_status, qualification_data->>'start_date' as start_date,
      qualification_data->>'end_date' as end_date from applications
      where item_id=${itemId} and category='booking' order by created_at,id limit 201`,
    sql`select status,starts_at,ends_at,hold_until,quantity from availability_periods where item_id=${itemId} order by starts_at,id limit 201`,
  ]);
  return operationallyFree(start,end,bookings,periods);
}
