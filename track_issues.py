import os
import re
import csv
import json
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
import requests
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

REPO = 'aws/aws-emulator'
CSV_FILE = 'data.csv'
CHART_FILE = 'issues_chart.png'
CLOCK_FILE = 'doomsday_clock.png'
README_FILE = 'README.md'
STATUS_FILE = 'status.json'
# The cron line in this workflow is the one place the update schedule is set.
# Everything else (status.json, the README, the dashboard) is derived from it.
WORKFLOW_FILE = '.github/workflows/track_issues.yml'
WINDOW_PADDING_DAYS = 14
QUEUE_OPEN_DIR = 'issues/things-that-do-not-work/'
QUEUE_RESOLVED_DIR = 'issues/things-that-now-work/'

AGENT_IDENTIFIERS = ['agent', 'bot', 'emulator-ai', 'automation', 'github-actions[bot]']

QUEUE_CSV_FILE = 'agent_queue.csv'
# Version 2 of the Developer Doomsday Clock combines both queues. This is the
# weight of the public issues in the combined figure (the agents' queue gets
# the rest). It is written to status.json, where the dashboard reads it.
DEFAULT_PUBLIC_WEIGHT = 0.5
# Commit authors in the emulator repository that are automation, not people.
AGENT_AUTHOR_EMAILS = {'aws-emulator@amazon.com'}
AGENT_AUTHOR_WORDS = ['agent', 'bot', 'automation', 'scaffolder', 'migration']

# How a closed issue was closed, judged only from what GitHub records.
EVIDENCE = ['fix_referenced', 'no_reference', 'declined', 'withdrawn', 'duplicate']
# What an issue is, read from the repository's two issue forms.
KINDS = ['behavior', 'feature', 'other']
CSV_FIELDS = (['date', 'open', 'agent_closed', 'human_closed']
              + [f'closed_{e}' for e in EVIDENCE]
              + ['behavior_created', 'behavior_closed'])

GRAPHQL_URL = 'https://api.github.com/graphql'
ISSUES_QUERY = """
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number createdAt closedAt stateReason body
        author { login }
        labels(first: 20) { nodes { name } }
        timelineItems(itemTypes: [CLOSED_EVENT], last: 1) {
          nodes {
            ... on ClosedEvent {
              actor { login __typename }
              closer {
                __typename
                ... on PullRequest { merged }
              }
            }
          }
        }
        reopens: timelineItems(itemTypes: [REOPENED_EVENT]) { totalCount }
        comments(last: 20) { nodes { author { login } body } }
      }
    }
  }
}
"""

# A commit URL or SHA, the agents' own "now works" record, or a fix tied to a release.
FIX_REFERENCE = re.compile(
    r'/commit/[0-9a-f]{7,40}'
    r'|\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b'
    r'|issues/things-that-now-work/'
    r'|\b(?:fix|resolv|releas|ship|includ)\w*\b.{0,60}?\bv?\d+\.\d+(?:\.\d+)?\b',
    re.IGNORECASE,
)


def get_headers(token: str | None = None) -> dict:
    headers = {'Accept': 'application/vnd.github+json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return headers


def is_agent(login: str | None, account_type: str | None) -> bool:
    """Whether an account is an AI agent: a GitHub Bot, or an agent-like login."""
    username = (login or '').lower()
    return account_type == 'Bot' or any(keyword in username for keyword in AGENT_IDENTIFIERS)


def classify_kind(body: str | None, labels: list[str]) -> str:
    """Bug-style behaviour report, feature request or other, from the issue form used.

    The repository offers two forms. Their headings stay in the issue text:
    "What happened" for "Behavior differs from AWS", "Use case" / "What would
    help" for "Feature request". Anything else did not come from a form.
    """
    headings = {h.strip().lower() for h in re.findall(r'^#{2,3}\s+(.+)$', body or '', re.MULTILINE)}
    names = {name.lower() for name in labels}
    if 'feature-request' in names or 'enhancement' in names or headings & {'use case', 'what would help'}:
        return 'feature'
    if 'bug' in names or 'what happened' in headings:
        return 'behavior'
    return 'other'


def classify_evidence(state_reason: str | None, closer_type: str | None, closer_merged: bool | None,
                      closed_by: str | None, author: str | None, comments: list[dict]) -> str:
    """How a closed issue was closed, from what GitHub records about the closure.

    fix_referenced: closed by a commit or a merged pull request, or someone
      other than the reporter pointed to a commit, a release or the agents'
      "now works" record in a comment.
    duplicate / declined: the stated reason. withdrawn: the reporter closed it.
    no_reference: marked completed with nothing to check it against.
    """
    reason = (state_reason or '').lower()
    if reason == 'duplicate':
        return 'duplicate'
    if closer_type == 'Commit' or (closer_type == 'PullRequest' and closer_merged):
        return 'fix_referenced'
    if any(FIX_REFERENCE.search(c.get('body') or '') for c in comments if c.get('author') != author):
        return 'fix_referenced'
    if closed_by and closed_by == author:
        return 'withdrawn'
    if reason == 'not_planned':
        return 'declined'
    return 'no_reference'


def _date(timestamp: str | None):
    return datetime.fromisoformat(timestamp.replace('Z', '+00:00')).date() if timestamp else None


def fetch_issues_graphql(token: str) -> list[dict]:
    """Every issue with its closing event and recent comments (GraphQL)."""
    owner, name = REPO.split('/')
    issues, cursor = [], None
    while True:
        resp = requests.post(GRAPHQL_URL, headers=get_headers(token), timeout=60,
                             json={'query': ISSUES_QUERY,
                                   'variables': {'owner': owner, 'name': name, 'cursor': cursor}})
        resp.raise_for_status()
        payload = resp.json()
        if payload.get('errors'):
            raise RuntimeError(f"GraphQL: {payload['errors']}")
        page = payload['data']['repository']['issues']
        for node in page['nodes']:
            closed = (node['timelineItems']['nodes'] or [{}])[-1] or {}
            actor, closer = closed.get('actor') or {}, closed.get('closer') or {}
            author = (node.get('author') or {}).get('login')
            labels = [label['name'] for label in node['labels']['nodes']]
            comments = [{'author': (c.get('author') or {}).get('login'), 'body': c.get('body')}
                        for c in node['comments']['nodes']]
            is_closed = node['closedAt'] is not None
            issues.append({
                'created_date': _date(node['createdAt']),
                'closed_date': _date(node['closedAt']),
                'closer_type': ('AI Agent' if is_agent(actor.get('login'), actor.get('__typename')) else 'Human')
                               if is_closed else None,
                'evidence': classify_evidence(node.get('stateReason'), closer.get('__typename'),
                                              closer.get('merged'), actor.get('login'), author,
                                              comments) if is_closed else None,
                'kind': classify_kind(node.get('body'), labels),
                'labelled': bool(labels),
                'reopened': (node.get('reopens') or {}).get('totalCount', 0) > 0,
            })
        if not page['pageInfo']['hasNextPage']:
            return issues
        cursor = page['pageInfo']['endCursor']


def fetch_issues_rest(token: str | None = None) -> list[dict]:
    """Fallback without closing events: evidence rests on the stated reason alone."""
    url = f'https://api.github.com/repos/{REPO}/issues'
    issues, page = [], 1
    while True:
        resp = requests.get(url, headers=get_headers(token), timeout=30,
                            params={'state': 'all', 'per_page': 100, 'page': page, 'direction': 'asc'})
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            return issues
        for item in batch:
            if 'pull_request' in item:
                continue
            closer = item.get('closed_by') or {}
            author = (item.get('user') or {}).get('login')
            labels = [label['name'] for label in item.get('labels', [])]
            is_closed = item.get('closed_at') is not None
            issues.append({
                'created_date': _date(item['created_at']),
                'closed_date': _date(item.get('closed_at')),
                'closer_type': ('AI Agent' if is_agent(closer.get('login'), closer.get('type')) else 'Human')
                               if is_closed else None,
                'evidence': classify_evidence(item.get('state_reason'), None, None,
                                              closer.get('login'), author, []) if is_closed else None,
                'kind': classify_kind(item.get('body'), labels),
                'labelled': bool(labels),
                'reopened': None,  # Not available without the timeline.
            })
        page += 1


def fetch_all_issues_history(token: str | None = None) -> tuple[list[dict], str]:
    """All issues, and which API they came from ('graphql' or 'rest')."""
    if token:
        try:
            return fetch_issues_graphql(token), 'graphql'
        except Exception as error:  # Keep the tracker running on the simpler API.
            print(f'GraphQL fetch failed ({error}); falling back to REST')
    return fetch_issues_rest(token), 'rest'


def daily_rows(issues: list[dict], today) -> list[dict]:
    """Running totals for each UTC day from the first issue to today."""
    start = min((i['created_date'] for i in issues), default=today)
    rows, day = [], start
    while day <= today:
        created = [i for i in issues if i['created_date'] <= day]
        closed = [i for i in issues if i['closed_date'] is not None and i['closed_date'] <= day]
        row = {
            'date': day.strftime('%Y-%m-%d'),
            'open': len(created) - len(closed),
            'agent_closed': sum(1 for i in closed if i['closer_type'] == 'AI Agent'),
            'human_closed': sum(1 for i in closed if i['closer_type'] == 'Human'),
            'behavior_created': sum(1 for i in created if i['kind'] == 'behavior'),
            'behavior_closed': sum(1 for i in closed if i['kind'] == 'behavior'),
        }
        for evidence in EVIDENCE:
            row[f'closed_{evidence}'] = sum(1 for i in closed if i['evidence'] == evidence)
        rows.append(row)
        day += timedelta(days=1)
    return rows


def issue_summary(issues: list[dict], source: str) -> dict:
    """Today's breakdown of open issues, for status.json."""
    open_issues = [i for i in issues if i['closed_date'] is None]
    return {
        'source': source,
        'open': len(open_issues),
        'open_labelled': sum(1 for i in open_issues if i['labelled']),
        'open_by_kind': {kind: sum(1 for i in open_issues if i['kind'] == kind) for kind in KINDS},
        # Issues closed at least once, and how many of those were reopened.
        'ever_closed': sum(1 for i in issues if i['closed_date'] is not None or i.get('reopened')),
        'reopened': (sum(1 for i in issues if i.get('reopened'))
                     if all(i.get('reopened') is not None for i in issues) else None),
    }


def build_full_history_csv(token: str | None = None) -> tuple[dict, dict]:
    """Rebuild data.csv. Returns (the latest row, today's issue summary)."""
    issues, source = fetch_all_issues_history(token)
    rows = daily_rows(issues, datetime.now(timezone.utc).date())
    with open(CSV_FILE, mode='w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    return rows[-1], issue_summary(issues, source)


def _git(*args: str, cwd: str | None = None) -> str:
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True,
                          text=True, timeout=600).stdout


def is_agent_author(name: str, email: str) -> bool:
    """Whether a commit author in the emulator repository is automation."""
    lowered = name.lower()
    return email.lower() in AGENT_AUTHOR_EMAILS or any(word in lowered for word in AGENT_AUTHOR_WORDS)


def update_agent_queue(now: datetime) -> dict | None:
    """Count the agents' own issue queue, kept as files in the emulator repository.

    IssueFinderAgent files problems under issues/things-that-do-not-work/ and
    IssueFixerAgent moves them to issues/things-that-now-work/ with its fix.
    For each day since the repository began, this counts the files in the two
    folders at the day's last commit, and how many "now works" files were
    added by commits whose author is a person rather than automation.

    It uses a commits-only clone: the two folder listings are fetched on
    demand, and file changes are only looked up for commits by people.

    Returns the latest row, or None if the repository could not be read.
    """
    rows = {}
    if os.path.exists(QUEUE_CSV_FILE):
        with open(QUEUE_CSV_FILE, newline='', encoding='utf-8') as f:
            rows = {row['date']: row for row in csv.DictReader(f)}
    today = now.date()
    key = lambda day: day.strftime('%Y-%m-%d')
    try:
        with tempfile.TemporaryDirectory() as clone:
            _git('clone', '--quiet', '--bare', '--filter=tree:0', '--single-branch',
                 f'https://github.com/{REPO}', clone)
            first = _git('log', '--reverse', '--format=%cI', 'HEAD', cwd=clone).splitlines()[0]
            day = datetime.fromisoformat(first).astimezone(timezone.utc).date()
            human_total = 0
            while day <= today:
                recorded = rows.get(key(day))
                # Recorded days are final, except today, which is still moving.
                if recorded and day != today and recorded.get('resolved_by_human') not in (None, ''):
                    human_total = int(recorded['resolved_by_human'])
                    day += timedelta(days=1)
                    continue
                start = datetime.combine(day, datetime.min.time(), timezone.utc)
                end = now if day == today else start + timedelta(days=1) - timedelta(seconds=1)
                stamp = lambda moment: moment.strftime('%Y-%m-%dT%H:%M:%SZ')
                commit = _git('rev-list', '-1', f'--before={stamp(end)}', 'HEAD', cwd=clone).strip()
                if commit:
                    files = _git('ls-tree', '-r', '--name-only', commit, QUEUE_OPEN_DIR, QUEUE_RESOLVED_DIR,
                                 cwd=clone).splitlines()
                    count = lambda folder: sum(1 for name in files
                                               if name.startswith(folder) and name.endswith('.md'))
                    authored = _git('log', '--no-merges', f'--since={stamp(start)}', f'--until={stamp(end)}',
                                    '--format=%H%x09%an%x09%ae', 'HEAD', cwd=clone).splitlines()
                    for line in authored:
                        sha, name, email = line.split('\t')
                        if is_agent_author(name, email):
                            continue
                        changes = _git('show', '--name-status', '--format=', sha, '--', QUEUE_RESOLVED_DIR,
                                       cwd=clone).splitlines()
                        human_total += sum(1 for change in changes if change.startswith('A'))
                    rows[key(day)] = {'date': key(day), 'open': count(QUEUE_OPEN_DIR),
                                      'resolved': count(QUEUE_RESOLVED_DIR),
                                      'resolved_by_human': human_total}
                day += timedelta(days=1)
    except (subprocess.SubprocessError, OSError, ValueError, IndexError) as error:
        print(f'Could not read the agent queue: {error}')
        return None
    if not rows:
        return None
    ordered = [rows[date] for date in sorted(rows)]
    with open(QUEUE_CSV_FILE, mode='w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'open', 'resolved', 'resolved_by_human'])
        writer.writeheader()
        writer.writerows(ordered)
    return ordered[-1]


def agent_share(by_agents: float, total: float) -> float | None:
    """Share of resolutions done by agents; None when nothing was resolved."""
    return by_agents / total if total > 0 else None


def combined_agent_share(public: float | None, queue: float | None,
                         public_weight: float = DEFAULT_PUBLIC_WEIGHT) -> float:
    """Version 2: the two queues' agent shares, weighted. A queue with no
    resolutions yet is left out; with none in either, agents have done nothing."""
    if public is None and queue is None:
        return 0.0
    if public is None:
        return queue
    if queue is None:
        return public
    return public_weight * public + (1 - public_weight) * queue


def generate_trend_chart():
    """Plot separate lines for Open, Agent Closed, Human Closed, and Total Closed."""
    df = pd.read_csv(CSV_FILE)
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date')

    df['total_closed'] = df['agent_closed'] + df['human_closed']

    fig, ax = plt.subplots(figsize=(10, 5))
    
    ax.plot(df['date'], df['open'], label='Open Issues', color='#d9534f', marker='o', linewidth=2, markersize=3)
    ax.plot(df['date'], df['agent_closed'], label='Closed by AI Agent', color='#5cb85c', marker='o', linewidth=2, markersize=4)
    ax.plot(df['date'], df['human_closed'], label='Closed by Human', color='#0275d8', marker='s', linewidth=1.5, markersize=3)
    ax.plot(df['date'], df['total_closed'], label='Total Closed', color='#6c757d', linestyle='--', linewidth=1.5)

    min_date = df['date'].min() - pd.Timedelta(days=WINDOW_PADDING_DAYS)
    max_date = df['date'].max() + pd.Timedelta(days=WINDOW_PADDING_DAYS)
    ax.set_xlim(min_date, max_date)

    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
    ax.xaxis.set_major_locator(mdates.DayLocator(interval=3))

    ax.set_title(f'Agentic Workflow Velocity & Breakdown: {REPO}', fontsize=14, pad=12)
    ax.set_xlabel('Date (UTC)', fontsize=11)
    ax.set_ylabel('Number of Issues', fontsize=11)
    ax.legend(frameon=True, loc='upper left')
    ax.grid(True, linestyle='--', alpha=0.5)
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(CHART_FILE, dpi=150)
    plt.close()

HOURS_ON_CLOCK = 24.0
DOOM_LOOP_WINDOW_DAYS = 7


def hours_to_midnight(agent_closed: int, human_closed: int) -> float:
    """(1 - agent resolution share) x 24: 24h (00:00) with no agent closures, 0 at 100%."""
    total_closed = agent_closed + human_closed
    agent_share = agent_closed / total_closed if total_closed > 0 else 0.0
    return (1.0 - agent_share) * HOURS_ON_CLOCK


def clock_time(hours_left: float) -> str:
    """The time of day the 24-hour clock reads, e.g. '06:00'."""
    minutes = round((HOURS_ON_CLOCK - hours_left) * 60)
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _cron_field(field: str, low: int, high: int) -> list[int]:
    """Expand one cron field (e.g. '*/6', '0,12', '8-18/2') to its values."""
    values = set()
    for part in field.split(','):
        part, _, step = part.partition('/')
        if part == '*':
            start, end = low, high
        elif '-' in part:
            start, end = (int(x) for x in part.split('-'))
        else:
            start = int(part)
            end = high if step else start
        values.update(range(start, end + 1, int(step) if step else 1))
    return sorted(v for v in values if low <= v <= high)


def read_schedule(workflow_file: str = WORKFLOW_FILE) -> dict:
    """Describe the tracker's schedule from the workflow's cron expression."""
    with open(workflow_file, encoding='utf-8') as f:
        match = re.search(r"""^\s*-\s*cron:\s*['"]([^'"]+)['"]""", f.read(), re.MULTILINE)
    if not match:
        raise ValueError(f'No cron schedule found in {workflow_file}')
    cron = match.group(1).strip()
    minute, hour, day, month, weekday = cron.split()

    schedule = {'cron': cron, 'runs_per_day': 0, 'interval_hours': None,
                'description': f'on the schedule "{cron}" (UTC)', 'run_times_utc': []}
    if (day, month, weekday) != ('*', '*', '*'):
        return schedule  # Not an every-day schedule; show the cron as it is.

    times = sorted(h * 60 + m for h in _cron_field(hour, 0, 23) for m in _cron_field(minute, 0, 59))
    gaps = {(b - a) % 1440 or 1440 for a, b in zip(times, times[1:] + times[:1])}
    schedule['runs_per_day'] = len(times)
    schedule['run_times_utc'] = [f'{t // 60:02d}:{t % 60:02d}' for t in times]
    if len(times) == 1:
        schedule['interval_hours'] = 24
        schedule['description'] = 'daily'
    elif len(gaps) == 1:
        gap = gaps.pop()
        schedule['interval_hours'] = gap / 60 if gap % 60 else gap // 60
        if gap == 60:
            schedule['description'] = 'every hour'
        elif gap % 60 == 0:
            schedule['description'] = f'every {gap // 60} hours'
        else:
            schedule['description'] = f'every {gap} minutes'
    else:
        schedule['description'] = f'{len(times)} times a day'
    return schedule


def write_status(now: datetime, schedule: dict, issues: dict | None = None):
    """Record when the data was fetched, the schedule and today's issue breakdown."""
    status = {'updated_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'schedule': schedule,
              'weighting': {'default_public_weight': DEFAULT_PUBLIC_WEIGHT}}
    if issues:
        status['issues'] = issues
    with open(STATUS_FILE, 'w', encoding='utf-8') as f:
        json.dump(status, f, indent=2)
        f.write('\n')


def doom_loop_ratio(now: datetime | None = None,
                    window_days: int = DOOM_LOOP_WINDOW_DAYS) -> tuple[float | None, float]:
    """Issues opened per issue closed over the trailing window, from data.csv.

    Each row holds the totals at the end of its UTC day, except the newest
    while that day is in progress: it was counted at `now`, so the window is
    a fractional number of days.

    Returns (ratio, days). ratio is inf when issues were opened but none closed,
    and None when there is not enough data or nothing happened.
    """
    df = pd.read_csv(CSV_FILE, parse_dates=['date']).sort_values('date')
    if len(df) < 2:
        return None, 0
    last = df.iloc[-1]
    end = last['date'] + pd.Timedelta(days=1)
    if now is not None:
        now_naive = pd.Timestamp(now).tz_convert('UTC').tz_localize(None) if pd.Timestamp(now).tzinfo else pd.Timestamp(now)
        if last['date'] <= now_naive < end:
            end = now_naive
    earlier = df.iloc[:-1]
    older = earlier[earlier['date'] + pd.Timedelta(days=1) <= end - pd.Timedelta(days=window_days)]
    first = older.iloc[-1] if len(older) else df.iloc[0]
    days = (end - (first['date'] + pd.Timedelta(days=1))) / pd.Timedelta(days=1)
    closed = lambda r: r['agent_closed'] + r['human_closed']
    opened = (last['open'] + closed(last)) - (first['open'] + closed(first))
    closed_in_window = closed(last) - closed(first)
    if days < 0.25 or (opened == 0 and closed_in_window == 0):
        return None, days
    if closed_in_window == 0:
        return float('inf'), days
    return opened / closed_in_window, days


def queue_shares(latest: dict, queue: dict | None) -> tuple[float | None, float | None, float]:
    """Agent resolution share of the public issues, of the agents' queue, and combined."""
    public = agent_share(latest['agent_closed'], latest['agent_closed'] + latest['human_closed'])
    own = None
    if queue:
        resolved = int(queue['resolved'])
        own = agent_share(resolved - int(queue.get('resolved_by_human') or 0), resolved)
    return public, own, combined_agent_share(public, own)


def generate_doomsday_clock(latest: dict, queue: dict | None = None):
    """Draw the Developer Doomsday Clock on a 24-hour dial (midnight at the top).

    Version 2: the agent resolution share is combined across the public issues
    and the agents' own queue. The day starts at 00:00 when agents have
    resolved nothing and ends at 24:00 (doom) when agents resolve everything.
    """
    public_share, queue_share, agent_share = queue_shares(latest, queue)
    hours_left = (1.0 - agent_share) * HOURS_ON_CLOCK
    elapsed = HOURS_ON_CLOCK - hours_left
    if hours_left > 18:
        status_color = '#0ca30c'
    elif hours_left >= 12:
        status_color = '#fab219'
    elif hours_left > 4:
        status_color = '#ec835a'
    else:
        status_color = '#d03b3b'
    ink = '#1d1d1b'
    percent = lambda share: 'n/a' if share is None else f'{share*100:.1f}%'

    def at(radius: float, hours: float) -> tuple[float, float]:
        angle = hours / HOURS_ON_CLOCK * 2 * np.pi
        return radius * np.sin(angle), radius * np.cos(angle)

    fig, ax = plt.subplots(figsize=(6, 6.6))
    ax.set_aspect('equal')
    ax.axis('off')

    ax.add_patch(plt.Circle((0, 0), 1.06, color='#f1f0ec'))
    ax.add_patch(plt.Circle((0, 0), 1.0, color='#fcfcfb', ec='#dddcd6', lw=1))

    # Night (18:00-06:00) and the final hour before midnight.
    night = np.linspace(18, 30, 120)
    ax.plot(*zip(*[at(0.78, h) for h in night]), color=ink, lw=10, alpha=0.06, solid_capstyle='butt')
    last_hour = np.linspace(23, 24, 20)
    ax.plot(*zip(*[at(0.78, h) for h in last_hour]), color='#d03b3b', lw=10, alpha=0.35, solid_capstyle='butt')

    # Ring of time left before midnight, from the hour hand round to the top.
    ax.plot(*zip(*[at(0.97, h) for h in np.linspace(0, 24, 240)]), color='#e1e0d9', lw=3)
    if hours_left > 0:
        ring = np.linspace(elapsed, HOURS_ON_CLOCK, max(2, int(hours_left * 10)))
        ax.plot(*zip(*[at(0.97, h) for h in ring]), color=status_color, lw=3, solid_capstyle='round')

    for quarter in range(96):
        hours = quarter / 4
        major, hourly = quarter % 24 == 0, quarter % 4 == 0
        inner = 0.82 if major else 0.86 if hourly else 0.9
        ax.plot(*zip(at(inner, hours), at(0.93, hours)), color=ink,
                lw=2.2 if major else 1.2 if hourly else 0.6, alpha=0.9 if major else 0.6 if hourly else 0.3)
    for hour in range(0, 24, 2):
        x, y = at(0.64, hour)
        major = hour % 6 == 0
        ax.text(x, y, f"{hour:02d}", color=ink, ha='center', va='center',
                fontsize=13 if major else 9, fontweight='bold' if major else 'normal', alpha=1 if major else 0.65)

    ax.text(0, -0.30, 'AI REPLACEMENT INDEX', color='#75736d', fontsize=7, fontweight='bold', ha='center')
    ax.text(0, -0.38, '24-HOUR DIAL', color='#75736d', fontsize=7, fontweight='bold', ha='center')

    # Hands: the hour hand turns once a day.
    ax.plot(*zip((0, 0), at(0.48, elapsed)), color=ink, lw=5, solid_capstyle='round')
    ax.plot(*zip((0, 0), at(0.76, (elapsed % 1) * HOURS_ON_CLOCK)), color=ink, lw=3, solid_capstyle='round')
    ax.plot(0, 0, marker='o', color=ink, markersize=9)
    ax.plot(0, 0, marker='o', color='#d03b3b', markersize=3.5)

    ax.text(0, -1.22, f"{hours_left:.1f} hours to midnight", color=ink, fontsize=17, fontweight='bold', ha='center')
    ax.text(0, -1.36, f"Clock reads {clock_time(hours_left)}", color='#52514e', fontsize=10, ha='center')
    ax.text(0, -1.52, f"Agent share: public issues {percent(public_share)} | agents' queue {percent(queue_share)} | "
            f"combined {agent_share*100:.1f}%",
            color='#666666', fontsize=9, ha='center',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='#f8f9fa', edgecolor='#ddd'))

    ax.set_xlim(-1.2, 1.2)
    ax.set_ylim(-1.62, 1.12)
    plt.title("Developer Doomsday Clock (v2: both queues)", fontsize=14, pad=10, fontweight='bold')
    plt.tight_layout()
    plt.savefig(CLOCK_FILE, dpi=150)
    plt.close()


def update_readme(now: datetime, schedule: dict, latest: dict, queue: dict | None = None):
    open_count, agent_closed, human_count = latest['open'], latest['agent_closed'], latest['human_closed']
    total_closed = agent_closed + human_count
    agent_share = (agent_closed / total_closed * 100) if total_closed > 0 else 0.0
    public_share, queue_share, combined = queue_shares(latest, queue)
    hours_left = (1.0 - combined) * HOURS_ON_CLOCK
    percent = lambda share: 'n/a' if share is None else f'{share*100:.1f}%'
    ratio, ratio_days = doom_loop_ratio(now)
    ratio_days = f'{ratio_days:.1f}'.removesuffix('.0')
    run_times = ', '.join(schedule['run_times_utc'])
    schedule_text = schedule['description'] + (f' ({run_times} UTC)' if run_times else '')
    if ratio is None:
        ratio_text = 'not enough data yet'
    elif ratio == float('inf'):
        ratio_text = f'issues opened, none closed (last {ratio_days} days)'
    else:
        ratio_text = f'{ratio:.1f} opened per issue closed (last {ratio_days} days)'

    queue_text = (f"{int(queue['open']):,} open, {int(queue['resolved']):,} resolved "
                  f"({int(queue.get('resolved_by_human') or 0):,} by people)"
                  if queue else 'not available')

    stats_block = (
        f"<!-- STATS_START -->\n"
        f"**Last Checked:** {now.strftime('%Y-%m-%d %H:%M')} UTC  \n"
        f"**Update Schedule:** {schedule_text}  \n"
        f"- **Developer Doomsday Clock (v2):** {hours_left:.1f} hours to midnight (clock reads {clock_time(hours_left)})  \n"
        f"- **Agent Resolution Share:** {combined*100:.1f}% combined "
        f"(public issues {percent(public_share)}, agents' own queue {percent(queue_share)}, "
        f"weighted {DEFAULT_PUBLIC_WEIGHT:.0%} / {1 - DEFAULT_PUBLIC_WEIGHT:.0%})  \n"
        f"- **Bug Doom Loop Ratio (public issues):** {ratio_text}  \n"
        f"- **Open Issues:** {open_count}  \n"
        f"- **Closed by AI Agent:** {agent_closed}  \n"
        f"- **Closed by Human:** {human_count}  \n"
        f"- **Closures That Reference a Fix:** {latest['closed_fix_referenced']} of {total_closed} "
        f"({latest['closed_no_reference']} without a reference, {latest['closed_declined']} declined, "
        f"{latest['closed_withdrawn']} withdrawn by the reporter, {latest['closed_duplicate']} duplicate)  \n"
        f"- **Agents' Own Queue (in-repo):** {queue_text}\n"
        f"<!-- STATS_END -->"
    )

    if os.path.exists(README_FILE):
        with open(README_FILE, 'r', encoding='utf-8') as f:
            content = f.read()
        if '<!-- STATS_START -->' in content and '<!-- STATS_END -->' in content:
            before = content.split('<!-- STATS_START -->')[0]
            after = content.split('<!-- STATS_END -->')[1]
            with open(README_FILE, 'w', encoding='utf-8') as f:
                f.write(before + stats_block + after)

def main():
    token = os.environ.get('GITHUB_TOKEN')
    now = datetime.now(timezone.utc)
    schedule = read_schedule()

    latest, issues = build_full_history_csv(token)
    queue = update_agent_queue(now)
    write_status(now, schedule, issues)  # also carries the default weighting
    generate_trend_chart()
    generate_doomsday_clock(latest, queue)
    update_readme(now, schedule, latest, queue)

if __name__ == '__main__':
    main()
