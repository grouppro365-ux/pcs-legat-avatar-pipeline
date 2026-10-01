import copy
import hashlib
import hmac
import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

import bridge
from test_outgoing import MemoryStore


class RelayTests(unittest.TestCase):
    def test_lost_cloud_ack_retries_only_ack_not_instagram_send(self):
        relay = getattr(bridge, "relay_outgoing", None)
        self.assertTrue(callable(relay), "PCS must connect its signed cloud queue to the existing Instagram sender")
        config = {"account_id": "1", "outgoing_enabled": True,
                  "hmac_secret": "synthetic-key-012345678901234567890123456789"}
        job = {"generation_id": "22222222-2222-4222-8222-222222222222", "account_id": "1",
               "thread_id": "12", "recipient_id": "2", "text": "Test reply", "approved": True,
               "expires_at": int(time.time()) + 300}
        body = json.dumps(job, separators=(",", ":")).encode()
        signature = hmac.new(config["hmac_secret"].encode(), b"pcs-instagram-outbound-v1\n" + body,
                             hashlib.sha256).hexdigest()
        claimed = {"ok": True, "claim_id": "33333333-3333-4333-8333-333333333333",
                   "job": {"body": body.decode(), "signature": signature}}
        ack = {"ok": True, "acknowledged": True, "generation_id": job["generation_id"]}
        def response(payload):
            item = Mock(status_code=200)
            item.json.return_value = payload
            return item
        transport = Mock()
        transport.post.side_effect = [response(claimed), TimeoutError("cloud unavailable"), response(ack)]
        client = Mock(user_id="1")
        client.direct_thread.return_value = SimpleNamespace(id="12", users=[SimpleNamespace(pk=2)],
                                                            is_group=False, shh_mode_enabled=False)
        client.direct_send.return_value = SimpleNamespace(id="99")
        receipts, control = MemoryStore(), MemoryStore()
        with self.assertRaisesRegex(bridge.BridgeError, "outbox_not_acknowledged"):
            relay(config, client, receipts, control, transport)
        self.assertEqual(control.value["ack"]["message_id"], "99")
        result = relay(config, client, receipts, control, transport)
        self.assertEqual(result["status"], "sent")
        self.assertIsNone(control.value)
        client.direct_send.assert_called_once()
        actions=[]
        for call in transport.post.call_args_list:
            payload=call.kwargs["data"]
            actions.append(json.loads(payload)["action"])
            timestamp=call.kwargs["headers"]["x-pcs-local-timestamp"]
            expected=hmac.new(config["hmac_secret"].encode(),
                f"pcs-instagram-outbox-v1\n{timestamp}\n".encode()+payload,hashlib.sha256).hexdigest()
            self.assertEqual(expected,call.kwargs["headers"]["x-pcs-local-signature"])
            self.assertFalse(call.kwargs["allow_redirects"])
        self.assertEqual(actions,["claim","ack","ack"])


if __name__ == "__main__":
    unittest.main()
