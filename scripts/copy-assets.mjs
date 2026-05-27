#!/usr/bin/env node
/**
 * Post-build: copy runtime assets that tsc doesn't emit (YAML configs,
 * SQL migrations) into dist/ so the built CLI can find them at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

const tasks = [
  ['config/default.yaml', 'dist/config/default.yaml', 'file'],
  ['migrations', 'dist/migrations', 'dir'],
];

for (const [src, dst, kind] of tasks) {
  const from = path.join(ROOT, src);
  const to = path.join(ROOT, dst);
  if (!fs.existsSync(from)) {
    console.error(`skip: ${src} (missing)`);
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (kind === 'dir') {
    fs.rmSync(to, { recursive: true, force: true });
    copyDirRecursive(from, to);
  } else {
    fs.copyFileSync(from, to);
  }
  console.log(`copied ${src} → ${dst}`);
}
