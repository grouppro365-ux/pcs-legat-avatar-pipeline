import copy
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock

from bridge import BridgeError, HUB_URL, forward_pending, signed_event
from intake import new_state, normalize_message
from test_intake import message, thread


class MemoryStore:
    def __init__(self):
        self.value = None

    def load(self):
        return copy.deepcopy(self.value)

    def save(self, value):
        self.value = copy.deepcopy(value)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.config = {"account_id": "1", "hmac_secret": "synthetic-test-key-01234567890123456789"}
        self.state = new_state("1", "pcs_test", "2026-09-27T10:00:00+00:00")
        self.row = normalize_message("1", thread(), message())
        self.state["events"] = [self.row]
        self.store = MemoryStore()
        self.transport = Mock()
        self.receipt = {"ok": True, "accepted": True, "event_id": self.row["message_id"],
                        "action": "approval_required", "generation_id": "synthetic-draft"}
        self.transport.post.return_value.status_code = 200
        self.transport.post.return_value.json.return_value = self.receipt

    def test_valid_receipt_is_saved_and_not_retransmitted(self):
        result = forward_pending(self.state, self.config, self.store, self.transport)
        self.assertEqual(result["acknowledged"], 1)
        self.assertEqual(forward_pending(self.state, self.config, self.store, self.transport)["acknowledged"], 0)
        self.transport.post.assert_called_once()
        self.assertEqual(self.transport.post.call_args.args[0], HUB_URL)
        self.assertFalse(self.transport.post.call_args.kwargs["allow_redirects"])

    def test_server_failure_or_redirect_keeps_event_unacknowledged(self):
        for status in [301, 302, 401, 409, 500, 503]:
            self.transport.post.return_value.status_code = status
            with self.assertRaises(BridgeError):
                forward_pending(self.state, self.config, self.store, self.transport)
            self.assertIsNone(self.store.value)

    def test_malformed_wrong_event_or_sent_receipt_is_not_accepted(self):
        for changes in [{"ok": False}, {"accepted": False}, {"event_id": "wrong"},
                        {"action": "sent"}, {"generation_id": ""}]:
            self.transport.post.return_value.json.return_value = dict(self.receipt, **changes)
            with self.assertRaises(BridgeError):
                forward_pending(self.state, self.config, self.store, self.transport)
            self.assertIsNone(self.store.value)
        for invalid in [None, [], "not a receipt"]:
            self.transport.post.return_value.json.return_value = invalid
            with self.assertRaises(BridgeError):
                forward_pending(self.state, self.config, self.store, self.transport)
            self.assertIsNone(self.store.value)

    def test_local_disk_failure_leaves_receipt_retryable(self):
        self.store.save = Mock(side_effect=OSError("disk failure"))
        with self.assertRaises(OSError):
            forward_pending(self.state, self.config, self.store, self.transport)
        self.assertIsNone(self.store.value)
        self.assertEqual(len(self.state["events"]), 1)

    def test_network_loss_does_not_delete_local_queue(self):
        before = copy.deepcopy(self.state)
        self.transport.post.side_effect = TimeoutError("synthetic private data")
        with self.assertRaisesRegex(BridgeError, "hub_did_not_acknowledge"):
            forward_pending(self.state, self.config, self.store, self.transport)
        self.assertEqual(self.state, before)
        self.assertIsNone(self.store.value)

    def test_never_transmits_settings_or_hmac_key_in_body(self):
        event = dict(self.row, session={"token": "synthetic-private-value"}, raw={"token": "synthetic-private-value"})
        body, _ = signed_event(event, self.config)
        self.assertNotIn(b"synthetic-private-value", body)
        self.assertNotIn(self.config["hmac_secret"].encode(), body)
        self.assertIsNone(json.loads(body)["raw"])

    def test_account_binding_precedes_http(self):
        with self.assertRaises(BridgeError):
            forward_pending(self.state, dict(self.config, account_id="900"), self.store, self.transport)
        self.transport.post.assert_not_called()

    def test_python_signature_is_accepted_by_real_js_receiver(self):
        seconds = 1790503260
        body, headers = signed_event(self.row, self.config, now=seconds)
        module = (Path(__file__).resolve().parents[1] / "supabase/pcs-meta-webhook-v1/instagram-local.mjs").as_uri()
        program = "import {receiveLocalInstagram} from " + json.dumps(module) + ";" + """
          let input=''; for await (const chunk of process.stdin) input+=chunk;
          const f=JSON.parse(input);
          let captured=null;
          const response=await receiveLocalInstagram({bytes:new TextEncoder().encode(f.body),headers:new Headers(f.headers),
            config:{...f.config,enabled:true},now:f.now,
            store:{claim:async(id,digest)=>({id,status:'new',digest}),complete:async()=>{},fail:async()=>{}},
            process:async(row)=>{captured=row;return {action:'approval_required',generation_id:'synthetic-draft'};}});
          console.log(JSON.stringify({status:response.status,captured,receipt:await response.json()}));
        """
        result = subprocess.run(["node", "--input-type=module", "-e", program],
                                input=json.dumps({"body": body.decode(), "headers": headers, "config": self.config, "now": seconds * 1000}),
                                capture_output=True, text=True, encoding="utf-8", check=True)
        actual = json.loads(result.stdout)
        self.assertEqual(actual["status"], 200)
        self.assertEqual(actual["captured"], self.row)
        self.assertEqual(actual["receipt"], self.receipt)


if __name__ == "__main__":
    unittest.main()
