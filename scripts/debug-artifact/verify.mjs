import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, writeFileSync, createReadStream, openSync, readSync, closeSync, readFileSync, mkdtempSync, rmSync, lstatSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { extractFile } = require('@electron/asar');
const base = 'packages/desktop/release';
const dir = path.join(base, 'win-unpacked');
const pkg = JSON.parse(extractFile(path.join(dir, 'resources/app.asar'), 'package.json').toString());
if (pkg.paseoDebug !== true || pkg.paseoPreview !== true || pkg.name !== 'paseo-plus-plus-debug') throw new Error('Debug metadata missing');
if (existsSync(path.join(dir, 'resources/app-update.yml'))) throw new Error('Unexpected updater feed');
for (const name of ['Paseo++ Debug.exe', 'Start-Paseo-Debug.cmd', 'DEBUG-README.txt', 'debug-build-info.json']) if (!existsSync(path.join(dir, name))) throw new Error(`Missing ${name}`);
// Execute configuration only inside the delivered ASAR; never start a daemon or bind a port.
const probeRoot = mkdtempSync(path.join(os.tmpdir(), 'paseo-debug-defaults-'));
try {
  const probe = path.join(probeRoot, 'defaults.mjs');
  writeFileSync(probe, `import { writeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const asar = process.argv[2];
const home = process.argv[3];
const load = (relative) => import(pathToFileURL(asar + '/' + relative).href);
const { desktopDistribution } = await load('dist/distribution.js');
const { daemonDistribution } = await load('node_modules/@getpaseo/server/dist/server/server/daemon-distribution.js');
const { daemonLaunchEnvironment } = await load('node_modules/@getpaseo/server/dist/server/server/config-environment.js');
const { loadConfig } = await load('node_modules/@getpaseo/server/dist/server/server/config.js');
const env = daemonLaunchEnvironment({ mode: 'managed', desktopManaged: true, home, env: { PASEO_LISTEN: '127.0.0.1:6767', PORT: '6767' } });
const config = loadConfig(home, { env });
if (env.PASEO_LISTEN !== undefined || env.PORT !== undefined || config.listen !== '127.0.0.1:6791' || daemonDistribution.defaultPort !== 6791 || desktopDistribution.daemonListen !== config.listen) throw new Error('Packaged managed debug defaults mismatch');
writeSync(1, JSON.stringify({ desktop: desktopDistribution.daemonListen, effectiveListen: config.listen, distribution: daemonDistribution, noServerStarted: true }));
`);
  const output = execFileSync(path.resolve(dir, 'Paseo++ Debug.exe'), [probe, path.resolve(dir, 'resources/app.asar'), path.join(probeRoot, 'home')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30_000,
  });
  const defaults = JSON.parse(output);
  if (defaults.effectiveListen !== '127.0.0.1:6791' || defaults.noServerStarted !== true) throw new Error('Missing packaged default witness');
  writeFileSync(path.join(base, 'debug-managed-defaults.json'), JSON.stringify(defaults, null, 2) + '\n');
} finally { rmSync(probeRoot, { recursive: true, force: true }); }
const zip = readdirSync(base).filter((name) => name.endsWith('windows-x64.zip'));
if (zip.length !== 1) throw new Error('Expected exactly one Windows x64 ZIP');
const executable = openSync(path.join(dir, 'Paseo++ Debug.exe'), 'r');
try {
  const header = Buffer.alloc(64); readSync(executable, header, 0, 64, 0);
  if (header.toString('ascii', 0, 2) !== 'MZ') throw new Error('Invalid Windows executable');
  const pe = Buffer.alloc(6); readSync(executable, pe, 0, 6, header.readUInt32LE(60));
  if (pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664) throw new Error('Expected Windows x64 PE');
} finally { closeSync(executable); }
const info = JSON.parse(readFileSync(path.join(dir, 'debug-build-info.json'), 'utf8'));
if (!/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? '') || info.commit !== process.env.GITHUB_SHA || info.runId !== process.env.GITHUB_RUN_ID || info.version !== pkg.version) throw new Error('Packaged source/build identity mismatch');
async function payloadFiles(root, relative = '') {
  const result = new Map();
  for (const name of readdirSync(path.join(root, relative)).sort()) {
    const key = path.join(relative, name);
    const full = path.join(root, key);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`Unexpected payload symlink ${key}`);
    if (stat.isDirectory()) {
      for (const [file, hash] of await payloadFiles(root, key)) result.set(file, hash);
    } else {
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(full)) digest.update(chunk);
      result.set(key, digest.digest('hex'));
    }
  }
  return result;
}
const unpacked = mkdtempSync(path.join(os.tmpdir(), 'paseo-debug-zip-verify-'));
try {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:PASEO_VERIFY_ZIP -DestinationPath $env:PASEO_VERIFY_DIR -Force'], {
    env: { ...process.env, PASEO_VERIFY_ZIP: path.resolve(base, zip[0]), PASEO_VERIFY_DIR: unpacked }, timeout: 180_000, stdio: 'inherit',
  });
  const expected = await payloadFiles(dir);
  const actual = await payloadFiles(unpacked);
  if (expected.size !== actual.size) throw new Error('ZIP payload file-count mismatch');
  for (const [file, hash] of expected) if (actual.get(file) !== hash) throw new Error(`ZIP payload mismatch: ${file}`);
} finally { rmSync(unpacked, { recursive: true, force: true }); }
const name = zip[0];
const digest = createHash('sha256');
for await (const chunk of createReadStream(path.join(base, name))) digest.update(chunk);
writeFileSync(path.join(base, 'debug-checksums.sha256'), `${digest.digest('hex')}  ${name}\n`);
console.log(`Verified ${name}: isolated metadata, launcher, no updater feed`);
