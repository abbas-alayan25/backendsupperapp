import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const skipped = new Set(['node_modules', 'dist', '.nx', '.git', 'coverage']);
const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const imageWithTag = /^image:\s*(\S+)$/;

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (skipped.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry === 'package.json' || entry === 'docker-compose.yml') found.push(path);
  }
  return found;
}

const problems = [];

for (const file of walk(root)) {
  const name = relative(root, file);
  if (file.endsWith('package.json')) {
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    for (const section of sections) {
      for (const [dependency, version] of Object.entries(manifest[section] ?? {})) {
        if (version === 'workspace:*') continue;
        if (!exactVersion.test(version)) problems.push(`${name}: ${dependency}@${version}`);
      }
    }
    if (manifest.packageManager && !/^pnpm@\d+\.\d+\.\d+$/.test(manifest.packageManager)) {
      problems.push(`${name}: packageManager ${manifest.packageManager}`);
    }
  } else {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = imageWithTag.exec(line.trim());
      if (!match) continue;
      const image = match[1];
      const tag = image.includes('@') ? 'digest' : image.split(':').at(-1);
      if (!image.includes(':') || tag === 'latest') problems.push(`${name}: image ${image}`);
    }
  }
}

if (problems.length > 0) {
  console.error('Unpinned versions found:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('All dependency and image versions are pinned.');
