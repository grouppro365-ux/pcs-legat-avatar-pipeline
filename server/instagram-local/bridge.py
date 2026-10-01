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
OUTBOX_URL = "https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-meta-webhook-v1?channel=instagram&source=instagrapi-outbox"
FIELDS = {"channel", "account", "conversation_id", "external_user_id", "message_id", "timestamp",
          "language", "text", "attachments", "reply_to", "kind", "name", "raw"}


class BridgeError(Exception):
    pass


def relay_outgoing(config, client, receipt_store, control_store, transport):
    """One durable cloud claim/send/ack cycle. Caller holds delivery.lock."""
    import uuid
    if config.get("outgoing_enabled") is not True:
        raise BridgeError("outgoing_disabled")
    account = identifier(config.get("account_id"))
    key = config.get("hmac_secret")
    if not isinstance(key, str) or len(key) < 32:
        raise BridgeError("bridge_not_configured")
    state = control_store.load()
    if state is None:
        state = {"version": 1, "account_id": account, "request_id": str(uuid.uuid4()), "claimed": None, "ack": None}
        control_store.save(state)
    if (not isinstance(state, dict) or type(state.get("version")) is not int or state["version"] != 1
            or state.get("account_id") != account or not isinstance(state.get("request_id"), str)):
        raise BridgeError("outbox_control_invalid")

    def request(payload):
        body = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        timestamp = str(int(time.time()))
        signature = hmac.new(key.encode(), f"pcs-instagram-outbox-v1\n{timestamp}\n".encode() + body,
                             hashlib.sha256).hexdigest()
        try:
            response = transport.post(OUTBOX_URL, data=body, headers={"content-type": "application/json",
                "x-pcs-local-timestamp": timestamp, "x-pcs-local-signature": signature},
                timeout=(10, 30), allow_redirects=False)
            result = response.json()
            if response.status_code != 200 or not isinstance(result, dict) or result.get("ok") is not True:
                raise ValueError()
            return result
        except Exception:
            raise BridgeError("outbox_not_acknowledged") from None

    if state.get("ack") is None:
        if state.get("claimed") is None:
            claimed = request({"action": "claim", "account_id": account, "request_id": state["request_id"]})
            if "job" not in claimed:
                raise BridgeError("invalid_outbox_receipt")
            if claimed["job"] is None:
                control_store.save(None)
                return {"status": "idle"}
            if (not isinstance(claimed["job"], dict) or not isinstance(claimed["job"].get("body"), str)
                    or not isinstance(claimed.get("claim_id"), str)):
                raise BridgeError("invalid_outbox_receipt")
            state["claimed"] = claimed
            control_store.save(state)
        claimed = state["claimed"]
        envelope = claimed["job"]
        try:
            receipt = deliver_approved_reply(envelope["body"].encode("utf-8"), envelope.get("signature"),
                                             config, client, receipt_store)
            ack = {"status": "sent", "message_id": receipt["message_id"], "generation_id": receipt["generation_id"]}
        except BridgeError as error:
            if str(error) != "delivery_uncertain_manual_review":
                raise
            ack = {"status": "uncertain", "generation_id": json.loads(envelope["body"])["generation_id"]}
        state["ack"] = dict(ack, action="ack", account_id=account, request_id=state["request_id"], claim_id=claimed["claim_id"])
        control_store.save(state)
    accepted = request(state["ack"])
    if accepted.get("acknowledged") is not True or accepted.get("generation_id") != state["ack"]["generation_id"]:
        raise BridgeError("invalid_outbox_receipt")
    status = state["ack"]["status"]
    control_store.save(None)
    if status == "uncertain":
        raise BridgeError("delivery_uncertain_manual_review")
    return {"status": "sent"}


def deliver_approved_reply(body, signature, config, client, receipt_store, now=None):
    """Deliver one signed PCS job. Never retry an ambiguous Instagram send."""
    if config.get("outgoing_enabled") is not True:
        raise BridgeError("outgoing_disabled")
    account = identifier(config.get("account_id"))
    key = config.get("hmac_secret")
    if not isinstance(key, str) or len(key) < 32 or not isinstance(body, bytes) or len(body) > 32768:
        raise BridgeError("invalid_outgoing_job")
    expected = hmac.new(key.encode("utf-8"), b"pcs-instagram-outbound-v1\n" + body, hashlib.sha256).hexdigest()
    if not isinstance(signature, str) or not hmac.compare_digest(expected, signature):
        raise BridgeError("invalid_outgoing_signature")
    try:
        job = json.loads(body)
        generation = job["generation_id"]
        thread_id = identifier(job["thread_id"])
        recipient = identifier(job["recipient_id"])
        text = job["text"]
        expires = job["expires_at"]
        seconds = int(time.time() if now is None else now)
        valid = (job["account_id"] == account and str(client.user_id) == account and recipient != account
                 and job["approved"] is True and isinstance(generation, str) and 0 < len(generation) <= 100
                 and isinstance(text, str) and 0 < len(text.strip()) <= 8000
                 and type(expires) is int and seconds < expires <= seconds + 300)
        if not valid:
            raise ValueError()
    except Exception:
        raise BridgeError("invalid_outgoing_job") from None
    ledger = receipt_store.load()
    if ledger is None:
        ledger = {"version": 1, "account_id": account, "deliveries": {}}
    if (not isinstance(ledger, dict) or type(ledger.get("version")) is not int or ledger.get("version") != 1
            or ledger.get("account_id") != account or not isinstance(ledger.get("deliveries"), dict)):
        raise BridgeError("receipt_account_mismatch")
    digest = hashlib.sha256(body).hexdigest()
    previous = ledger["deliveries"].get(generation)
    if previous:
        if previous.get("digest") != digest:
            raise BridgeError("outgoing_job_changed")
        if previous.get("status") == "sent":
            return previous["receipt"]
        raise BridgeError("delivery_uncertain_manual_review")
    try:
        thread = client.direct_thread(thread_id, amount=1)
        users = {str(item.pk) for item in thread.users if str(item.pk) != account}
        if str(thread.id) != thread_id or thread.is_group or thread.shh_mode_enabled or users != {recipient}:
            raise ValueError()
    except Exception:
        raise BridgeError("outgoing_recipient_unverified") from None
    # Reserve before the network write. A crash or lost acknowledgement leaves
    # 'sending', which is deliberately not automatically retried.
    ledger["deliveries"][generation] = {"status": "sending", "digest": digest}
    receipt_store.save(ledger)
    try:
        delivered = client.direct_send(text, thread_ids=[thread_id])
        message_id = identifier(getattr(delivered, "id", None))
    except Exception:
        raise BridgeError("delivery_uncertain_manual_review") from None
    receipt = {"generation_id": generation, "message_id": message_id, "status": "sent"}
    ledger["deliveries"][generation] = {"status": "sent", "digest": digest, "receipt": receipt}
    receipt_store.save(ledger)
    return receipt


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
    queued = 0
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
                    result.get("event_id") != event["message_id"] or result.get("action") not in {"approval_required", "pending_send"} or
                    not isinstance(result.get("generation_id"), str) or not result["generation_id"]):
                raise BridgeError("invalid_hub_receipt")
            receipts["acknowledged"][event["message_id"]] = result["generation_id"]
            # Atomic encrypted persistence after each receipt. If this fails, a retry
            # obtains the original server receipt by the stable event ID.
            receipt_store.save(receipts)
            sent += 1
            queued += int(result["action"] == "pending_send")
    finally:
        if owned:
            transport.close()
    return {"acknowledged": sent, "remaining": len(pending) - sent, "mode": "queued" if queued else "draft_only"}


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

