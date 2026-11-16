// test/package.test.mjs — the package as its design has it (S375): one runtime dependency, the core, whose library, CLI and
// manifest the view layer reaches through package.json "imports" (#ltms, #ltms/cli, #ltms/package.json), each mapped into
// that dependency; and the command package.json names, which, before the screen, prints its usage and exits 2.
// Every run of the command here is given a folder of this test's own (CLAUDE_CONFIG_DIR too), never the user's projects.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const CORE = 'long-term-memory-structure';

test('one runtime dependency, the core; every #ltms import resolves into it', () => {
  assert.deepEqual(pkg.dependencies, { [CORE]: '^0.3.0' });
  assert.equal(pkg.optionalDependencies, undefined);
  assert.equal(pkg.peerDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.imports).sort(), ['#ltms', '#ltms/cli', '#ltms/package.json']);
  // resolved as the view layer resolves them, from a file in src/; each lands inside the installed core
  const fromSrc = createRequire(path.join(root, 'src', 'x.mjs'));
  const coreDir = path.dirname(createRequire(import.meta.url).resolve(`${CORE}/package.json`));
  for (const key of Object.keys(pkg.imports)) {
    const at = fromSrc.resolve(key);
    assert.ok(at.startsWith(`${coreDir}${path.sep}`), `${key} resolves to ${at}, outside ${coreDir}`);
  }
  assert.equal(JSON.parse(readFileSync(fromSrc.resolve('#ltms/package.json'), 'utf8')).name, CORE);
  assert.match(createRequire(import.meta.url)(`${CORE}/package.json`).version, /^0\.3\.\d+$/, 'the installed core is in the range package.json declares');
});

test('the command, before the screen: its usage on stderr, nothing on stdout, exit 2, whatever it is given', () => {
  assert.deepEqual(pkg.bin, { 'ltms-reader': 'bin/ltms-reader.mjs' });
  const bin = path.join(root, pkg.bin['ltms-reader']);
  assert.equal(readFileSync(bin, 'utf8').split('\n')[0], '#!/usr/bin/env node');
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-bin-'));
  try {
    for (const args of [[], ['--help'], [own], [path.join(root, 'test', 'fixtures', 'ltms', 'demo.jsonl')]]) {
      const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: own } });
      assert.equal(r.status, 2, `${JSON.stringify(args)}: exit`);
      assert.equal(r.stdout, '', `${JSON.stringify(args)}: stdout`);
      assert.match(r.stderr, /^usage: ltms-reader /, `${JSON.stringify(args)}: stderr`);
    }
  } finally { rmSync(own, { recursive: true, force: true }); }
});
