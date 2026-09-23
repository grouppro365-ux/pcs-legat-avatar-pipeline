// Channel-neutral persistence seam. Only the trusted server supplies a verified
// offer/quote; the database owns idempotency and overlapping-booking exclusion.
export async function findVehicleBooking(sql, key) {
  const rows=await sql`select id,public_id,item_id,operational_status as status,qualification_data
    from applications where category='booking' and qualification_data->>'booking_idempotency_key'=${key}`;
  return rows[0]||null;
}
export async function createVehicleBooking(sql, input) {
  const rows=await sql`select pcs.create_vehicle_booking(${input.key},${input.offerId},${input.itemId}::uuid,
    ${input.clientId},${input.name||null},${input.contact||null},${input.start}::date,${input.end}::date,
    ${input.total}::numeric,${input.currency}) as booking`;
  const booking=rows[0]?.booking;
  if(!booking?.id||!booking.public_id||!booking.status)throw Error('booking_receipt_missing');
  return booking;
}
