import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { manageMcp } from './manage-mcp.mjs';
import { PACKAGES, readInstallation } from './runtime-contract.mjs';

async function fixture(t) {
  const pluginRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coohom-pair-'));
  t.after(() => fs.rm(pluginRoot, { recursive: true, force: true }));
  const runtime = path.join(pluginRoot, 'runtime/mcp');
  await fs.mkdir(runtime, { recursive: true });
  for (const name of ['freeform', 'lux3d']) await fs.writeFile(path.join(runtime, `${name}-policy.json`), JSON.stringify({ packageSpec: `${PACKAGES[name]}@latest`, registry: 'https://registry.npmjs.org/' }));
  const calls = [];
  const f = { pluginRoot, runtime, calls, failing: undefined };
  const installers = Object.fromEntries(Object.keys(PACKAGES).map(service => [service, async options => {
    calls.push([service, options.version]);
    if (f.failing === service) throw new Error('npm E503');
    const record = { packageSpec: `${PACKAGES[service]}@${options.version}`, version: options.version === 'latest' ? '2.0.0' : options.version, directory: `${service}/install-fixture` };
    await fs.mkdir(path.join(options.pluginRoot, 'runtime/mcp', record.directory), { recursive: true });
    return record;
  }]));
  f.run = (options = {}) => manageMcp({ pluginRoot, installers, writeLine: () => {}, ...options });
  f.status = () => f.run({ action: 'status' });
  return f;
}
test('two failures require explicit retry then exact pair selection; startup never silently falls back', async t => {
  const f = await fixture(t);
  const old = await f.run();
  f.failing = 'lux3d';
  await assert.rejects(f.run({ action: 'install' }), /Ask the user to retry or stop/);
  assert.deepEqual((await f.status()).pair, old);
  await assert.rejects(readInstallation(f.runtime, 'freeform'), /explicitly retry/);
  const count = f.calls.length;
  await assert.rejects(f.run(), /Ask the user to retry/);
  await assert.rejects(f.run({ action: 'versions', versions: { freeform: '1.0.0', lux3d: '1.0.0' } }), /only after/);
  assert.equal(f.calls.length, count);
  await assert.rejects(f.run({ action: 'retry' }), /Retry also failed/);
  assert.equal((await f.status()).state.attempts, 2);
  await assert.rejects(f.run({ action: 'versions', versions: { freeform: 'latest', lux3d: '1.0.0' } }), /both exact/);
  f.failing = undefined;
  const next = await f.run({ action: 'versions', versions: { freeform: '1.2.3', lux3d: '0.4.5' } });
  assert.equal(next.freeform.version, '1.2.3');
  assert.equal(next.lux3d.version, '0.4.5');
  assert.equal(next.validation, 'installed');
  assert.equal((await readInstallation(f.runtime, 'freeform')).version, '1.2.3');
  await fs.access(path.join(f.runtime, old.freeform.directory));
  assert.deepEqual((await fs.readdir(f.runtime)).filter(name => name.startsWith('.')), []);
});
test('concurrent ensure installs one pair; retry without failure is rejected', async t => {
  const f = await fixture(t);
  const pairs = await Promise.all([f.run(), f.run(), f.run()]);
  assert.equal(new Set(pairs.map(pair => pair.id)).size, 1);
  assert.deepEqual(f.calls, [['freeform', 'latest'], ['lux3d', 'latest']]);
  await assert.rejects(f.run({ action: 'retry' }), /no failed installation/);
});

test('default installation and retry retain the latest Freeform policy', async t => {
  const f = await fixture(t);
  await fs.copyFile(new URL('./freeform-policy.json', import.meta.url), path.join(f.runtime, 'freeform-policy.json'));
  f.failing = 'freeform';
  await assert.rejects(f.run(), /retry or stop/);
  assert.equal((await f.status()).state.requested.freeform, 'latest');
  f.failing = undefined;
  const pair = await f.run({ action: 'retry' });
  assert.equal(pair.freeform.version, '2.0.0');
  assert.deepEqual(f.calls, [['freeform', 'latest'], ['freeform', 'latest'], ['lux3d', 'latest']]);
});
test('failure state survives a new installer destination and cannot be bypassed by --yes', async t => {
  const f = await fixture(t);
  const stateRoot = path.join(f.pluginRoot, 'persistent-state');
  f.failing = 'freeform';
  await assert.rejects(f.run({ action: 'install', stateRoot }), /retry or stop/);
  await assert.rejects(f.run({ action: 'install', stateRoot }), /retry or stop/);
  assert.equal(f.calls.length, 1);
  f.failing = undefined;
  assert.equal((await f.run({ action: 'retry', stateRoot })).freeform.version, '2.0.0');
});

test('another combination cannot silently resolve a different exact version', async t => {
  const f = await fixture(t);
  f.failing = 'freeform';
  await assert.rejects(f.run());
  await assert.rejects(f.run({ action: 'retry' }));
  await assert.rejects(f.run({ action: 'versions', versions: { freeform: '1.0.0', lux3d: '1.0.0' },
    installers: { freeform: async () => ({ packageSpec: 'freeform-modeling-mcp@latest', version: '9.0.0', directory: 'freeform/install-fixture' }) } }), /requested exact version/);
  assert.equal((await f.status()).pair, undefined);
});
