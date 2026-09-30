import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const scanned = ['apps', 'libs'];
const skipped = new Set(['node_modules', 'dist', '.nx', 'coverage', 'gen']);
const commentPatterns = {
  '.go': /^\s*(\/\/|\/\*)/,
  '.proto': /^\s*(\/\/|\/\*)/,
};

function walk(dir, found = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (skipped.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (extname(path) in commentPatterns) found.push(path);
  }
  return found;
}

const problems = [];
for (const base of scanned) {
  for (const file of walk(join(root, base))) {
    const pattern = commentPatterns[extname(file)];
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (pattern.test(line)) problems.push(`${relative(root, file)}:${index + 1}`);
      });
  }
}

if (problems.length > 0) {
  console.error('Comments found in Go/proto sources:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('No comments in Go or proto sources.');
