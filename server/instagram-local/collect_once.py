"""Read new messages using the existing encrypted login; never send replies."""
import copy
import json
import logging
import os
from pathlib import Path

from intake import EncryptedStore, Intake, IntakeError, read_only_client


def collect_snapshot(account, previous, client):
    if not account or str(client.user_id) != account.get("account_id"):
        raise IntakeError("account_mismatch")
    state = {key: copy.deepcopy(account[key]) for key in
             ("version", "account_id", "username", "started_at", "events")}
    if previous:
        if (previous.get("account_id") != state["account_id"] or
                previous.get("started_at") != state["started_at"]):
            raise IntakeError("account_mismatch")
        events = {event["message_id"]: event for event in state["events"]}
        events.update({event["message_id"]: event for event in previous["events"]})
        state["events"] = list(events.values())
    return Intake(client).collect(state)


def main():
    import msvcrt
    logging.disable(logging.CRITICAL)
    directory = Path(os.environ["LOCALAPPDATA"]) / "PCS" / "instagram-local"
    with open(directory / "delivery.lock", "a+b") as lock:
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            account = EncryptedStore(directory / "account.dpapi").load()
            if not account or not account.get("session"):
                raise IntakeError("login_required")
            client = read_only_client()
            client.set_settings(account["session"])
            if str(client.account_info().pk) != account["account_id"]:
                raise IntakeError("account_mismatch")
            store = EncryptedStore(directory / "inbox.dpapi")
            updated = collect_snapshot(account, store.load(), client)
            store.save(updated)
            print(json.dumps({"ok": True, "queued": len(updated["events"]),
                              "mode": "read_only", "sent": 0}))
        except Exception as error:
            # IntakeError strings are fixed local codes. Never print remote
            # response, SDK exception text, session or message contents.
            code = str(error) if isinstance(error, IntakeError) else type(error).__name__
            print(json.dumps({"ok": False, "error": code, "sent": 0}))
            raise SystemExit(1)


if __name__ == "__main__":
    main()
