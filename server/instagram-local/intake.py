"""Local-only Instagram intake. No outbound transport, AI calls or server upload."""
import copy
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile

MAX_THREADS = 100
MAX_PAGES = 25
MAX_MESSAGES = 100
MAX_EVENTS = 5000


class IntakeError(Exception):
    """Safe, fixed error code; never an upstream response or credentials."""


class Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def _dpapi(value, decrypt=False):
    if os.name != "nt":
        raise IntakeError("windows_required")
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    operation = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    operation.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p,
                          ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                          wintypes.DWORD, ctypes.POINTER(Blob)]
    operation.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    buffer = ctypes.create_string_buffer(value)
    source = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    # Current Windows user only; forbid cryptographic UI. Never LOCAL_MACHINE.
    if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        kernel.LocalFree(target.data)


def protect(value):
    return _dpapi(value)


def unprotect(value):
    return _dpapi(value, decrypt=True)


class EncryptedStore:
    def __init__(self, path):
        self.path = Path(path)

    def load(self):
        if not self.path.exists():
            return None
        # Corrupt/unreadable data must never silently become a new empty account.
        return json.loads(unprotect(self.path.read_bytes()))

    def save(self, value):
        encrypted = protect(json.dumps(value, ensure_ascii=False).encode("utf-8"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.path.parent, delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(encrypted)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()


def utc(value, sdk_naive=False):
    try:
        result = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if result.tzinfo is None:
            if not sdk_naive:
                raise ValueError()
            # instagrapi converts Instagram microseconds with
            # datetime.fromtimestamp(), producing machine-local naive time.
            result = result.astimezone()
        return result.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        raise IntakeError("invalid_timestamp") from None


def identifier(value):
    value = str(value or "")
    if not re.fullmatch(r"[0-9]{1,80}", value):
        raise IntakeError("invalid_identity")
    return value


def as_dict(value):
    return value.model_dump(mode="json") if hasattr(value, "model_dump") else value


def new_state(account_id, username, started_at=None):
    return {"version": 1, "account_id": identifier(account_id),
            "username": username.strip().lower(),
            "started_at": utc(started_at or datetime.now(timezone.utc)).isoformat(),
            "events": []}


def normalize_message(account_id, thread, message):
    account = identifier(account_id)
    sender = identifier(message.get("user_id"))
    if (thread.get("is_group") or thread.get("shh_mode_enabled") or
            message.get("is_shh_mode") or message.get("is_sent_by_viewer") or sender == account):
        return None
    participants = {str(user.get("pk")) for user in thread.get("users", [])}
    if len(participants - {account}) != 1 or sender not in participants:
        raise IntakeError("ambiguous_participants")
    kind = str(message.get("item_type") or "text")
    text = str(message.get("text") or "").strip()
    attachments = []
    if not text:
        kind = kind if kind != "text" else "attachment"
        text = "[Вложение Instagram: требуется просмотр оператором]"
        attachments = [{"type": kind, "requires_manual_view": True}]
    return {
        "channel": "instagram", "account": f"instagrapi:{account}",
        "conversation_id": f"instagrapi:{account}:{identifier(thread.get('id'))}",
        "external_user_id": f"instagrapi:{account}:{sender}",
        "message_id": f"instagrapi:{account}:{identifier(message.get('id'))}",
        "timestamp": int(utc(message.get("timestamp"), sdk_naive=True).timestamp() * 1000),
        "language": None, "text": text, "attachments": attachments,
        "reply_to": None, "kind": kind,
        "name": next((user.get("full_name") or user.get("username") for user in thread.get("users", [])
                      if str(user.get("pk")) == sender), None),
        "raw": None,
    }


class Intake:
    def __init__(self, client):
        self.client = client

    def _recent_threads(self, started, pending=False):
        # Instagram orders inbox pages by last activity. Stop at the first old
        # page rather than downloading years of unrelated historical chats.
        chunk = self.client.direct_pending_chunk if pending else self.client.direct_threads_chunk
        rows, cursor, pages, prior_activity = [], None, 0, None
        while True:
            batch, next_cursor = chunk(cursor=cursor) if pending else chunk(cursor=cursor, thread_message_limit=20)
            pages += 1
            if pages > MAX_PAGES:
                raise IntakeError("thread_limit_manual_review")
            if not batch:
                if next_cursor:
                    raise IntakeError("history_gap_manual_review")
                return rows
            oldest = None
            for thread in batch:
                item = as_dict(thread)
                activity = utc(item.get("last_activity_at"), sdk_naive=True)
                if prior_activity and activity > prior_activity:
                    raise IntakeError("history_gap_manual_review")
                prior_activity = activity
                oldest = activity
                if activity >= started:
                    rows.append(item)
            if oldest < started or not next_cursor:
                return rows
            if next_cursor == cursor:
                raise IntakeError("history_gap_manual_review")
            cursor = next_cursor

    def collect(self, state):
        if state.get("version") != 1 or str(self.client.user_id) != state.get("account_id"):
            raise IntakeError("account_mismatch")
        started = utc(state["started_at"])
        seen = {row["message_id"] for row in state["events"]}
        if hasattr(self.client, "direct_threads_chunk") and hasattr(self.client, "direct_pending_chunk"):
            inbox = self._recent_threads(started)
            pending = self._recent_threads(started, pending=True)
        else:
            # Synthetic clients in existing compatibility tests.
            inbox = self.client.direct_threads(amount=MAX_THREADS + 1, thread_message_limit=20)
            pending = self.client.direct_pending_inbox(amount=MAX_THREADS + 1)
            if len(inbox) > MAX_THREADS or len(pending) > MAX_THREADS:
                raise IntakeError("thread_limit_manual_review")
        threads = {str(as_dict(item)["id"]): as_dict(item) for item in inbox + pending}
        collected = []
        for item in threads.values():
            if item.get("is_group") or item.get("shh_mode_enabled"):
                continue
            messages = item.get("messages", [])
            if (len(messages) >= 20 and all(utc(msg["timestamp"], sdk_naive=True) >= started for msg in messages)
                    and not any(f"instagrapi:{state['account_id']}:{msg.get('id')}" in seen for msg in messages)):
                item = as_dict(self.client.direct_thread(item["id"], amount=MAX_MESSAGES + 1))
                messages = item.get("messages", [])
                if len(messages) > MAX_MESSAGES and all(utc(msg["timestamp"], sdk_naive=True) >= started for msg in messages):
                    raise IntakeError("history_gap_manual_review")
            for msg in messages:
                if utc(msg.get("timestamp"), sdk_naive=True) < started:
                    continue
                row = normalize_message(state["account_id"], item, msg)
                if row and row["message_id"] not in seen:
                    collected.append(row)
                    seen.add(row["message_id"])
        if len(state["events"]) + len(collected) > MAX_EVENTS:
            raise IntakeError("local_queue_full")
        updated = copy.deepcopy(state)
        updated["events"].extend(sorted(collected, key=lambda row: (row["timestamp"], row["message_id"])))
        return updated


def read_only_client():
    from instagrapi import Client

    class LocalReadOnlyClient(Client):
        def challenge_resolve(self, *args, **kwargs):
            raise IntakeError("instagram_security_check")

        def private_request(self, endpoint, *args, **kwargs):
            if endpoint.startswith("direct_v2/"):
                allowed = re.fullmatch(r"direct_v2/(inbox/|pending_inbox/|threads/[0-9]+/)", endpoint)
                if not allowed or args or kwargs.get("data") is not None:
                    raise IntakeError("outbound_disabled")
            return super().private_request(endpoint, *args, **kwargs)

    return LocalReadOnlyClient()
