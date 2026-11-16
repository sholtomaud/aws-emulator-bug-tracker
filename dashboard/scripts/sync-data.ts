// Copies the tracker's data.csv (written daily by track_issues.py at the
// repository root) into public/, where the dashboard fetches it. Runs before
// `dev` and `build`, so the site always shows the committed data.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(root, '..', 'data.csv');
const target = path.join(root, 'public', 'data', 'data.csv');

if (!fs.existsSync(source)) {
  console.error(`sync-data: ${source} not found`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log(
  `sync-data: copied ${path.relative(root, source)} -> ${path.relative(root, target)}`
);
