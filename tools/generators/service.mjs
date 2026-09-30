import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const templateDir = join(root, 'tools', 'generators', 'templates', 'service');
const names = process.argv.slice(2);

if (names.length === 0 || names.some((name) => !/^[a-z][a-z0-9-]*$/.test(name))) {
  console.error('Usage: node tools/generators/service.mjs <kebab-case-name>...');
  process.exit(1);
}

function templates(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) templates(path, found);
    else if (entry.endsWith('.tmpl')) found.push(path);
  }
  return found;
}

const tsconfigPath = join(root, 'tsconfig.json');
const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));

for (const name of names) {
  const target = join(root, 'apps', name);
  if (existsSync(join(target, 'package.json'))) {
    console.log(`skip ${name}: already exists`);
    continue;
  }
  for (const template of templates(templateDir)) {
    const destination = join(target, relative(templateDir, template).replace(/\.tmpl$/, ''));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(template, 'utf8').replaceAll('{{name}}', name));
  }
  const reference = { path: `./apps/${name}` };
  if (!tsconfig.references.some((entry) => entry.path === reference.path)) {
    tsconfig.references.push(reference);
  }
  console.log(`created apps/${name}`);
}

writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
