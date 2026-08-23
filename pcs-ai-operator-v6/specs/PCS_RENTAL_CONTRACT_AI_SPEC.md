# PCS Rental Contract AI — source template and generation rules

## Purpose
Generate a filled rental agreement from structured booking, client and vehicle data, while preserving the operational fields of the current PCS Premium Concierge Service rental form.

## Source of truth
The physical PCS rental form supplied by operations on 2026-08-23 is the reference for field coverage and document structure. The AI must NOT invent missing client, vehicle, pricing, date, ID or payment values. Unknown values remain blank or are explicitly flagged for operator review.

## Fields visible on the current form

### Company / service header
- PCS Premium Concierge Service
- website / service contact / QR and communication channels are presentation metadata, not AI-inferred data

### Renter details
- Name
- ID / Passport
- Nationality
- License No.
- Phone
- Line
- Address

### Rental details
- Date rental
- Car model
- REG No.
- Color car
- Rent date + time
- Return date + time
- Total time
- Rate rental
- Transfer fee
- Deposit
- Total
- Booking deposit
- Balance
- Remark

### Vehicle / operating notes
- Fuel type / grade
- Fuel level at handover
- Helmet / other issued equipment when applicable
- Vehicle condition diagram / damage marks: manual evidence unless backed by explicit inspection/photo data

### Renewal section
- Date
- From–To date
- Total
- Total amount
- Other

### Signatures
- Renter / customer signature
- Staff / company signature
- Other signature field where required by the printed form
- AI must never fabricate a signature.

## Generation contract
Input must be structured JSON assembled from PCS CRM + reservation + catalog + pricing + operator-confirmed handover data.

Required before final document generation:
- renter.name
- renter.id_or_passport
- renter.phone or an explicit operator override
- vehicle.model
- vehicle.registration_no
- rental.start_at
- rental.end_at
- pricing.rate
- pricing.deposit
- pricing.total
- currency

Recommended:
- renter.nationality
- renter.license_no
- renter.address
- vehicle.color
- vehicle.fuel_type
- pricing.transfer_fee
- pricing.booking_deposit
- pricing.balance
- rental.remark

## Pricing rules
The document generator does not calculate an opaque number. It consumes the same transparent pricing result used by PCS booking:
base rate → seasonal adjustment → duration adjustment → extras / transfer → total → booking deposit / payments → balance.

Every stored/generated contract should retain a machine-readable pricing snapshot so the printed amount can be traced back to the booking calculation.

## Validation
1. start_at < end_at.
2. total >= 0; deposit >= 0; transfer_fee >= 0.
3. booking_deposit and recorded payments cannot silently exceed total; exception requires operator confirmation and reason.
4. balance = total - confirmed payments unless an explicit manual override with audit reason exists.
5. vehicle cannot have an overlapping confirmed/active reservation for the same interval.
6. Missing required fields block FINAL status but may allow DRAFT.
7. Never infer passport, driving licence, nationality, registration number, phone, signature, damage, fuel level, payment status or dates from unrelated context.
8. Values extracted from uploaded ID/licence images must be shown to the operator for confirmation before becoming contract data.

## AI workflow
1. Operator opens reservation.
2. System pre-fills known CRM, catalog, reservation and pricing data.
3. AI maps the structured values to contract fields and highlights missing/ambiguous data.
4. Operator confirms identity/licence fields, handover time, fuel level, condition/damage and payment facts.
5. System generates preview.
6. Operator approves FINAL.
7. Contract receives immutable version, booking ID, generation timestamp and pricing snapshot.
8. Signed scan/photo may be attached later as evidence; it does not overwrite the generated source data.

## States
DRAFT → NEEDS_REVIEW → READY_TO_SIGN → SIGNED → SUPERSEDED / CANCELLED.

## UX / IA
Primary location: Booking detail → Contract.
Actions:
- Generate contract
- Review missing fields
- Preview
- Confirm final version
- Attach signed copy
- Regenerate as a new version

Do not add a new top-level navigation section solely for contracts.

## Acceptance criteria
- Given a complete reservation, Generate contract produces a preview with the correct client, vehicle, dates and financial values.
- Given a missing required value, finalization is blocked and the exact field is identified.
- Given a pricing change, regeneration creates a new version and preserves the previous version/audit trail.
- Given an overlapping confirmed reservation, contract finalization is blocked until conflict resolution.
- Given an uploaded ID/licence, extracted values are suggestions requiring explicit operator confirmation.
- No AI-generated signature or invented personal/document data can appear in a final contract.
- Mobile operator can complete review with touch targets >=44px and form inputs >=16px.

## QA release gate
- Unit tests for mapping and financial validation.
- Tests for missing fields, date inversion, overlapping reservation, payment mismatch and versioning.
- Smoke test after deploy.
- Standard UI QA at 375px, 768px and 1440px.
- End-to-end: reservation → contract draft → operator review → final preview → signed-copy attachment → booking history/audit trail.

## Security / privacy
Passport/licence data is sensitive operational data. Do not put it in URLs, client-side logs, analytics events, public storage paths, prompts unrelated to contract generation, or unauthenticated API responses. Contract generation and retrieval require authenticated operator access and an audit trail.
