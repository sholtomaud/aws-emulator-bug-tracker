import os
import csv
from datetime import datetime, timezone
import requests
import pandas as pd
import matplotlib.pyplot as plt

REPO = 'aws/aws-emulator'
CSV_FILE = 'data.csv'
CHART_FILE = 'issues_chart.png'
README_FILE = 'README.md'

def get_issue_count(state: str, token: str | None = None) -> int:
    """Query GitHub Search API for exact issue count (excluding PRs)."""
    url = 'https://api.github.com/search/issues'
    headers = {'Accept': 'application/vnd.github+json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    
    # per_page=1 minimizes payload while returning the exact total_count
    params = {
        'q': f'repo:{REPO} is:issue state:{state}',
        'per_page': 1
    }
    response = requests.get(url, headers=headers, params=params, timeout=30)
    response.raise_for_status()
    return response.json()['total_count']

def update_csv(date_str: str, open_count: int, closed_count: int):
    """Append or update today's issue counts in the CSV log."""
    rows = []
    file_exists = os.path.isfile(CSV_FILE)
    
    if file_exists:
        with open(CSV_FILE, mode='r', newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            
    # Update existing entry if run multiple times on the same UTC day
    updated = False
    for row in rows:
        if row['date'] == date_str:
            row['open'] = str(open_count)
            row['closed'] = str(closed_count)
            updated = True
            break
            
    if not updated:
        rows.append({
            'date': date_str,
            'open': str(open_count),
            'closed': str(closed_count)
        })
        
    with open(CSV_FILE, mode='w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'open', 'closed'])
        writer.writeheader()
        writer.writerows(rows)

def generate_chart():
    """Plot open vs. closed issues over time and save as PNG."""
    df = pd.read_csv(CSV_FILE)
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date')

    plt.figure(figsize=(10, 5))
    plt.plot(df['date'], df['open'], label='Open Issues', color='#d9534f', marker='o', linewidth=2)
    plt.plot(df['date'], df['closed'], label='Closed Issues', color='#5cb85c', marker='o', linewidth=2)

    plt.title(f'Issue Resolution Trend: {REPO}', fontsize=14, pad=12)
    plt.xlabel('Date (UTC)', fontsize=11)
    plt.ylabel('Number of Issues', fontsize=11)
    plt.legend(frameon=True)
    plt.grid(True, linestyle='--', alpha=0.5)
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
            new_content = before + stats_block + after
            with open(README_FILE, 'w', encoding='utf-8') as f:
                f.write(new_content)

def main():
    token = os.environ.get('GITHUB_TOKEN')
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    open_issues = get_issue_count('open', token)
    closed_issues = get_issue_count('closed', token)
    
    update_csv(today, open_issues, closed_issues)
    generate_chart()
    update_readme(today, open_issues, closed_issues)

if __name__ == '__main__':
    main()
