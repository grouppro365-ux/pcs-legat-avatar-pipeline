# PCS: local Instagram intake pilot

Status: local read-only pilot with an optional signed, draft-only Hub bridge, **not a connected production auto-reply channel**.
This is an adapter inside the existing PCS repository, not a replacement CRM.

## What this slice does

- Pins instagrapi 3.0.14 and its resolved dependencies in a separate Windows/Python 3.12 environment.
- Opens a local sign-in window; password and optional 2FA code are entered there, never in chat, command-line arguments or repository files.
- Stores session and new inbound events together, encrypted with Windows DPAPI for the current OS user, outside the repository: `%LOCALAPPDATA%\PCS\instagram-local\account.dpapi`.
- Begins the cutoff after the first successful login. Historical messages before that cutoff are not queued. A login on an existing session preserves the original cutoff and queued events.
- Reads primary/general inbox and pending requests only on explicit button press; does not approve requests or mark messages read.
- Ignores own messages, group chats and disappearing-message threads. Non-text messages are retained as manual-review placeholders; media is not downloaded or recognized.
- Uses the existing Conversation Hub message shape; namespaces local Instagram IDs to avoid collisions with BotHelp or Meta Graph IDs. A test compares output to the actual JS `hubMessage` contract.
- The login window queues messages locally, deduplicated by stable account/message identity. It makes no AI calls, server uploads or outgoing replies.
- Rejects Direct mutations in the SDK request path and stops on security challenges. No CAPTCHA bypass, proxy rotation or automated challenge handling.

## Run

The runtime for this workstation is `%LOCALAPPDATA%\PCS\instagram-venv`.
Open `Start-Instagram.ps1` with PowerShell. It only launches the login window; it does not log in automatically.
Do not enable execution-policy bypass or weaken Windows settings to launch it. If the script is blocked, launch the installed `pythonw.exe` with `login_window.py` directly.

Reprovisioning on another authorized Windows workstation:

1. Create an isolated Python 3.12 venv at the runtime path above.
2. Install `requirements.lock.txt` using that venv's pip.
3. Run `python login_window.py --self-check` and the test command below before login.

Tests, from the repository root:

```text
<venv-python> -m unittest discover -s server/instagram-local -p "test_*.py"
<venv-python> server/instagram-local/login_window.py --self-check
```

Closing the window stops its interactive reader. No background Instagram daemon, scheduled task or auto-start is installed.
The encrypted state cannot be migrated to another Windows user by copying its file.
Never put its decrypted contents, session cookies or login password into Git, logs, a support chat or browser storage.

## Optional Hub transfer (provision only after live account verification)

`bridge.py --send-pending` explicitly forwards up to 10 queued events to the pinned existing PCS Supabase URL.
It requires a separate DPAPI-encrypted `bridge.dpapi` containing `account_id` and a random `hmac_secret` of at least 32 characters.
The server Vault secret `channel_instagram_local_bridge` must contain the matching JSON plus `enabled: true`.
Do not use a Supabase service-role key, Instagram password/session or BotHelp secret for this bridge. No credentials are accepted as command-line arguments.

The existing webhook `?channel=instagram&source=instagrapi` validates HMAC-SHA256 over the exact UTF-8 body and a timestamp (five-minute window), then validates the bound account and message shape.
It reuses the existing Hub processor with a server-enforced draft-only policy, regardless of channel/global auto-send settings.
The remote channel sender rejects local Instagram identities rather than sending them through Meta or BotHelp.

Acknowledgements are saved separately in `delivery.dpapi` only after the server persists a draft and completed event.
The GUI may keep reading its queue while this separate receipt writer runs; `delivery.lock` prevents concurrent senders.
No redirects are followed. Errors or malformed receipts leave the local event unacknowledged.
A replay of a completed identical event returns its original receipt. In-progress events return 409;
failed events with an identical digest are conditionally reclaimed for a single retry. The Hub
recovers an existing draft if the receipt was interrupted after persistence. Changed contents
under the same message ID remain a conflict.

The account-bound bridge was tested with four real inbound events. All four were acknowledged
only after draft persistence; no Instagram reply was sent. The test exposed and fixed a missing
non-partial unique index required by the Hub message upsert. This is still not unattended
production auto-reply: collection and transfer are manually invoked.

## Limits and remaining work

- Unofficial API: account restrictions, login challenges and upstream changes remain possible. See [instagrapi upstream](https://github.com/subzeroid/instagrapi). This avoids Meta **Developers setup**, not Instagram/Meta infrastructure or rules.
- A scan is bounded to 25 pages per inbox and stops at the login cutoff. A recent thread requiring more than 100 messages fails closed instead of silently truncating. Queue limit: 5,000 events. This is a controlled pilot, not an unattended full-inbox crawler.
- Windows must be running for a future local worker; Python object memory is not guaranteed securely erased. Session-at-rest encryption does not protect a compromised logged-in workstation.
- Live login, inbound retrieval, server ingest and draft persistence were exercised. Approved outgoing Instagram replies, continuous polling and end-to-end booking remain **unverified**.
- Do not feed these namespaced IDs to the current Meta/BotHelp sender. A future local outgoing queue must verify destination, require approval during the pilot, retain deduplication and stop on uncertain send results.
- Telegram, pricing, commissions, website and live channel configuration are unchanged. The existing Hub receiver gains the signed local route; the existing remote sender gains a guard rejecting local identities. No new Supabase function or table is required.


## Outgoing delivery primitive (integration not activated)

`bridge.deliver_approved_reply` now accepts one PCS-signed, explicitly approved reply job. The job is bound to the account, generation, one-to-one thread and recipient and expires within five minutes. Its signature uses a separate `pcs-instagram-outbound-v1` domain. Set `outgoing_enabled` explicitly in the private configuration only after controlled end-to-end verification; the absent/default value prevents all outgoing writes.

The caller MUST hold the existing `delivery.lock` for the whole operation and use a separate DPAPI-encrypted receipt store (for example `outbound.dpapi`). A durable `sending` reservation is written before the Instagram request. Only a real provider message ID produces `sent`. Timeouts, missing acknowledgements and failure to save the final receipt leave the reservation non-retryable for manual reconciliation. Retrying an identical confirmed job returns its stored receipt without sending another message. Changing an already-used generation's body is rejected.

This primitive does not enable automatic replies. The existing `--send-pending` command remains incoming/draft-only. The cloud claim/approval queue, signed job issuance, receipt acknowledgement into PCS and the permanent worker are still to be connected; no production end-to-end completion is claimed. Do not run multiple workers, recreate the receipt ledger, or mark a PCS generation sent before its Instagram acknowledgement. Session/password material must never be included in a job, source code, logs or an export.

Focused tests: `python -B -m unittest test_outgoing test_intake test_bridge -v` (the bridge receiver compatibility test also requires the repository's existing Node runtime).
