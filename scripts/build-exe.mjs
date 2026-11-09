#!/usr/bin/env node
// Builds the standalone executable (Node "single executable application"):
//   1. builds the Angular app (skip with --skip-web-build)
//   2. bundles the server into one CommonJS file with esbuild
//   3. embeds the web app files as SEA assets
//   4. copies the running `node` binary and injects the blob into it with postject
// The result is dist/mtg-reprint (or dist/mtg-reprint.exe), for the OS and CPU you build on.
import { execFileSync, execSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    'skip-web-build': { type: 'boolean', default: false },
    'web-dist': { type: 'string', default: path.join(root, 'web', 'dist', 'web', 'browser') },
    'out-dir': { type: 'string', default: path.join(root, 'dist') },
    'no-inject': { type: 'boolean', default: false },
  },
});

const buildDir = path.join(root, 'build');
const outDir = values['out-dir'];
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const exeName = isWindows ? 'mtg-reprint.exe' : 'mtg-reprint';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
// npm is a .cmd script on Windows, which only a shell can start: pass one fixed command line
// (passing an argument list together with `shell` is deprecated, DEP0190)
const runNpm = (commandLine, opts = {}) => execSync(`npm ${commandLine}`, { stdio: 'inherit', ...opts });

function filesIn(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesIn(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

// 1. web app
if (!values['skip-web-build']) runNpm('--prefix web run build', { cwd: root });
const webDist = values['web-dist'];
if (!existsSync(path.join(webDist, 'index.html'))) {
  throw new Error(`No web app in ${webDist}. Run "npm run build" first (or drop --skip-web-build).`);
}

// 2. server bundle
rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
const { build } = await import('esbuild');
await build({
  entryPoints: [path.join(root, 'server', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs', // Node 22 can only run a CommonJS script as the main script of an executable
  target: 'node22',
  outfile: path.join(buildDir, 'server.cjs'),
  define: { 'import.meta.url': '"file:///mtg-reprint/server.cjs"' }, // only used when running from the sources
  logLevel: 'warning',
});

// 3. assets and SEA configuration
const names = filesIn(webDist);
const assets = { 'manifest.json': path.join(buildDir, 'manifest.json') };
writeFileSync(assets['manifest.json'], JSON.stringify(names));
for (const name of names) assets[`web/${name}`] = path.join(webDist, ...name.split('/'));
const blob = path.join(buildDir, 'sea-prep.blob');
const seaConfig = path.join(buildDir, 'sea-config.json');
writeFileSync(
  seaConfig,
  JSON.stringify({ main: path.join(buildDir, 'server.cjs'), output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, assets }, null, 2),
);
run(process.execPath, ['--experimental-sea-config', seaConfig]);
console.log(`Blob: ${blob} (${(statSync(blob).size / 1e6).toFixed(1)} MB, ${names.length} web files)`);
if (values['no-inject']) process.exit(0);

// 4. executable
mkdirSync(outDir, { recursive: true });
const exe = path.join(outDir, exeName);
copyFileSync(process.execPath, exe);
if (!isWindows) chmodSync(exe, 0o755);
if (isMac) run('codesign', ['--remove-signature', exe]);
const { inject } = await import('postject');
await inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(isMac ? { machoSegmentName: 'NODE_SEA' } : {}),
});
if (isMac) run('codesign', ['--sign', '-', exe]);
console.log(`Executable: ${exe}`);
