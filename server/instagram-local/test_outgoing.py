import copy
import hashlib
import hmac
import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

import bridge


class MemoryStore:
    def __init__(self):
        self.value = None

    def load(self):
        return copy.deepcopy(self.value)

    def save(self, value):
        self.value = copy.deepcopy(value)


class OutgoingTests(unittest.TestCase):
    def setUp(self):
        self.config = {"account_id": "1", "hmac_secret": "synthetic-key-012345678901234567890123456789",
                       "outgoing_enabled": True}
        self.job = {"generation_id": "draft-1", "account_id": "1", "thread_id": "12", "recipient_id": "2",
                    "text": "Fiesta — 300 THB в сутки.", "expires_at": int(time.time()) + 60,
                    "approved": True}
        self.client = Mock()
        self.client.user_id = "1"
        self.client.direct_thread.return_value = SimpleNamespace(id="12", users=[SimpleNamespace(pk=2)],
                                                                 is_group=False, shh_mode_enabled=False)
        self.client.direct_send.return_value = SimpleNamespace(id="99")
        self.store = MemoryStore()

    def envelope(self):
        body = json.dumps(self.job, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        signature = hmac.new(self.config["hmac_secret"].encode(), b"pcs-instagram-outbound-v1\n" + body,
                             hashlib.sha256).hexdigest()
        return body, signature

    def deliver(self):
        sender = getattr(bridge, "deliver_approved_reply", None)
        self.assertTrue(callable(sender), "PCS bridge must support an authenticated approved outgoing reply")
        body, signature = self.envelope()
        return sender(body, signature, self.config, self.client, self.store)

    def test_confirmed_delivery_is_saved_and_not_repeated(self):
        result = self.deliver()
        self.assertEqual(result["message_id"], "99")
        self.assertEqual(result["status"], "sent")
        self.assertEqual(self.deliver(), result)
        self.client.direct_send.assert_called_once_with(self.job["text"], thread_ids=["12"])
        self.assertEqual(self.store.value["deliveries"]["draft-1"]["status"], "sent")

    def test_disabled_transport_never_sends(self):
        self.config["outgoing_enabled"] = False
        with self.assertRaisesRegex(bridge.BridgeError, "outgoing_disabled"):
            self.deliver()
        self.client.direct_send.assert_not_called()

    def test_forged_signature_never_sends(self):
        body, signature = self.envelope()
        with self.assertRaisesRegex(bridge.BridgeError, "invalid_outgoing_signature"):
            bridge.deliver_approved_reply(body + b" ", signature, self.config, self.client, self.store)
        self.client.direct_send.assert_not_called()

    def test_unapproved_expired_or_wrong_account_never_sends(self):
        original = copy.deepcopy(self.job)
        for changes in [{"approved": False}, {"account_id": "3"}, {"recipient_id": "1"},
                        {"expires_at": 1}, {"expires_at": int(time.time()) + 3600}, {"text": ""}]:
            with self.subTest(changes=changes):
                self.job = dict(original, **changes)
                with self.assertRaises(bridge.BridgeError):
                    self.deliver()
        self.client.direct_send.assert_not_called()

    def test_group_vanishing_or_wrong_recipient_never_sends(self):
        for changes in [{"is_group": True}, {"shh_mode_enabled": True}, {"id": "98"},
                        {"users": [SimpleNamespace(pk=3)]}]:
            with self.subTest(changes=changes):
                self.client.direct_thread.return_value = SimpleNamespace(**dict(
                    {"id": "12", "users": [SimpleNamespace(pk=2)], "is_group": False,
                     "shh_mode_enabled": False}, **changes))
                with self.assertRaisesRegex(bridge.BridgeError, "outgoing_recipient_unverified"):
                    self.deliver()
        self.client.direct_send.assert_not_called()

    def test_uncertain_send_is_not_retried(self):
        self.client.direct_send.side_effect = TimeoutError("sensitive upstream error")
        for attempt in range(2):
            with self.assertRaisesRegex(bridge.BridgeError, "^delivery_uncertain_manual_review$"):
                self.deliver()
        self.client.direct_send.assert_called_once()
        self.assertEqual(self.store.value["deliveries"]["draft-1"]["status"], "sending")

    def test_missing_provider_ack_is_not_retried(self):
        self.client.direct_send.return_value = SimpleNamespace(id=None)
        for attempt in range(2):
            with self.assertRaisesRegex(bridge.BridgeError, "delivery_uncertain_manual_review"):
                self.deliver()
        self.client.direct_send.assert_called_once()

    def test_storage_failure_before_send_prevents_network_write(self):
        self.store.save = Mock(side_effect=OSError("storage unavailable"))
        with self.assertRaises(OSError):
            self.deliver()
        self.client.direct_send.assert_not_called()

    def test_storage_failure_after_send_preserves_no_retry_reservation(self):
        original_save = self.store.save
        calls = []
        def save_once(value):
            calls.append(1)
            if len(calls) > 1:
                raise OSError("storage unavailable")
            original_save(value)
        self.store.save = save_once
        with self.assertRaises(OSError):
            self.deliver()
        with self.assertRaisesRegex(bridge.BridgeError, "delivery_uncertain_manual_review"):
            self.deliver()
        self.client.direct_send.assert_called_once()

    def test_changed_job_id_cannot_send_a_second_reply(self):
        self.deliver()
        self.job["text"] = "Changed reply"
        with self.assertRaisesRegex(bridge.BridgeError, "outgoing_job_changed"):
            self.deliver()
        self.client.direct_send.assert_called_once()

    def test_invalid_existing_ledger_never_sends(self):
        for value in [{}, {"version": True, "account_id": "1", "deliveries": {}},
                      {"version": 1, "account_id": "3", "deliveries": {}}]:
            with self.subTest(value=value):
                self.store.value = value
                with self.assertRaisesRegex(bridge.BridgeError, "receipt_account_mismatch"):
                    self.deliver()
        self.client.direct_send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
