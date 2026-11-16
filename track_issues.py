import os
import csv
from datetime import datetime, timedelta, timezone
import requests
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

REPO = 'aws/aws-emulator'
CSV_FILE = 'data.csv'
CHART_FILE = 'issues_chart.png'
README_FILE = 'README.md'
WINDOW_PADDING_DAYS = 14  # 2 weeks either side of start and today

def get_headers(token: str | None = None) -> dict:
    headers = {'Accept': 'application/vnd.github+json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return headers

def fetch_all_issues_history(token: str | None = None) -> list[dict]:
    """Fetch all issues since the repo began to reconstruct daily open/closed counts."""
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
            # GitHub's /issues endpoint includes PRs; skip items with a 'pull_request' key
            if 'pull_request' not in item:
                issues.append({
                    'created_date': datetime.fromisoformat(item['created_at'].replace('Z', '+00:00')).date(),
                    'closed_date': (
                        datetime.fromisoformat(item['closed_at'].replace('Z', '+00:00')).date()
                        if item.get('closed_at') else None
                    )
                })
        page += 1

    return issues

def build_full_history_csv(token: str | None = None) -> tuple[int, int]:
    """Reconstruct day-by-day open and closed issue counts from the first issue to today."""
    issues = fetch_all_issues_history(token)
    today = datetime.now(timezone.utc).date()

    if not issues:
        start_date = today
    else:
        start_date = min(i['created_date'] for i in issues)

    rows = []
    curr_date = start_date
    while curr_date <= today:
        # Cumulative issues created on or before curr_date
        created_so_far = sum(1 for i in issues if i['created_date'] <= curr_date)
        # Cumulative issues closed on or before curr_date
        closed_so_far = sum(
            1 for i in issues
            if i['closed_date'] is not None and i['closed_date'] <= curr_date
        )
        open_on_day = created_so_far - closed_so_far

        rows.append({
            'date': curr_date.strftime('%Y-%m-%d'),
            'open': str(open_on_day),
            'closed': str(closed_so_far)
        })
        curr_date += timedelta(days=1)

    with open(CSV_FILE, mode='w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'open', 'closed'])
        writer.writeheader()
        writer.writerows(rows)

    return int(rows[-1]['open']), int(rows[-1]['closed'])

def generate_chart():
    """Plot continuous line trace with a 2-week padding window on both ends."""
    df = pd.read_csv(CSV_FILE)
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date')

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(df['date'], df['open'], label='Open Issues', color='#d9534f', marker='o', linewidth=2)
    ax.plot(df['date'], df['closed'], label='Closed Issues', color='#5cb85c', marker='o', linewidth=2)

    # Set x-axis moving window: 2 weeks before start date to 2 weeks after today
    min_date = df['date'].min() - pd.Timedelta(days=WINDOW_PADDING_DAYS)
    max_date = df['date'].max() + pd.Timedelta(days=WINDOW_PADDING_DAYS)
    ax.set_xlim(min_date, max_date)

    # Format x-axis ticks cleanly by day/week instead of years
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
    ax.xaxis.set_major_locator(mdates.DayLocator(interval=3))

    ax.set_title(f'Issue Resolution Trend: {REPO}', fontsize=14, pad=12)
    ax.set_xlabel('Date (UTC)', fontsize=11)
    ax.set_ylabel('Number of Issues', fontsize=11)
    ax.legend(frameon=True)
    ax.grid(True, linestyle='--', alpha=0.5)
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(CHART_FILE, dpi=150)
    plt.close()

def update_readme(date_str: str, open_count: int, closed_count: int):
    """Update the summary metrics block inside README.md."""
    total = open_count + closed_count
    close_rate = (closed_count / total * 100) if total > 0 else 0.0

    stats_block = (
        f"<!-- STATS_START -->\n"
        f"**Last Checked:** {date_str} (UTC)  \n"
        f"- **Open Issues:** {open_count}  \n"
        f"- **Closed Issues:** {closed_count}  \n"
        f"- **Resolution Rate:** {close_rate:.1f}%\n"
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
    today_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    # Reconstruct full history from repo inception on every run so the line trace
    # is always complete and reflects any retroactively closed/reopened issues
    open_issues, closed_issues = build_full_history_csv(token)
    generate_chart()
    update_readme(today_str, open_issues, closed_issues)

if __name__ == '__main__':
    main()
