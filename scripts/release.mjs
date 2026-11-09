#!/usr/bin/env node
// Prepares and publishes a release:
//   npm run release -- 0.3.0          (or: patch | minor | major)
//   npm run release -- minor --skip-tests
// 1. checks: on main, nothing else uncommitted, the tag does not exist yet; runs typecheck and tests
// 2. sets the version in the package.json / package-lock.json files and in server/src/config.ts
// 3. moves the "Unreleased" changelog entries under "## [x.y.z]" (the notes are written by you)
// 4. waits for Enter, checks the notes, then commits "Release x.y.z", tags vx.y.z and pushes both
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

// ---------- changelog: "Unreleased" becomes "## [x.y.z]", with a new empty "Unreleased" above

const eol = read(CHANGELOG).includes('\r\n') ? '\r\n' : '\n';
const lines = read(CHANGELOG).replace(/\r\n/g, '\n').split('\n');
if (!lines.some((l) => l.startsWith(`## [${version}]`))) {
  const unreleased = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l));
  const firstRelease = lines.findIndex((l) => l.startsWith('## [') && !/^## \[Unreleased\]/i.test(l));
  if (unreleased >= 0) {
    lines.splice(unreleased, 1, '## [Unreleased]', '', `## [${version}]`);
  } else {
    const at = firstRelease >= 0 ? firstRelease : lines.length;
    lines.splice(at, 0, '## [Unreleased]', '', `## [${version}]`, '', '');
  }
  write(CHANGELOG, lines.join(eol));
}

// ---------- notes, then commit, tag and push

console.log(`
Version ${version} is set everywhere and CHANGELOG.md has a "## [${version}]" section.
Write the release notes there (Added / Changed / Fixed), save the file, then:
  Enter   commit "Release ${version}", tag ${tag} and push ${BRANCH} and the tag to ${REMOTE}
  Ctrl+C  stop here (run the script again later, or undo with: git checkout -- ${FILES.join(' ')})`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
let notesReady = false;
rl.on('SIGINT', () => {
  console.log('\nStopped: nothing was committed.');
  process.exit(130);
});
// without this, a closed input (no terminal) would leave the question pending forever
rl.on('close', () => {
  if (!notesReady) fail('input closed before the notes were ready: nothing was committed (run the script again to go on)');
});
for (;;) {
  await rl.question('\nPress Enter when the notes are ready... ');
  const check = run('node', ['scripts/release-notes.mjs', tag, '--check'], { quiet: true, allowFail: true });
  if (check.ok) break;
  console.log(check.err || check.out);
}
notesReady = true;
rl.close();

const section = run('node', ['scripts/release-notes.mjs', tag], { quiet: true }).out.split('\n---\n')[0].trim();
console.log(`\nRelease notes of ${tag}:\n\n${section}\n`);

git('add', '--', ...FILES);
git('commit', '-m', `Release ${version}`);
git('tag', '-a', tag, '-m', `MTG RePrint ${version}`);
console.log(`Committed and tagged ${tag}. Pushing...`);
run('git', ['push', '--atomic', REMOTE, BRANCH, tag]);
console.log(`\nDone: ${tag} is on ${REMOTE}. The release workflow now builds the executables and publishes the release.`);
