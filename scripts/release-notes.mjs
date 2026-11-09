#!/usr/bin/env node
// Checks that a release tag matches the version everywhere, then prints the release notes:
// the CHANGELOG.md section of that version plus a short standard footer.
//   node scripts/release-notes.mjs v0.2.0            -> notes on stdout
//   node scripts/release-notes.mjs v0.2.0 --check    -> only the checks
// Exits with an error (and says what to fix) if something does not match.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const fail = (message) => {
  console.error(`release-notes: ${message}`);
  process.exit(1);
};

const tag = process.argv[2] ?? '';
const version = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)?.[1];
if (!version) fail(`"${tag}" is not a release tag such as v1.2.3`);

const found = {
  'package.json': JSON.parse(read('package.json')).version,
  'server/package.json': JSON.parse(read('server/package.json')).version,
  'web/package.json': JSON.parse(read('web/package.json')).version,
  'server/src/config.ts': /export const VERSION = '([^']+)'/.exec(read('server/src/config.ts'))?.[1],
};
const wrong = Object.entries(found).filter(([, v]) => v !== version);
if (wrong.length) {
  fail(`tag ${tag} but ${wrong.map(([file, v]) => `${file} has ${v ?? 'no version'}`).join(', ')}: update them first`);
}

// the "## [x.y.z]" section of the changelog, up to the next "## [" heading
const lines = read('CHANGELOG.md').replace(/\r\n/g, '\n').split('\n');
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start < 0) fail(`CHANGELOG.md has no "## [${version}]" section`);
const end = lines.findIndex((l, i) => i > start && l.startsWith('## ['));
const notes = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
if (!notes) fail(`the "## [${version}]" section of CHANGELOG.md is empty`);

if (process.argv.includes('--check')) {
  console.log(`release-notes: ${tag} matches every version and has changelog notes`);
  process.exit(0);
}

console.log(`${notes}

---

**Download** the file for your system below, unpack it and run \`mtg-reprint\`: your browser opens at http://localhost:3210. The executables are not code-signed, so Windows SmartScreen or macOS Gatekeeper may warn you the first time. See the README for how to run it from the sources instead.

**Built with AI assistance**: this project was written with substantial help from an AI assistant (Claude, by Anthropic). See the README for details.

Unofficial fan tool, not affiliated with Wizards of the Coast or Scryfall. For personal use such as playtesting: no selling, no sanctioned tournaments.`);
