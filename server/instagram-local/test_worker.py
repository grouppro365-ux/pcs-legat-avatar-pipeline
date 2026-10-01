import unittest
from unittest.mock import patch
import relay_worker as worker


class WorkerTests(unittest.TestCase):
    def test_cpu_guard_failure_stops_before_instagram_clients(self):
        self.assertTrue(callable(getattr(worker, "run", None)), "The relay must enforce its CPU guard before accessing Instagram")
        with patch.object(worker, "setup_cpu_limit", side_effect=RuntimeError("cpu_limit_unavailable")), \
             patch.object(worker, "create_clients") as clients:
            with self.assertRaisesRegex(RuntimeError, "cpu_limit_unavailable"):
                worker.run(["--probe"])
            clients.assert_not_called()
        limit=worker.setup_cpu_limit()
        self.assertEqual(limit["cpu_limit_percent"],10)
        self.assertTrue(limit["assigned"])


if __name__ == "__main__":
    unittest.main()
