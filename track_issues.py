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
WINDOW_PADDING_DAYS = 14

# Broadened identifiers to catch bots, GitHub Actions, and agent usernames
AGENT_IDENTIFIERS = ['agent', 'bot', 'emulator-ai', 'automation', 'github-actions[bot]']

def get_headers(token: str | None = None) -> dict:
    headers = {'Accept': 'application/vnd.github+json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return headers

def categorize_closer(item) -> str:
    """Determine if the entity that closed/resolved the issue is an AI agent or human."""
    closer_info = item.get('closed_by')
    
    # Also check events/labels if available, or fall back to username patterns
    if not closer_info:
        # If closed via commit/PR merge without explicit closed_by user object in search API, 
        # check if title/body or labels hint at agent work (customizable for your setup)
        return 'Human'
        
    username = closer_info.get('login', '').lower()
    user_type = closer_info.get('type', '') # 'User' or 'Bot'
    
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

def generate_chart():
    """Plot separate lines for Open, Agent Closed, Human Closed, and Total Closed."""
    df = pd.read_csv(CSV_FILE)
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date')

    # Calculate total closed for an aggregate comparison line
    df['total_closed'] = df['agent_closed'] + df['human_closed']

    fig, ax = plt.subplots(figsize=(10, 5))
    
    # Plot distinct traces
    ax.plot(df['date'], df['open'], label='Open Issues', color='#d9534f', marker='o', linewidth=2, markersize=3)
    ax.plot(df['date'], df['agent_closed'], label='Closed by AI Agent', color='#5cb85c', marker='o', linewidth=2, markersize=4)
    ax.plot(df['date'], df['human_closed'], label='Closed by Human', color='#0275d8', marker='s', linewidth=1.5, markersize=3)
    ax.plot(df['date'], df['total_closed'], label='Total Closed', color='#6c757d', linestyle='--', linewidth=1.5)

    # Set x-axis window with padding
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

def update_readme(date_str: str, open_count: int, agent_closed: int, human_count: int):
    total_closed = agent_closed + human_count
    agent_share = (agent_closed / total_closed * 100) if total_closed > 0 else 0.0

    stats_block = (
        f"<!-- STATS_START -->\n"
        f"**Last Checked:** {date_str} (UTC)  \n"
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
    today_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    open_issues, agent_closed, human_closed = build_full_history_csv(token)
    generate_chart()
    update_readme(today_str, open_issues, agent_closed, human_closed)

if __name__ == '__main__':
    main()
