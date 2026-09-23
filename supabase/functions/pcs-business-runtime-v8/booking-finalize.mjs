export function validateBookingFinalization(request, finance, item) {
  if (!request || request.status !== 'ready_for_booking' ||
      request.passport_status !== 'approved' || request.international_permit_status !== 'approved' ||
      request.payment_status !== 'paid' || !request.finance_entry_id ||
      !Number.isFinite(Number(request.booking_deposit_amount)) || Number(request.booking_deposit_amount) <= 0) {
    throw new Error('booking_request_not_verified');
  }
  if (!finance || finance.id !== request.finance_entry_id ||
      finance.contact_id !== request.contact_id || finance.status !== 'paid' ||
      !finance.paid_at || finance.payment_kind !== 'booking_deposit' ||
      finance.metadata?.booking_request_id !== request.id ||
      Number(finance.amount) !== Number(request.booking_deposit_amount) ||
      finance.currency !== request.currency) {
    throw new Error('booking_payment_evidence_invalid');
  }
  if (!item || item.id !== request.catalog_item_id || item.ownership_type !== 'pcs_owned') {
    throw new Error('booking_vehicle_not_owned');
  }
}

export function operationalBookingProjection(status) {
  const state = String(status || '').toUpperCase();
  const statuses = {
    NEW: 'requested', AWAITING_PARTNER_CONFIRMATION: 'hold',
    CONFIRMED: 'confirmed', SERVICE_IN_PROGRESS: 'active', COMPLETED: 'completed',
  };
  if (!Object.hasOwn(statuses, state)) throw new Error('booking_operational_status_requires_review');
  return {
    operationalStatus: state,
    reservationStatus: statuses[state],
    requestStatus: ['CONFIRMED', 'SERVICE_IN_PROGRESS', 'COMPLETED'].includes(state) ? 'booked' : 'ready_for_booking',
  };
}
