# PCS: confirmation of existing paper signature and vehicle handover

Status: activation explicitly authorized by the user on 3 October 2026. The migration is applied; existing pcs-contract-api v12 and pcs-contract-files v9 are active. No real customer contract was marked signed or handed over during development or validation.

The existing authenticated PCS contract flow gains two independent actions: «Подписан ранее» and «Машина уже выдана». Each requires a past date/time, manager name, explanation and explicit checkbox. The manager name is self-declared because PCS currently uses a shared administrator login. The server also records a non-reversible session fingerprint; it never persists the bearer credential in the audit event.

For a signature, the operator attests that the previously signed paper has the same terms as the current finalized version. The server marks that version signed and preserves the actual signing time. No signature image is generated and no vehicle handover is inferred. The handover action records a separate fact without modifying signature status or booking operational status.

The transactional RPC locks the contract, verifies current/finalized/nonempty-field constraints, rejects repeated confirmations, updates existing handover_data and writes an existing pcs_contract_events audit entry in one transaction. SECURITY INVOKER; EXECUTE revoked from PUBLIC/anon/authenticated and granted only to service_role. The Edge endpoint verifies the existing administrator session and a confirmed/in-progress/completed booking. Ordinary draft edits cannot forge reserved attestation metadata.

A signed scan may be added afterwards. Existing signed copies cannot be overwritten. The historical signing date remains unchanged when the scan is attached. A manually confirmed fact remains visibly identified as a manager confirmation.

Independent UI fix: finalized/signed/closed contract fields are visibly read-only; the ineffective Save button is replaced with Back to contract. Document upload remains outside the disabled fieldset.

Validation: policy/UI/files tests pass with synthetic fixtures; actual file endpoint handler is executed with mocked private storage/DB. Browser QA covers the real modules and full stylesheet stack at 390 px, explicit form submission on synthetic data, independent handover form and locked fieldsets. Server TypeScript parses. Production SQL transaction was verified using an isolated synthetic contract in a BEGIN/ROLLBACK transaction: explicit attestation required, future dates rejected, handover leaves signature unchanged, signature preserves its actual date, both audit events recorded, duplicates rejected. Permissions verified: SECURITY INVOKER, anon/authenticated denied, service_role allowed. Zero persisted test contracts after rollback. Actual authenticated Telegram end-to-end confirmation remains untested. The full Client/Provider/CRM/Content master specification remains unfinished.

Deployment: server/sql/pcs_contract_attestation.sql applied and verified; pcs-contract-api deployed with confirmation-policy.mjs; pcs-contract-files deployed with its existing document-policy.mjs. Frontend activation is included in PR #12. Do not test attestation on a real client contract by inference.
