import copy
from datetime import datetime
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from intake import (EncryptedStore, Intake, IntakeError, new_state,
                    normalize_message, protect, unprotect, read_only_client, utc)


def message(mid="11", sender="2", time="2026-09-27T10:01:00+00:00", **extra):
    return dict(id=mid, user_id=sender, timestamp=time, text="Здравствуйте 👋", **extra)


def thread(messages=None, **extra):
    return dict(id="30", users=[dict(pk="2", full_name="Test")],
                messages=messages if messages is not None else [message()], **extra)


class FakeClient:
    user_id = "1"

    def __init__(self, threads=None, pending=None):
        self.threads = threads if threads is not None else [thread()]
        self.pending = pending or []
        self.calls = []

    def direct_threads(self, **kwargs):
        self.calls.append(("inbox", kwargs))
        return self.threads

    def direct_pending_inbox(self, **kwargs):
        self.calls.append(("pending", kwargs))
        return self.pending

    def direct_thread(self, tid, **kwargs):
        raise AssertionError("Unexpected history fetch")


class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.state = new_state("1", "pcs_test", "2026-09-27T10:00:00+00:00")

    def test_canonical_message_has_no_raw_session_or_transport_collision(self):
        row = normalize_message("1", thread(), message())
        self.assertEqual(row["channel"], "instagram")
        self.assertEqual(row["account"], "instagrapi:1")
        self.assertEqual(row["external_user_id"], "instagrapi:1:2")
        self.assertEqual(row["conversation_id"], "instagrapi:1:30")
        self.assertEqual(row["message_id"], "instagrapi:1:11")
        self.assertEqual(row["timestamp"], 1790503260000)
        self.assertEqual(row["text"], "Здравствуйте 👋")
        self.assertIsNone(row["raw"])

    def test_collects_only_new_inbound_and_replay_is_idempotent(self):
        client = FakeClient([thread([message(), message("12", sender="1"),
                                    message("13", time="2026-09-27T09:59:00+00:00")])])
        original = copy.deepcopy(self.state)
        updated = Intake(client).collect(self.state)
        self.assertEqual(self.state, original)
        self.assertEqual(len(updated["events"]), 1)
        self.assertEqual(Intake(client).collect(updated), updated)

    def test_pending_inbox_is_read_but_never_approved(self):
        updated = Intake(FakeClient([], [thread()])).collect(self.state)
        self.assertEqual(len(updated["events"]), 1)

    def test_groups_ephemeral_and_own_echoes_are_not_ingested(self):
        for item in [thread(is_group=True), thread(shh_mode_enabled=True),
                     thread([message(is_sent_by_viewer=True)]),
                     thread([message(is_shh_mode=True)])]:
            self.assertEqual(Intake(FakeClient([item])).collect(self.state)["events"], [])

    def test_non_text_message_is_held_for_manual_view_not_lost(self):
        msg = message(item_type="media")
        msg["text"] = None
        updated = Intake(FakeClient([thread([msg])])).collect(self.state)
        row = updated["events"][0]
        self.assertEqual(row["kind"], "media")
        self.assertTrue(row["text"])
        self.assertEqual(row["attachments"], [{"type": "media", "requires_manual_view": True}])

    def test_missing_identity_or_invalid_time_fails_closed(self):
        for broken in [message(sender=""), message(time="not-a-date"), message(mid="")]:
            with self.assertRaises(IntakeError):
                Intake(FakeClient([thread([broken])])).collect(self.state)

    def test_wrong_account_fails_closed(self):
        self.state["account_id"] = "900"
        with self.assertRaises(IntakeError):
            Intake(FakeClient()).collect(self.state)

    def test_thread_limit_never_silently_truncates(self):
        client = FakeClient([thread()] * 101)
        with self.assertRaises(IntakeError):
            Intake(client).collect(self.state)
        self.assertEqual(self.state["events"], [])

    def test_network_failure_does_not_advance_or_overwrite_state(self):
        before = copy.deepcopy(self.state)
        client = FakeClient()
        with patch.object(client, "direct_pending_inbox", side_effect=RuntimeError("network")):
            with self.assertRaises(RuntimeError):
                Intake(client).collect(self.state)
        self.assertEqual(before, self.state)

    def test_truncated_recent_history_is_reported(self):
        client = FakeClient([thread([message(str(i)) for i in range(20)])])
        with patch.object(client, "direct_thread", return_value=thread([message(str(i)) for i in range(101)])):
            with self.assertRaises(IntakeError):
                Intake(client).collect(self.state)

    def test_sdk_cannot_send_mark_read_or_approve_requests(self):
        from instagrapi import Client
        client = read_only_client()
        with patch.object(Client, "private_request", return_value={}) as network:
            for endpoint in ["direct_v2/threads/broadcast/text/", "direct_v2/threads/30/approve/",
                             "direct_v2/threads/30/items/11/seen/"]:
                with self.assertRaises(IntakeError):
                    client.private_request(endpoint, data={"text": "never send"})
            with self.assertRaises(IntakeError):
                client.private_request("direct_v2/inbox/", data={})
            network.assert_not_called()
            client.private_request("direct_v2/inbox/", params={"limit": 20})
            network.assert_called_once()

    def test_upstream_error_content_never_reaches_user(self):
        from login_window import safe_error
        self.assertNotIn("secret-token", safe_error(RuntimeError("secret-token")))

    def test_matches_existing_javascript_hub_contract(self):
        import subprocess
        row = normalize_message("1", thread(), message())
        module = (Path(__file__).resolve().parents[1] / "supabase/pcs-meta-webhook-v1/conversation-hub.mjs").as_uri()
        program = "import {hubMessage,hasMessageIdentity} from " + json.dumps(module) + ";" + "const r=JSON.parse(process.argv[1]); const out=hubMessage({...r,conversationId:r.conversation_id,externalUserId:r.external_user_id,messageId:r.message_id,replyTo:r.reply_to});if(!hasMessageIdentity(out))process.exit(1);console.log(JSON.stringify(out));"
        result = subprocess.run(["node", "--input-type=module", "-e", program, json.dumps(row)], capture_output=True, text=True, encoding="utf-8", check=True)
        self.assertEqual(json.loads(result.stdout), row)

    def test_security_challenge_stops_without_automatic_resolution(self):
        with self.assertRaisesRegex(IntakeError, "instagram_security_check"):
            read_only_client().challenge_resolve({"challenge": "synthetic"})

    def test_sdk_settings_do_not_contain_login_password(self):
        client = read_only_client()
        client.password = "synthetic-password-not-for-storage"
        self.assertNotIn(client.password, json.dumps(client.get_settings()))

    def test_session_persists_only_after_login_and_clears_password(self):
        from login_window import LocalSession
        from types import SimpleNamespace
        from unittest.mock import Mock
        store = Mock()
        store.load.return_value = None
        client = Mock(user_id="1")
        client.login.return_value = True
        client.account_info.return_value = SimpleNamespace(pk="1")
        client.get_settings.return_value = {"authorization_data": {"synthetic": True}}
        session = LocalSession(store)
        with patch("login_window.read_only_client", return_value=client):
            session.login("pcs_test", "synthetic-password")
        self.assertTrue(session.authenticated)
        self.assertEqual(client.password, "")
        self.assertNotIn("synthetic-password", json.dumps(store.save.call_args.args[0]))
        store.reset_mock()
        client.login.side_effect = RuntimeError("private upstream response")
        with self.assertRaises(RuntimeError):
            session.login("pcs_test", "synthetic-password")
        self.assertFalse(session.authenticated)
        self.assertEqual(client.password, "")
        store.save.assert_not_called()


@unittest.skipUnless(os.name == "nt", "Windows DPAPI")
class EncryptionTests(unittest.TestCase):
    def test_dpapi_roundtrip_and_tamper(self):
        clear = b"synthetic-session-secret"
        encrypted = protect(clear)
        self.assertNotIn(clear, encrypted)
        self.assertEqual(unprotect(encrypted), clear)
        with self.assertRaises(OSError):
            unprotect(encrypted[:-8] + b"tampered")

    def test_atomic_store_and_corruption_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EncryptedStore(Path(directory) / "test.dpapi")
            self.assertIsNone(store.load())
            store.save({"session": "synthetic-private-value"})
            self.assertEqual(store.load(), {"session": "synthetic-private-value"})
            self.assertNotIn(b"synthetic-private-value", store.path.read_bytes())
            with patch("intake.os.replace", side_effect=OSError("disk error")):
                with self.assertRaises(OSError):
                    store.save({"session": "replacement"})
            self.assertEqual(store.load()["session"], "synthetic-private-value")
            store.path.write_bytes(b"broken")
            with self.assertRaises(OSError):
                store.load()


class PaginationTests(unittest.TestCase):
    def test_sdk_local_naive_time_recovers_original_instant(self):
        stamp = 1790503260
        sdk_value = datetime.fromtimestamp(stamp)
        self.assertEqual(int(utc(sdk_value, sdk_naive=True).timestamp()), stamp)
        with self.assertRaises(IntakeError):
            utc(sdk_value)

    def test_old_page_stops_scan_without_100_thread_cutoff(self):
        class Paged(FakeClient):
            def __init__(self):
                super().__init__()
                self.pages = []

            def direct_threads_chunk(self, cursor=None, thread_message_limit=None):
                self.pages.append(cursor)
                if cursor is None:
                    recent = [dict(thread([message(str(i))]), id=str(100 + i),
                                   last_activity_at='2026-09-27T10:01:00+00:00')
                              for i in range(101)]
                    return recent, 'next'
                return [dict(thread([message('old', time='2026-09-26T10:00:00+00:00')]),
                             last_activity_at='2026-09-26T10:00:00+00:00')], 'older'

            def direct_pending_chunk(self, cursor=None):
                return [], None

        client = Paged()
        state = new_state('1', 'pcs_test', '2026-09-27T10:00:00+00:00')
        updated = Intake(client).collect(state)
        self.assertEqual(len(updated['events']), 101)
        self.assertEqual(client.pages, [None, 'next'])

    def test_unsorted_page_fails_closed(self):
        class Unsorted(FakeClient):
            def direct_threads_chunk(self, cursor=None, thread_message_limit=None):
                return [dict(thread(), last_activity_at='2026-09-27T10:01:00+00:00'),
                        dict(thread(), last_activity_at='2026-09-27T10:02:00+00:00')], None

            def direct_pending_chunk(self, cursor=None):
                return [], None

        with self.assertRaisesRegex(IntakeError, 'history_gap_manual_review'):
            Intake(Unsorted()).collect(new_state('1', 'pcs_test', '2026-09-27T10:00:00+00:00'))


if __name__ == "__main__":
    unittest.main()
