"""Explicit transfer of queued Instagram events to the existing PCS Hub, draft-only."""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import time

from intake import EncryptedStore, identifier

HUB_URL = "https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-meta-webhook-v1?channel=instagram&source=instagrapi"
FIELDS = {"channel", "account", "conversation_id", "external_user_id", "message_id", "timestamp",
          "language", "text", "attachments", "reply_to", "kind", "name", "raw"}


class BridgeError(Exception):
    pass


def signed_event(event, config, now=None):
    account = identifier(config.get("account_id"))
    key = config.get("hmac_secret")
    if not isinstance(key, str) or len(key) < 32:
        raise BridgeError("bridge_not_configured")
    if event.get("account") != f"instagrapi:{account}" or event.get("channel") != "instagram":
        raise BridgeError("account_mismatch")
    # Only the normalized event is transmitted, never local session/settings/config.
    payload = {field: event.get(field) for field in FIELDS}
    payload["raw"] = None
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if len(body) > 32768:
        raise BridgeError("message_too_large")
    timestamp = str(int(time.time() if now is None else now))
    signature = hmac.new(key.encode("utf-8"), f"pcs-instagram-local-v1\n{timestamp}\n".encode() + body, hashlib.sha256).hexdigest()
    return body, {"content-type": "application/json", "x-pcs-local-timestamp": timestamp,
                  "x-pcs-local-signature": signature}


def forward_pending(state, config, receipt_store, transport=None, limit=10):
    if not state or state.get("account_id") != str(config.get("account_id")):
        raise BridgeError("account_mismatch")
    if not 1 <= limit <= 10:
        raise BridgeError("batch_limit")
    receipts = receipt_store.load() or {"version": 1, "account_id": state["account_id"], "acknowledged": {}}
    if (receipts.get("version") != 1 or receipts.get("account_id") != state["account_id"] or
            not isinstance(receipts.get("acknowledged"), dict)):
        raise BridgeError("receipt_account_mismatch")
    owned = transport is None
    if owned:
        import requests
        transport = requests.Session()
    sent = 0
    pending = [event for event in state["events"] if event["message_id"] not in receipts["acknowledged"]]
    try:
        for event in pending[:limit]:
            body, headers = signed_event(event, config)
            try:
                response = transport.post(HUB_URL, data=body, headers=headers, timeout=(10, 65), allow_redirects=False)
                if response.status_code != 200:
                    raise BridgeError("hub_did_not_acknowledge")
                result = response.json()
            except Exception:
                raise BridgeError("hub_did_not_acknowledge") from None
            if (not isinstance(result, dict) or result.get("ok") is not True or result.get("accepted") is not True or
                    result.get("event_id") != event["message_id"] or result.get("action") != "approval_required" or
                    not isinstance(result.get("generation_id"), str) or not result["generation_id"]):
                raise BridgeError("invalid_hub_receipt")
            receipts["acknowledged"][event["message_id"]] = result["generation_id"]
            # Atomic encrypted persistence after each receipt. If this fails, a retry
            # obtains the original server receipt by the stable event ID.
            receipt_store.save(receipts)
            sent += 1
    finally:
        if owned:
            transport.close()
    return {"acknowledged": sent, "remaining": len(pending) - sent, "mode": "draft_only"}


def main():
    parser = argparse.ArgumentParser(description="PCS: explicit draft-only Hub transfer")
    parser.add_argument("--send-pending", action="store_true", required=True)
    parser.parse_args()
    import msvcrt
    directory = Path(os.environ["LOCALAPPDATA"]) / "PCS" / "instagram-local"
    directory.mkdir(parents=True, exist_ok=True)
    with open(directory / "delivery.lock", "a+b") as lock:
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            state = EncryptedStore(directory / "account.dpapi").load()
            inbox = EncryptedStore(directory / "inbox.dpapi").load()
            if inbox:
                if not state or inbox.get("account_id") != state.get("account_id") or inbox.get("started_at") != state.get("started_at"):
                    raise BridgeError("account_mismatch")
                state = inbox
            config = EncryptedStore(directory / "bridge.dpapi").load()
            if not state or not config:
                raise BridgeError("login_and_bridge_setup_required")
            result = forward_pending(state, config, EncryptedStore(directory / "delivery.dpapi"))
            print(json.dumps(result))
        except Exception:
            # Never print raw SDK/HTTP errors, message bodies, keys or session data.
            print(json.dumps({"ok": False, "error": "transfer_stopped_without_acknowledgement"}))
            raise SystemExit(1)


if __name__ == "__main__":
    main()
