// test/package.test.mjs — the package as its design has it (S375): one runtime dependency, the core, whose library, CLI and
// manifest the view layer reaches through package.json "imports" (#ltms, #ltms/cli, #ltms/package.json), each mapped into
// that dependency; and the command package.json names, which runs on a terminal only, and says so on anything else.
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

test('the command on no terminal: refused at once, naming ltms as the command for lines; stdout empty; exit 2', () => {
  assert.deepEqual(pkg.bin, { 'ltms-reader': 'bin/ltms-reader.mjs' });
  const bin = path.join(root, pkg.bin['ltms-reader']);
  assert.equal(readFileSync(bin, 'utf8').split('\n')[0], '#!/usr/bin/env node');
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-bin-'));
  try {
    // spawnSync gives pipes, not terminals; the folder that does not exist is refused for the terminal, not for the path:
    // nothing is looked at before that check
    for (const args of [[], [own], [path.join(root, 'test', 'fixtures', 'ltms', 'demo.jsonl')], [path.join(own, 'nothing-here')]]) {
      const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: own, HOME: own } });
      assert.equal(r.status, 2, `${JSON.stringify(args)}: exit`);
      assert.equal(r.stdout, '', `${JSON.stringify(args)}: stdout`);
      assert.match(r.stderr, /^ltms-reader: stdin and stdout are not terminals, so nothing was read\.\n/, `${JSON.stringify(args)}: stderr`);
      for (const command of ['ltms is the command', 'npx long-term-memory-structure index', 'npx long-term-memory-structure search', 'npx long-term-memory-structure skeleton', 'npm install -g long-term-memory-structure']) assert.ok(r.stderr.includes(command), `${JSON.stringify(args)}: names ${command}`);
    }
    const env = { ...process.env, CLAUDE_CONFIG_DIR: own, HOME: own };
    const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8', env });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^usage: ltms-reader {22}the projects under ~\/\.claude\/projects/);
    assert.equal(help.stderr, '');
    const version = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8', env });
    assert.equal(version.stdout, `ltms-reader ${pkg.version}\n`);
    for (const [args, said] of [[['--bogus'], /^ltms-reader: no option "--bogus"\nusage: /], [['a', 'b'], /^ltms-reader: one folder or one file, not 2 arguments\nusage: /]]) {
      const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env });
      assert.equal(r.status, 2, `${JSON.stringify(args)}: exit`);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, said);
    }
  } finally { rmSync(own, { recursive: true, force: true }); }
});
