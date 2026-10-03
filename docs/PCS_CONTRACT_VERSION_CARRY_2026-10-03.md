# Contract version field carryover — deployed with rental lifecycle update

The generate handler reads the latest existing contract before rebuilding its
snapshot. A server-created generation context identifies the client and vehicle.
Only missing editable fields are carried into the new draft, and only when the
identity matches. Explicit input, including cleared fields, takes precedence.

Client documents require matching name and contact; an existing contact ID must
also match. Vehicle fields require matching catalog item IDs. Legacy contracts
without context require matching registration numbers for vehicle fields.
Ambiguous identity results in no automatic carryover. Rental endpoint times are
retained only for matching dates; notes and condition fields require the same
client, vehicle and date range.

Booking dates and financial values remain freshly calculated. Signing metadata,
handover attestations and uploaded signed copies are not inherited. The original
signed version and its audit trail remain intact under the existing deletion
policy. No logo or frontend assets changed.

Local verification: 27 contract/version/document/download tests passed; source
checks and TypeScript syntax passed. Original logo SHA-256 remains
`1c11d5379f76a45e54f34110c206ef3c649d9286f9bd9ea61d4cd1345d68ff56`.

Deployment requires all three API files: index.ts, confirmation-policy.mjs and
version-policy.mjs. Preserve existing custom authentication and verify_jwt=false.
The carryover helper itself requires no schema changes. It is deployed together
with the return and rental-phase feature described in
PCS_RENTAL_LIFECYCLE_2026-10-03.md. Earlier access-limit blocking is resolved.
