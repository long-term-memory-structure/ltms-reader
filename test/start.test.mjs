// test/start.test.mjs — the three ways in (src/start.mjs): no argument (the projects under $CLAUDE_CONFIG_DIR/projects, or
// ~/.claude/projects), a folder of project folders (or one project's own folder), one transcript; and what is refused
// before anything is read: options it does not know, more than one path, no terminal, a path that is not one of those.
// Every home folder and CLAUDE_CONFIG_DIR here is a folder of this test's own.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../src/app.mjs';
import { RootSource } from '../src/sources.mjs';
import { notTerminal, parseArgs, startOf } from '../src/start.mjs';
import { KEY, keyboard, makeRoot, plainOf } from './helpers.mjs';

test('the arguments: none, one path, --help, --version, --; anything else is a usage error', () => {
  assert.deepEqual(parseArgs([]), { path: null });
  assert.deepEqual(parseArgs(['x']), { path: 'x' });
  assert.deepEqual(parseArgs(['--', '-x']), { path: '-x' });
  assert.deepEqual(parseArgs(['-']), { path: '-' });
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.deepEqual(parseArgs(['-h', 'x']), { help: true });
  assert.deepEqual(parseArgs(['--version']), { version: true });
  assert.deepEqual(parseArgs(['-q']), { usage: 'no option "-q"' });
  assert.deepEqual(parseArgs(['a', 'b']), { usage: 'one folder or one file, not 2 arguments' });
});

test('no terminal: which stream is not one, and ltms as the command for lines', () => {
  const tty = { isTTY: true }, pipe = {};
  assert.equal(notTerminal(tty, tty), null);
  assert.match(notTerminal(pipe, tty), /^ltms-reader: stdin is not a terminal, so nothing was read\./);
  assert.match(notTerminal(tty, pipe), /^ltms-reader: stdout is not a terminal, so nothing was read\./);
  assert.match(notTerminal(pipe, pipe), /^ltms-reader: stdin and stdout are not terminals, so nothing was read\./);
  assert.match(notTerminal(tty, pipe), /ltms is the command \(npx long-term-memory-structure/);
});

test('the three ways in, and the refusals', () => {
  const r = makeRoot();
  const own = r.base;
  try {
    // no argument: CLAUDE_CONFIG_DIR's projects, else the home folder's .claude/projects
    mkdirSync(path.join(own, 'conf', 'projects'), { recursive: true });
    assert.deepEqual(startOf(null, { env: { CLAUDE_CONFIG_DIR: path.join(own, 'conf') }, home: '/nonexistent' }), { kind: 'root', root: path.join(own, 'conf', 'projects'), from: 'CLAUDE_CONFIG_DIR' });
    mkdirSync(path.join(own, 'home', '.claude', 'projects'), { recursive: true });
    assert.deepEqual(startOf(null, { env: { CLAUDE_CONFIG_DIR: '' }, home: path.join(own, 'home') }), { kind: 'root', root: path.join(own, 'home', '.claude', 'projects'), from: 'default' });
    assert.match(startOf(null, { env: {}, home: path.join(own, 'nohome') }).refused, /^no folder at .*nohome\/\.claude\/projects: Claude Code keeps its projects there \(CLAUDE_CONFIG_DIR moves them\)/);
    assert.match(startOf(null, { env: { CLAUDE_CONFIG_DIR: path.join(own, 'noconf') }, home: own }).refused, /^no folder at .*noconf\/projects: CLAUDE_CONFIG_DIR names its projects there\./);
    // a folder of project folders; one project's own folder; a transcript; what is none of these
    assert.deepEqual(startOf(r.root, { env: {}, home: own }), { kind: 'root', root: r.root, from: 'argument' });
    assert.deepEqual(startOf(path.join(r.root, '-work-other'), { env: {}, home: own }), { kind: 'root', root: realpathSync(r.root), project: '-work-other', from: 'argument' });
    const file = path.join(r.root, '-work-demo', '11111111-1111-4111-8111-111111111111.jsonl');
    assert.deepEqual(startOf(file, { env: {}, home: own }), { kind: 'file', file: realpathSync(file) });
    symlinkSync(file, path.join(own, 'link.jsonl'));
    assert.deepEqual(startOf(path.join(own, 'link.jsonl'), { env: {}, home: own }), { kind: 'file', file: realpathSync(file) }, 'a link named on the command line is followed: it is the user\'s own');
    symlinkSync(path.join(own, 'gone'), path.join(own, 'dangling.jsonl'));
    assert.match(startOf(path.join(own, 'dangling.jsonl'), { env: {}, home: own }).refused, /is a symbolic link to nothing$/);
    writeFileSync(path.join(own, 'notes.txt'), 'x');
    assert.match(startOf(path.join(own, 'notes.txt'), { env: {}, home: own }).refused, /is not a transcript: a transcript is a \.jsonl file$/);
    assert.match(startOf(path.join(own, 'nothing'), { env: {}, home: own }).refused, /^no file or folder at /);
    assert.match(startOf('/dev/null', { env: {}, home: own }).refused, /is neither a folder nor a regular file$/);
    // a folder holding transcripts at its top and project folders too is a folder of projects
    writeFileSync(path.join(r.root, 'stray.jsonl'), '');
    assert.deepEqual(startOf(r.root, { env: {}, home: own }), { kind: 'root', root: r.root, from: 'argument' });
  } finally { r.dispose(); }
});

test('a project folder given where its parent was meant opens as that project, the Projects view listing it alone', async () => {
  const r = makeRoot();
  try {
    const s = startOf(path.join(r.root, '-work-demo'), { env: {}, home: r.base });
    assert.deepEqual(s, { kind: 'root', root: r.root, project: '-work-demo', from: 'argument' });
    const source = new RootSource({ root: s.root, only: s.project });
    const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
    const k = keyboard(app);
    try {
      app.start({ project: s.project }); await app.idle();
      assert.equal(plainOf(app.lines())[0], 'ltms-reader  Sessions  -work-demo');
      await k.press(KEY.escape);
      const f = plainOf(app.lines()).map((l) => l.replace(/ +$/, ''));
      assert.equal(f[1], '1 project folder');
      assert.equal(f.filter((l) => /^[> ] -work-/.test(l)).length, 1);
    } finally { app.dispose(); source.dispose(); }
    assert.deepEqual(startOf(r.root, { env: {}, home: r.base }), { kind: 'root', root: r.root, from: 'argument' });
  } finally { r.dispose(); }
});
