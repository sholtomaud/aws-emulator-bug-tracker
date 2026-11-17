"""Unit tests for the tracker's pure logic: python -m unittest"""
import tempfile
import unittest
from datetime import date

from track_issues import classify_evidence, classify_kind, daily_rows, is_agent, read_schedule


def schedule_for(cron: str) -> dict:
    with tempfile.NamedTemporaryFile('w', suffix='.yml') as f:
        f.write(f"on:\n  schedule:\n    - cron: '{cron}'\n")
        f.flush()
        return read_schedule(f.name)


class ScheduleTest(unittest.TestCase):
    def test_descriptions(self):
        self.assertEqual(schedule_for('5 */6 * * *')['description'], 'every 6 hours')
        self.assertEqual(schedule_for('5 */6 * * *')['run_times_utc'], ['00:05', '06:05', '12:05', '18:05'])
        self.assertEqual(schedule_for('0 0 * * *')['description'], 'daily')
        self.assertEqual(schedule_for('0 * * * *')['description'], 'every hour')
        self.assertEqual(schedule_for('0 6,7,20 * * *')['description'], '3 times a day')
        self.assertEqual(schedule_for('0 0 * * 1')['runs_per_day'], 0)


class KindTest(unittest.TestCase):
    def test_issue_forms(self):
        self.assertEqual(classify_kind('### Before you file\n\n### What happened\n\nIt broke', []), 'behavior')
        self.assertEqual(classify_kind('### Use case\n\n### What would help\n', []), 'feature')
        self.assertEqual(classify_kind('### What happened\n', ['feature-request']), 'feature')
        self.assertEqual(classify_kind('Is the emulator conscious?', []), 'other')
        self.assertEqual(classify_kind(None, ['bug']), 'behavior')


class EvidenceTest(unittest.TestCase):
    def evidence(self, reason='COMPLETED', closer=None, merged=None, by='maintainer', comments=()):
        return classify_evidence(reason, closer, merged, by, 'reporter', list(comments))

    def test_closing_event(self):
        self.assertEqual(self.evidence(closer='Commit'), 'fix_referenced')
        self.assertEqual(self.evidence(closer='PullRequest', merged=True), 'fix_referenced')
        self.assertEqual(self.evidence(closer='PullRequest', merged=False), 'no_reference')

    def test_comments(self):
        by = lambda author, body: {'author': author, 'body': body}
        self.assertEqual(self.evidence(comments=[by('maintainer', 'Fixed in 3fe364395b32')]), 'fix_referenced')
        self.assertEqual(self.evidence(comments=[by('bot', 'see https://github.com/a/b/commit/abc1234')]),
                         'fix_referenced')
        self.assertEqual(self.evidence(comments=[by('maintainer', 'This is resolved in v0.4.2.')]),
                         'fix_referenced')
        self.assertEqual(self.evidence(comments=[by('maintainer', 'Moved to issues/things-that-now-work/x.md')]),
                         'fix_referenced')
        # The reporter's own words are not evidence, and neither are plain words or numbers.
        self.assertEqual(self.evidence(comments=[by('reporter', 'fixed in abc1234?')]), 'no_reference')
        self.assertEqual(self.evidence(comments=[by('maintainer', 'Thanks, closing. Account 1234567890.')]),
                         'no_reference')
        self.assertEqual(self.evidence(comments=[by('maintainer', 'We decided against this.')]), 'no_reference')

    def test_reasons(self):
        self.assertEqual(self.evidence(reason='DUPLICATE', closer='Commit'), 'duplicate')
        self.assertEqual(self.evidence(reason='NOT_PLANNED'), 'declined')
        self.assertEqual(self.evidence(reason='not_planned', by='reporter'), 'withdrawn')
        self.assertEqual(self.evidence(by='reporter'), 'withdrawn')
        self.assertEqual(self.evidence(), 'no_reference')


class AgentTest(unittest.TestCase):
    def test_is_agent(self):
        self.assertTrue(is_agent('github-actions', 'Bot'))
        self.assertTrue(is_agent('IssueFixerAgent', 'User'))
        self.assertFalse(is_agent('arditti', 'User'))
        self.assertFalse(is_agent(None, None))


class DailyRowsTest(unittest.TestCase):
    def test_running_totals(self):
        issue = lambda created, closed=None, closer=None, evidence=None, kind='behavior': {
            'created_date': date(2026, 11, created), 'closed_date': closed and date(2026, 11, closed),
            'closer_type': closer, 'evidence': evidence, 'kind': kind, 'labelled': False}
        rows = daily_rows([
            issue(1),
            issue(1, 2, 'Human', 'no_reference'),
            issue(2, 3, 'AI Agent', 'fix_referenced'),
            issue(2, 3, 'Human', 'declined', kind='feature'),
        ], date(2026, 11, 3))
        self.assertEqual([r['open'] for r in rows], [2, 3, 1])
        last = rows[-1]
        self.assertEqual((last['agent_closed'], last['human_closed']), (1, 2))
        self.assertEqual((last['closed_fix_referenced'], last['closed_no_reference'], last['closed_declined']),
                         (1, 1, 1))
        self.assertEqual((last['behavior_created'], last['behavior_closed']), (3, 2))


if __name__ == '__main__':
    unittest.main()
