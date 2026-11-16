// Copies the tracker's output (written by track_issues.py at the repository
// root) into public/, where the dashboard fetches it: data.csv, and
// status.json with the last-updated time and schedule. Runs before `dev` and
// `build`, so the site always shows the committed data.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const targetDir = path.join(root, 'public', 'data');
fs.mkdirSync(targetDir, { recursive: true });

// The dashboard works without status.json, but not without the data.
for (const [name, required] of [
  ['data.csv', true],
  ['status.json', false],
] as const) {
  const source = path.resolve(root, '..', name);
  const target = path.join(targetDir, name);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, target);
    console.log(`sync-data: copied ${name}`);
  } else if (required) {
    console.error(`sync-data: ${source} not found`);
    process.exit(1);
  } else {
    fs.rmSync(target, { force: true });
    console.warn(`sync-data: no ${name}; the site will omit the schedule`);
  }
}
