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

// B's new issue (S376): the width table is derived from Unicode's EastAsianWidth.txt, whose licence (the Unicode
// License v3) asks that its copyright and permission notice appear with every copy; the table named it by its URL only
test('the Unicode-derived width table carries the Unicode License v3 notice: at its head, and in LICENSE-UNICODE, which the package ships', () => {
  const table = readFileSync(path.join(root, 'src', 'width-table.mjs'), 'utf8');
  let notice = '';
  try { notice = readFileSync(path.join(root, 'LICENSE-UNICODE'), 'utf8'); } catch {}
  const permission = 'Permission is hereby granted, free of charge, to any person obtaining a copy of data files and any associated documentation (the "Data Files") or software and any associated documentation (the "Software") to deal in the Data Files or Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, and/or sell copies of the Data Files or Software, and to permit persons to whom the Data Files or Software are furnished to do so, provided that either (a) this copyright and permission notice appear with all copies of the Data Files or Software, or (b) this copyright and permission notice appear in associated Documentation.';
  const flat = (s) => s.replace(/^\/\/ ?/gm, '').replace(/\s+/g, ' ');
  for (const [what, text] of [['src/width-table.mjs', table], ['LICENSE-UNICODE', notice]]) {
    assert.ok(flat(text).includes('UNICODE LICENSE V3'), `${what}: the licence's name`);
    assert.ok(flat(text).includes('Copyright © 2025 Unicode, Inc.'), `${what}: the data file's copyright`);
    assert.ok(flat(text).includes(permission), `${what}: the permission notice`);
    assert.ok(flat(text).includes('SPDX-License-Identifier: Unicode-3.0'), `${what}: its SPDX identifier`);
  }
  assert.ok(pkg.files.includes('LICENSE-UNICODE'), 'package.json "files" ships it (npm packs LICENSE by itself, not this name)');
});

// R4 (S377, round 3): given the folder test/, Node 20.20.2's runner runs every .mjs and .js under it as a test file, the
// fixtures too (four of them failed there: test/fixtures/guard/aborts.mjs, exits.mjs, killed.mjs and
// reading-a-hit.recipe.js; and make-fixtures.mjs would write the fixtures again); Node 22.23.3 and 24.22.3 run none (they
// take the folder for a module: "Cannot find module"); Node 26.13.1 runs the *.test.* files. So the test command names
// the test files, test/*.test.mjs, as the shell expands it, which runs them on all four (Node 20 does not expand a
// pattern itself).
test('R4: npm test names the test files, test/*.test.mjs as sh expands it: every *.test.mjs in test/, and nothing else', async () => {
  const { readdirSync } = await import('node:fs');
  assert.equal(pkg.scripts.test, 'node --test test/*.test.mjs');
  const r = spawnSync('sh', ['-c', 'printf "%s\\n" test/*.test.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // the shell sorts by the locale's collation: compared as sets
  const named = r.stdout.split('\n').filter(Boolean).sort();
  assert.deepEqual(named, readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.mjs')).map((f) => `test/${f}`).sort());
  assert.ok(named.length > 0 && named.every((f) => !f.includes('fixtures')), named.join(' '));
});
