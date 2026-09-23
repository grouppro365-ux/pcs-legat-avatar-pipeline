// Legacy reservation controls may not alter operational bookings or their
// verified payment evidence. Those transitions belong to the booking flow.
export function requiresVerifiedBookingFlow(action, reservation, finance) {
  if (['bconfirm', 'bcancel', 'bpaid'].includes(action)) {
    return reservation?.source === 'neon_contract_projection';
  }
  if (['rpay', 'rreject'].includes(action)) {
    return finance?.payment_kind === 'booking_deposit' ||
      Boolean(finance?.metadata?.booking_request_id) ||
      reservation?.source === 'neon_contract_projection';
  }
  return false;
}
