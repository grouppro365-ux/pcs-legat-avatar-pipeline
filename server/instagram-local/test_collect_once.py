import copy
import unittest

from collect_once import collect_snapshot
from intake import IntakeError, new_state
from test_intake import FakeClient, message, thread


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.account = new_state('1', 'pcs_test', '2026-09-27T10:00:00+00:00')
        self.account['session'] = {'test-secret': 'must-not-leave-account-store'}

    def test_snapshot_has_no_session_and_does_not_mutate_login(self):
        original = copy.deepcopy(self.account)
        result = collect_snapshot(self.account, None, FakeClient())
        self.assertNotIn('session', result)
        self.assertEqual(self.account, original)
        self.assertEqual(len(result['events']), 1)

    def test_queue_survives_repeated_reads_without_duplicates(self):
        first = collect_snapshot(self.account, None, FakeClient())
        result = collect_snapshot(self.account, first, FakeClient([thread([message('12')])]))
        self.assertEqual(len(result['events']), 2)
        self.assertEqual(collect_snapshot(self.account, result, FakeClient()), result)

    def test_wrong_account_or_cutoff_is_rejected(self):
        prior = collect_snapshot(self.account, None, FakeClient())
        for change in [{'account_id': '99'}, {'started_at': '2026-09-20T10:00:00+00:00'}]:
            with self.assertRaises(IntakeError):
                collect_snapshot(self.account, dict(prior, **change), FakeClient())


if __name__ == '__main__':
    unittest.main()
