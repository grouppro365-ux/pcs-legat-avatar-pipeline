# PCS: confirmation of existing paper signature and vehicle handover

Status: prepared for review; production activation blocked by automatic permission review. No real contract was signed or marked handed over during development. The migration was rejected and a read query confirms the RPC is absent.

The existing authenticated PCS contract flow gains two independent actions: «Подписан ранее» and «Машина уже выдана». Each requires a past date/time, manager name, explanation and explicit checkbox. The manager name is self-declared because PCS currently uses a shared administrator login. The server also records a non-reversible session fingerprint; it never persists the bearer credential in the audit event.

For a signature, the operator attests that the previously signed paper has the same terms as the current finalized version. The server marks that version signed and preserves the actual signing time. No signature image is generated and no vehicle handover is inferred. The handover action records a separate fact without modifying signature status or booking operational status.

The transactional RPC locks the contract, verifies current/finalized/nonempty-field constraints, rejects repeated confirmations, updates existing handover_data and writes an existing pcs_contract_events audit entry in one transaction. SECURITY INVOKER; EXECUTE revoked from PUBLIC/anon/authenticated and granted only to service_role. The Edge endpoint verifies the existing administrator session and a confirmed/in-progress/completed booking. Ordinary draft edits cannot forge reserved attestation metadata.

A signed scan may be added afterwards. Existing signed copies cannot be overwritten. The historical signing date remains unchanged when the scan is attached. A manually confirmed fact remains visibly identified as a manager confirmation.

Independent UI fix: finalized/signed/closed contract fields are visibly read-only; the ineffective Save button is replaced with Back to contract. Document upload remains outside the disabled fieldset.

Validation: policy/UI/files tests pass with synthetic fixtures; actual file endpoint handler is executed with mocked private storage/DB. Browser QA covers the real modules and full stylesheet stack at 390 px, explicit form submission on synthetic data, independent handover form and locked fieldsets. Server TypeScript parses. Production SQL transaction and real contract end-to-end confirmation remain untested until activation is authorized. The full Client/Provider/CRM/Content master specification remains unfinished.

Deployment after approval: apply server/sql/pcs_contract_attestation.sql, verify RPC access/transaction in a rollback-only fixture, deploy the current existing pcs-contract-api including confirmation-policy.mjs, deploy pcs-contract-files including its unchanged document-policy.mjs, then merge this frontend branch. Do not test attestation on a real client contract by inference.
