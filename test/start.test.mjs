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
import { USAGE, notTerminal, parseArgs, startOf } from '../src/start.mjs';
import { before } from '../src/main.mjs';
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
  assert.match(notTerminal(tty, pipe), /ltms is the command, from the package ltms-reader is built on/);
  // what it writes, and where (the claims run on 0.1.1, RM-42: what the reader writes, not where its text goes)
  assert.match(notTerminal(tty, pipe), /\nltms-reader shows transcripts on a terminal's screen only: it writes none of their text to a pipe, a file or a log\.\n/);
});

// The claims run on 0.1.1 (S384, RV-5): a line of --help's right-to-left paragraph had grown to 123 columns, which a
// terminal of 120 wraps; 0.1.0's widest was 116. USAGE is printable ASCII, a column a character.
test('--help: printable ASCII, and no line wider than 116 columns, 0.1.0\'s widest', () => {
  assert.match(USAGE, /^[\x20-\x7e\n]*$/);
  const wide = USAGE.split('\n').filter((l) => l.length > 116);
  assert.deepEqual(wide, [], `${wide.length} lines wider than 116 columns`);
});

// O1 (S379, the 0.1.0 claims run): what was refused before the screen opened was written to the terminal as it was given:
// the path (no file or folder at it, not a transcript, a link to nothing), CLAUDE_CONFIG_DIR's value and an unknown option
// (JSON.stringify escapes C0 controls, not C1 controls or the bidirectional ones), so that a path holding an OSC sequence set
// the terminal's title and one holding ESC [2J cleared the screen. Each now goes through visible(), as the
// LTMS_READER_BIDI refusal did. The controls here are built from their numbers, so that the source holds none.
test('O1: what is refused before the screen opens shows the path given, CLAUDE_CONFIG_DIR and an unknown option made visible: no control of theirs reaches the terminal', () => {
  const ch = (n) => String.fromCodePoint(n), BS = ch(92), tty = { isTTY: true };
  const bad = `${ch(0x1b)}]0;TITLE${ch(7)}${ch(0x1b)}[2J${ch(0x9b)}2J${ch(0x202e)}`;
  const shown = `${ch(0x241b)}]0;TITLE${BS}x07${ch(0x241b)}[2J${BS}x9b2J${BS}u202e`;
  const raw = (s) => [...s].filter((c) => {
    const n = c.codePointAt(0);
    return (n < 0x20 && c !== ch(10) && c !== ch(9)) || (n >= 0x7f && n <= 0x9f) || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069);
  });
  const home = mkdtempSync(path.join(tmpdir(), 'ltms-reader-o1-'));
  try {
    writeFileSync(path.join(home, `notes${bad}.txt`), 'x');
    symlinkSync(path.join(home, 'nothing-here'), path.join(home, `link${bad}`));
    const cases = [
      [[path.join(home, `no-such${bad}.jsonl`)], {}, 'no file or folder at', shown],
      [[path.join(home, `notes${bad}.txt`)], {}, 'is not a transcript', shown],
      [[path.join(home, `link${bad}`)], {}, 'is a symbolic link to nothing', shown],
      [[], { CLAUDE_CONFIG_DIR: path.join(home, `conf${bad}`) }, 'no folder at', shown],
      [[`--x${bad}`], {}, 'no option', `${BS}x9b2J${BS}u202e`],
    ];
    for (const [argv, env, why, form] of cases) {
      let out = '';
      const code = before(argv, { stdin: tty, stdout: tty, stderr: { write(s) { out += s; } }, env });
      const what = `${JSON.stringify(argv)} ${JSON.stringify(env)}`;
      assert.equal(code, 2, what);
      assert.ok(out.startsWith('ltms-reader: ') && out.includes(why), `${what}: ${JSON.stringify(out.slice(0, 200))}`);
      assert.deepEqual(raw(out).map((c) => c.codePointAt(0).toString(16)), [], `${what}: no control reaches the terminal`);
      assert.ok(out.includes(form), `${what}: shown as ${JSON.stringify(form)} in ${JSON.stringify(out.slice(0, 300))}`);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
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

// R.F13: after `npm install -g ltms-reader`, as the README offers, there is no ltms on the PATH (the core's bin is not
// linked), so `ltms index ...` copied from the refusal was "command not found"
test('R.F13: the refusal\'s commands for lines run as they are written, without ltms installed; it says how to install ltms', () => {
  const said = notTerminal({}, {});
  const examples = said.split('\n').filter((l) => /^ {2}\S/.test(l));
  assert.equal(examples.length, 3, said);
  for (const [i, sub] of ['index', 'search', 'skeleton'].entries()) assert.match(examples[i], new RegExp(`^ {2}npx long-term-memory-structure ${sub} `), `example ${i + 1}: ${examples[i]}`);
  assert.match(said, /ltms is the command/, 'ltms named as the command for lines (the design)');
  assert.match(said, /npm install -g long-term-memory-structure/, 'and how to have it on the PATH');
});
