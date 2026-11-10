#!/usr/bin/env node
// Prepares and publishes a release:
//   npm run release -- 0.3.0          (or: patch | minor | major)
//   npm run release -- minor --skip-tests
// 1. checks: on main, nothing else uncommitted, the tag does not exist yet; runs typecheck and tests
// 2. sets the version in the package.json / package-lock.json files and in server/src/config.ts
// 3. renames "## [Unreleased]" in CHANGELOG.md to "## [x.y.z]" (no empty "Unreleased" is left);
//    without it, adds an empty "## [x.y.z]" and waits for the notes to be written there
// 4. shows the notes and waits for Enter, checks them again, then commits "Release x.y.z",
//    tags vx.y.z and pushes both
// Running it again after an interruption picks up where it stopped.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = 'main';
const REMOTE = 'origin';
const PACKAGE_DIRS = ['.', 'server', 'web'];
const CONFIG = 'server/src/config.ts';
const CHANGELOG = 'CHANGELOG.md';
/** The files this script changes: the only ones allowed to be uncommitted. */
const FILES = [
  ...PACKAGE_DIRS.flatMap((dir) => [path.posix.join(dir, 'package.json'), path.posix.join(dir, 'package-lock.json')]),
  CONFIG,
  CHANGELOG,
];

const fail = (message) => {
  console.error(`\nrelease: ${message}`);
  process.exit(1);
};
const file = (name) => path.join(root, name);
const read = (name) => readFileSync(file(name), 'utf8');
const write = (name, text) => writeFileSync(file(name), text);

/** Run a command; with `quiet` its output is returned instead of shown. */
function run(command, args, { quiet = false, allowFail = false } = {}) {
  const options = { cwd: root, encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' };
  // npm is a .cmd on Windows, which needs a shell; its arguments here are fixed words, safe to join
  const res =
    process.platform === 'win32' && command === 'npm'
      ? spawnSync([command, ...args].join(' '), { ...options, shell: true })
      : spawnSync(command, args, options);
  if (res.error) fail(`could not run ${command}: ${res.error.message}`);
  if (res.status !== 0 && !allowFail) {
    fail(`"${command} ${args.join(' ')}" failed${quiet ? `:\n${(res.stderr || res.stdout).trim()}` : ''}`);
  }
  return { ok: res.status === 0, out: (res.stdout ?? '').trim(), err: (res.stderr ?? '').trim() };
}
const git = (...args) => run('git', args, { quiet: true }).out;

// ---------- the version to release

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const current = JSON.parse(read('package.json')).version;
const args = process.argv.slice(2);
const wanted = args.find((a) => !a.startsWith('--'));
const skipTests = args.includes('--skip-tests');
if (!wanted) fail('say which version: npm run release -- <x.y.z | patch | minor | major>');

function nextVersion(spec) {
  const m = SEMVER.exec(current);
  if (!m) fail(`the current version "${current}" is not x.y.z`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (spec === 'major') return `${major + 1}.0.0`;
  if (spec === 'minor') return `${major}.${minor + 1}.0`;
  if (spec === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (!SEMVER.test(spec)) fail(`"${spec}" is not a version such as 1.2.3, nor patch / minor / major`);
  return spec;
}
const isNewer = (a, b) => {
  const [x, y] = [a, b].map((v) => SEMVER.exec(v).slice(1).map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

const version = nextVersion(wanted);
const tag = `v${version}`;
// the same version as now is accepted: a release that was interrupted after the version change
if (version !== current && !isNewer(version, current)) fail(`${version} is not newer than the current ${current}`);

// ---------- checks

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== BRANCH) fail(`you are on "${branch}": releases are made from ${BRANCH}`);
// "XY path" entries separated by NUL (not trimmed: the first column may be a space)
const status = spawnSync('git', ['status', '--porcelain', '-z'], { cwd: root, encoding: 'utf8' }).stdout ?? '';
const others = status
  .split('\0')
  .filter((entry) => entry.length > 3)
  .map((entry) => entry.slice(3))
  .filter((name) => !FILES.includes(name));
if (others.length) fail(`commit or stash these changes first:\n  ${others.join('\n  ')}`);
if (run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { quiet: true, allowFail: true }).ok) {
  fail(`the tag ${tag} already exists`);
}
console.log(`Checking ${REMOTE}...`);
run('git', ['fetch', '--quiet', REMOTE, BRANCH]);
if (git('ls-remote', '--tags', REMOTE, `refs/tags/${tag}`)) fail(`the tag ${tag} already exists on ${REMOTE}`);
const [behind] = git('rev-list', '--left-right', '--count', `${REMOTE}/${BRANCH}...HEAD`).split(/\s+/).map(Number);
if (behind > 0) fail(`${BRANCH} is ${behind} commit(s) behind ${REMOTE}: pull first`);

if (skipTests) {
  console.log('Skipping typecheck and tests (--skip-tests).');
} else {
  console.log('\nTypecheck and tests...');
  run('npm', ['run', 'typecheck']);
  run('npm', ['test']);
}

// ---------- versions

function setPackageVersion(name) {
  const data = JSON.parse(read(name));
  data.version = version;
  if (data.packages?.['']) data.packages[''].version = version; // package-lock.json
  write(name, `${JSON.stringify(data, null, 2)}\n`);
}
for (const dir of PACKAGE_DIRS) {
  setPackageVersion(path.posix.join(dir, 'package.json'));
  setPackageVersion(path.posix.join(dir, 'package-lock.json'));
}
const config = read(CONFIG);
if (!/export const VERSION = '[^']*';/.test(config)) fail(`no "export const VERSION = '...'" in ${CONFIG}`);
write(CONFIG, config.replace(/export const VERSION = '[^']*';/, `export const VERSION = '${version}';`));

// ---------- changelog: "## [Unreleased]" becomes "## [x.y.z]" (no empty "Unreleased" is left)

const eol = read(CHANGELOG).includes('\r\n') ? '\r\n' : '\n';
const lines = read(CHANGELOG).replace(/\r\n/g, '\n').split('\n');
if (!lines.some((l) => l.startsWith(`## [${version}]`))) {
  const unreleased = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l));
  if (unreleased >= 0) {
    lines[unreleased] = `## [${version}]`;
  } else {
    // no notes written during development: an empty section, to be filled below
    const firstRelease = lines.findIndex((l) => l.startsWith('## ['));
    lines.splice(firstRelease >= 0 ? firstRelease : lines.length, 0, `## [${version}]`, '', '');
  }
  write(CHANGELOG, lines.join(eol));
}

// ---------- notes, then commit, tag and push

const checkNotes = () => run('node', ['scripts/release-notes.mjs', tag, '--check'], { quiet: true, allowFail: true });
const undo = `git checkout -- ${FILES.join(' ')}`;

const rl = createInterface({ input: process.stdin, output: process.stdout });
let confirmed = false;
rl.on('SIGINT', () => {
  console.log('\nStopped: nothing was committed.');
  process.exit(130);
});
// without this, a closed input (no terminal) would leave the question pending forever
rl.on('close', () => {
  if (!confirmed) fail('input closed before the release was confirmed: nothing was committed (run the script again to go on)');
});

let check = checkNotes();
if (!check.ok) {
  console.log(`
The "## [${version}]" section of CHANGELOG.md has no notes yet. Write them there
(Added / Changed / Fixed) and save the file. Ctrl+C stops here (run the script again later,
or undo with: ${undo}).`);
  while (!check.ok) {
    console.log(check.err || check.out);
    await rl.question('\nPress Enter when the notes are ready... ');
    check = checkNotes();
  }
}

const section = run('node', ['scripts/release-notes.mjs', tag], { quiet: true }).out.split('\n---\n')[0].trim();
console.log(`\nVersion ${version} is set everywhere. Release notes of ${tag}:\n\n${section}\n`);
console.log('Changed files (review them now, e.g. with git diff; edits made before Enter are included):');
run('git', ['diff', '--stat', '--', ...FILES]);
console.log('');
await rl.question(
  `Enter   commit "Release ${version}", tag ${tag} and push ${BRANCH} and the tag to ${REMOTE}\n` +
    `Ctrl+C  stop here (run the script again later, or undo with: ${undo})\n`,
);
check = checkNotes(); // CHANGELOG.md may have been edited while waiting
if (!check.ok) fail(`${check.err || check.out}\nnothing was committed: fix the notes and run the script again`);
confirmed = true;
rl.close();

git('add', '--', ...FILES);
git('commit', '-m', `Release ${version}`);
git('tag', '-a', tag, '-m', `MTG RePrint ${version}`);
console.log(`Committed and tagged ${tag}. Pushing...`);
run('git', ['push', '--atomic', REMOTE, BRANCH, tag]);
console.log(`\nDone: ${tag} is on ${REMOTE}. The release workflow now builds the executables and publishes the release.`);
