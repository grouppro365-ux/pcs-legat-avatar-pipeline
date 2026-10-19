# Visa and transfer qualification release

This extends the existing `operator_qualification` application data and command/audit mechanism. It creates no new business entity. It does not send messages, determine visa eligibility, change prices, reserve stock or change a confirmed deal.

## Prepared changes

- Visa: nationality, current status/location, target visa, timeline, number of applicants and circumstances supplied by the client.
- Transfer: route, Thailand date/time, passengers, luggage, child seats and flight, with date/time validation.
- Questions and allowed fields are service-specific. Switching directions preserves unsaved per-direction drafts and submits only the selected schema.
- Backend/SQL field allowlists agree; staff permissions, optimistic concurrency, command fingerprints, existing immutable conditions and audit are preserved.

## Validation

The full 922-test working-tree suite passes. Real SQL rollback QA ran successfully on existing Neon branch `br-nameless-cell-avf7ur5s` of `icy-queen-80594347`. It covers both new service schemas, invalid dates/times, cross-service field injection, unchanged booking/payment facts, existing permissions/CAS/replay and revoked-access cases. The wrapper rolls back all fixture and function changes.

## Production sequence requiring approval

1. Install the reviewed canonical SQL in `server/sql/pcs_request_qualification.sql` transactionally on the existing main business database. The existing function/table are reused, including PUBLIC revocation.
2. Verify function definition, allowed schemas and PUBLIC EXECUTE=false by read-only queries.
3. Deploy only the changed `request-qualification.mjs` into the existing `pcs-manager-live2` bundle after comparing its current version with the reviewed baseline; preserve all other remote files and current JWT setting.
4. Verify deployed source and current status. Merge this PR after the UI-stability PR; normal frontend deployment then exposes the updated date/time controls.
5. Check the authenticated operator flow without production fixture clients or external sends.

Automatic approval review rejected both the primary database change and merging the separate UI PR #93 as requiring explicit release approval. Neither operation succeeded. This PR is prepared for review; its new qualification types are not active in production.

Rollback uses the prior Git version of the single SQL function and module. Existing answers remain stored; no data deletion is required. If concurrent remote code has changed, compare and integrate it before deployment rather than overwriting it.
