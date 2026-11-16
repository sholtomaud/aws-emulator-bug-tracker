import os
import re
import csv
import json
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

AGENT_IDENTIFIERS = ['agent', 'bot', 'emulator-ai', 'automation', 'github-actions[bot]']

def get_headers(token: str | None = None) -> dict:
    headers = {'Accept': 'application/vnd.github+json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return headers

def categorize_closer(item) -> str:
    """Determine if the entity that closed/resolved the issue is an AI agent or human."""
    closer_info = item.get('closed_by')
    if not closer_info:
        return 'Human'
        
    username = closer_info.get('login', '').lower()
    user_type = closer_info.get('type', '')
    
    is_bot_account = (user_type == 'Bot')
    is_agent_name = any(keyword in username for keyword in AGENT_IDENTIFIERS)
    
    if is_bot_account or is_agent_name:
        return 'AI Agent'
    
    return 'Human'

def fetch_all_issues_history(token: str | None = None) -> list[dict]:
    """Fetch all issues since repo inception."""
    url = f'https://api.github.com/repos/{REPO}/issues'
    headers = get_headers(token)
    issues = []
    page = 1

    while True:
        params = {
            'state': 'all',
            'per_page': 100,
            'page': page,
            'direction': 'asc'
        }
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break

        for item in batch:
            if 'pull_request' not in item:
                closed_at = item.get('closed_at')
                closer_type = categorize_closer(item) if closed_at else None
                
                issues.append({
                    'created_date': datetime.fromisoformat(item['created_at'].replace('Z', '+00:00')).date(),
                    'closed_date': datetime.fromisoformat(closed_at.replace('Z', '+00:00')).date() if closed_at else None,
                    'closer_type': closer_type
                })
        page += 1

    return issues

def build_full_history_csv(token: str | None = None) -> tuple[int, int, int]:
    """Reconstruct daily metrics."""
    issues = fetch_all_issues_history(token)
    today = datetime.now(timezone.utc).date()

    if not issues:
        start_date = today
    else:
        start_date = min(i['created_date'] for i in issues)

    rows = []
    curr_date = start_date
    while curr_date <= today:
        created_so_far = sum(1 for i in issues if i['created_date'] <= curr_date)
        
        closed_by_agent = sum(
            1 for i in issues
            if i['closed_date'] is not None and i['closed_date'] <= curr_date and i['closer_type'] == 'AI Agent'
        )
        closed_by_human = sum(
            1 for i in issues
            if i['closed_date'] is not None and i['closed_date'] <= curr_date and i['closer_type'] == 'Human'
        )
        total_closed = closed_by_agent + closed_by_human
        open_on_day = created_so_far - total_closed

        rows.append({
            'date': curr_date.strftime('%Y-%m-%d'),
            'open': str(open_on_day),
            'agent_closed': str(closed_by_agent),
            'human_closed': str(closed_by_human)
        })
        curr_date += timedelta(days=1)

    with open(CSV_FILE, mode='w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'open', 'agent_closed', 'human_closed'])
        writer.writeheader()
        writer.writerows(rows)

    last_row = rows[-1]
    return int(last_row['open']), int(last_row['agent_closed']), int(last_row['human_closed'])

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


def write_status(now: datetime, schedule: dict):
    """Record when the data was fetched and the schedule, for the dashboard."""
    with open(STATUS_FILE, 'w', encoding='utf-8') as f:
        json.dump({'updated_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'schedule': schedule}, f, indent=2)
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


def generate_doomsday_clock(open_count: int, agent_closed: int, human_count: int):
    """Draw the Developer Doomsday Clock on a 24-hour dial (midnight at the top).

    The day starts at 00:00 when agents have closed nothing and ends at 24:00
    (doom) when agents close every issue.
    """
    total_closed = agent_closed + human_count
    agent_share = agent_closed / total_closed if total_closed > 0 else 0.0
    hours_left = hours_to_midnight(agent_closed, human_count)
    elapsed = HOURS_ON_CLOCK - hours_left
    if hours_left > 18:
        status_color = '#0ca30c'
    elif hours_left > 12:
        status_color = '#fab219'
    elif hours_left > 4:
        status_color = '#ec835a'
    else:
        status_color = '#d03b3b'
    ink = '#1d1d1b'

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
    ax.text(0, -1.52, f"AI Closed: {agent_closed} | Human Closed: {human_count} | Agent Share: {agent_share*100:.1f}%",
            color='#666666', fontsize=9, ha='center',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='#f8f9fa', edgecolor='#ddd'))

    ax.set_xlim(-1.2, 1.2)
    ax.set_ylim(-1.62, 1.12)
    plt.title("Developer Doomsday Clock: Replacement Risk", fontsize=14, pad=10, fontweight='bold')
    plt.tight_layout()
    plt.savefig(CLOCK_FILE, dpi=150)
    plt.close()


def update_readme(now: datetime, schedule: dict, open_count: int, agent_closed: int, human_count: int):
    total_closed = agent_closed + human_count
    agent_share = (agent_closed / total_closed * 100) if total_closed > 0 else 0.0
    hours_left = hours_to_midnight(agent_closed, human_count)
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

    stats_block = (
        f"<!-- STATS_START -->\n"
        f"**Last Checked:** {now.strftime('%Y-%m-%d %H:%M')} UTC  \n"
        f"**Update Schedule:** {schedule_text}  \n"
        f"- **Doomsday Clock Index:** {hours_left:.1f} hours to midnight (clock reads {clock_time(hours_left)})  \n"
        f"- **Bug Doom Loop Ratio:** {ratio_text}  \n"
        f"- **Open Issues:** {open_count}  \n"
        f"- **Closed by AI Agent:** {agent_closed}  \n"
        f"- **Closed by Human:** {human_count}  \n"
        f"- **Agent Resolution Share:** {agent_share:.1f}%\n"
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

    open_issues, agent_closed, human_closed = build_full_history_csv(token)
    write_status(now, schedule)
    generate_trend_chart()
    generate_doomsday_clock(open_issues, agent_closed, human_closed)
    update_readme(now, schedule, open_issues, agent_closed, human_closed)

if __name__ == '__main__':
    main()
