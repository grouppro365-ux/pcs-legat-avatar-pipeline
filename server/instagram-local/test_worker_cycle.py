import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import Mock, patch
import relay_worker as worker


class WorkerCycleTest(unittest.TestCase):
    def test_temporary_cloud_failure_waits_before_resuming_same_worker(self):
        from bridge import BridgeError
        transport = Mock()
        runtime = {"account": {}, "config": {"outgoing_enabled": True}, "reader": Mock(),
                   "sender": Mock(), "stores": {}, "transport": transport, "directory": Path("fake")}
        with patch.object(worker, "setup_cpu_limit"), \
                patch.object(worker, "create_clients", return_value=runtime), \
                patch.object(worker, "lock_file", side_effect=lambda path: nullcontext()), \
                patch.object(worker, "CpuLoad") as load, \
                patch.object(worker, "cycle", side_effect=[BridgeError("hub_did_not_acknowledge"), {"ok": True}]) as cycle, \
                patch.object(worker.time, "sleep", side_effect=[None, RuntimeError("test_finished")]) as sleep:
            load.return_value.percent.return_value = 0
            with self.assertRaisesRegex(RuntimeError, "test_finished"):
                worker.run([])
            self.assertEqual(cycle.call_count, 2)
            self.assertEqual(sleep.call_args_list[0].args, (60,))
            transport.close.assert_called_once()

    def test_once_runs_one_cycle_and_closes_transport(self):
        transport = Mock()
        runtime = {"account": {}, "config": {"outgoing_enabled": True}, "reader": Mock(), "sender": Mock(),
                   "stores": {}, "transport": transport, "directory": Path("fake")}
        with patch.object(worker, "setup_cpu_limit"), \
                patch.object(worker, "create_clients", return_value=runtime), \
                patch.object(worker, "lock_file", side_effect=lambda path: nullcontext(), create=True), \
                patch.object(worker, "cycle", return_value={"ok": True}) as cycle:
            worker.run(["--once"])
            cycle.assert_called_once()
            transport.close.assert_called_once()

    def test_only_fresh_pilot_messages_are_forwarded_before_delivery(self):
        config = {"account_id": "42", "outgoing_enabled": True,
                  "outgoing_since": "2026-10-01T00:00:00+00:00",
                  "pilot_recipient_ids": ["7"]}
        events = [{"timestamp": 1790812800000, "external_user_id": "instagrapi:42:7"},
                  {"timestamp": 1790812799000, "external_user_id": "instagrapi:42:7"},
                  {"timestamp": 1790812800000, "external_user_id": "instagrapi:42:8"}]
        state = {"account_id": "42", "events": events}
        stores = {name: Mock() for name in ["inbox", "incoming", "outbound", "control"]}
        stores["inbox"].load.return_value = None
        with patch.object(worker, "collect_snapshot", return_value=state, create=True), \
                patch.object(worker, "forward_pending", create=True) as forward, \
                patch.object(worker, "relay_outgoing", return_value={"status": "idle"}, create=True) as relay:
            worker.cycle({}, config, Mock(), Mock(), stores, Mock())
            self.assertEqual(forward.call_args.args[0]["events"], events[:1])
            stores["inbox"].save.assert_called_once_with(state)
            relay.assert_called_once()


if __name__ == "__main__":
    unittest.main()
