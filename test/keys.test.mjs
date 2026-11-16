// test/keys.test.mjs — a sequence of keypresses into the state machine, and the frames it gives. The keys are the bytes a
// terminal sends, decoded by readline's emitKeypressEvents as the screen decodes them; the folder of projects is made of
// the fixtures in a folder of this test's own. Every frame on the way is checked whole (its lines, their widths, no
// control character); what each key did is read off the frame, and a few frames are compared line by line.
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../src/app.mjs';
import { RootSource } from '../src/sources.mjs';
import { width } from '../src/text.mjs';
import { top } from '../src/views.mjs';
import { KEY, keyboard, makeRoot, plainOf } from './helpers.mjs';

const CC = /[\u0000-\u001f\u007f-\u009f]/;
function frameOf(app) {
  const { cols, rows } = app.state, lines = plainOf(app.lines());
  assert.equal(lines.length, rows);
  lines.forEach((l, i) => { assert.ok(!CC.test(l), `line ${i + 1}: a control character`); assert.ok(width(l) <= (i === rows - 1 ? cols - 1 : cols), `line ${i + 1}: ${width(l)} columns`); });
  return lines.map((l) => l.replace(/ +$/, ''));
}
const selected = (f) => f.find((l) => l.startsWith('> ')) ?? null;
const typed = (s) => [...s].join('');

test('keys through every view: move, open, back, search, an address, the keys, JSON, and quit', async () => {
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const exits = [];
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC', onExit: (code) => exits.push(code) });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    let f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Projects {2}/);
    assert.equal(f[1], '2 project folders');
    assert.equal(selected(f).split(/ {2,}/)[0], '> -work-demo');
    await k.press(KEY.down); f = frameOf(app);
    assert.equal(selected(f).split(/ {2,}/)[0], '> -work-other');
    assert.match(f[23], /^-work-other {2}Enter opens/, 'the selected row\'s name on the last line');
    await k.press(KEY.escape); f = frameOf(app);
    assert.equal(f[23], 'this is the first view: q quits');
    await k.press(KEY.up + KEY.enter); f = frameOf(app);
    assert.equal(f[0], 'ltms-reader  Sessions  -work-demo');
    assert.deepEqual(f.slice(2, 5), [
      '  session   started           turns  calls  failed  compact  agents',
      '> 22222222  2026-08-01 10:00      2      4       0        1       0',
      '  11111111  2026-01-05 09:00      4     12       5        0       1',
    ], 'ltms index: newest first; demo\'s agent counted in its own folder');
    await k.press(KEY.down + KEY.right); f = frameOf(app);
    assert.equal(f[0], 'ltms-reader  Session 11111111  -work-demo/11111111-1111-4111-8111-111111111111.\u2026', 'the title, cut at 80 columns');
    await k.press(KEY.end); f = frameOf(app);
    assert.match(selected(f), /^> 11111111:T004 {2}task /);
    await k.press(KEY.home); f = frameOf(app);
    assert.match(selected(f), /^> 11111111:T001 /);
    await k.press(KEY.pagedown); f = frameOf(app);
    assert.match(selected(f), /^> 11111111:T004 /, 'a page down past the last row stops at it');
    await k.press(KEY.pageup + KEY.down + KEY.down + KEY.enter); f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Turn 11111111:T003 {2}-work-demo\/11111111-1111-4111-8111-1111/);
    assert.match(f[1], /^typed {2}5 calls {2}3 failed {2}2026-01-05 09:02$/);
    await k.press(KEY.down + KEY.down + KEY.enter); f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Record 11111111:L22 /);
    assert.deepEqual(f.slice(2, 7), ['-- tool call: Bash --', '{', '  "command": "rm -rf ./build",', '  "description": "Remove the build folder"', '}']);
    await k.press('j'); f = frameOf(app);
    assert.match(f[1], / as JSON /);
    assert.equal(f[2], '{');
    assert.ok(f.some((l) => l === ' "type": "assistant",'), 'the record as JSON, as written by JSON.stringify with one space');
    await k.press('j'); f = frameOf(app);
    assert.equal(f[2], '-- tool call: Bash --');
    await k.press(KEY.escape); f = frameOf(app);
    assert.match(selected(f), /^> 11111111:L22 {2}call {8}failed hook-block:demo-gate {2}Bash /, 'back at the turn, its row still selected');
    await k.press(KEY.left); await k.press(KEY.left); f = frameOf(app);
    assert.equal(f[0], 'ltms-reader  Sessions  -work-demo');

    // search: typed on the last line, edited, run by ltms search over the project on screen
    await k.press('/'); f = frameOf(app);
    assert.equal(f[23], '/ search in -work-demo:');
    await k.press(typed('npm tset')); await k.press(KEY.backspace + KEY.backspace + KEY.backspace); await k.press('est'); f = frameOf(app);
    assert.equal(f[23], '/ search in -work-demo: npm test');
    await k.press(KEY.enter); f = frameOf(app);
    assert.equal(f[0], 'ltms-reader  Search "npm test"  in -work-demo');
    // ltms search reads every .jsonl under the folder, at any depth: demo, compacted and demo's agent
    assert.match(f[2], /^ {2}1 matching turn in 1 of 3 files \(3 read, 0 failed\) {2}searched: input, summary,/);
    assert.match(selected(f), /^> 11111111:T003 {2}typed {5}L24 call {2}L25 result {2}L26 call /, 'the first hit selected (R.F7)');
    await k.press(KEY.up); f = frameOf(app);
    assert.match(selected(f), /^> 11111111 {7}2026-01-05 09:03 {2}-work-demo\/11111111-1111-4111-8111-1111/, 'its session\'s row above it');
    await k.press(KEY.down); f = frameOf(app);
    assert.match(selected(f), /^> 11111111:T003 {2}typed {5}L24 call {2}L25 result {2}L26 call /);
    await k.press(KEY.enter); f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Turn 11111111:T003 /);
    assert.match(selected(f), /^> 11111111:L24 {2}call /, 'the turn opens at its first match');
    await k.press(KEY.left); f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Session 11111111 /, 'below the turn, its session');
    assert.match(selected(f), /^> 11111111:T003 /);
    await k.press(KEY.left); f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Search "npm test"/, 'then the search it was opened from');

    // addresses: a turn of the project on screen, an agent's record found by its prefix, and two that are not
    await k.press(':'); await k.press(typed('22222222:T2')); await k.press(KEY.enter); f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Turn 22222222:T002 {2}-work-demo\/22222222/);
    await k.press(':'); await k.press(typed('agent-a0123456:L2')); await k.press(KEY.enter); f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Record agent-a0123456:L2 {2}-work-demo\/11111111-1111-4111-8111-1111/);
    assert.match(f[22], /^agent-a0123456:L2 {2}line 2 of 11111111-1111-4111-8111-111111111111\/subagents\/age/, 'the agent in its session\'s own folder');
    await k.press(KEY.left); f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Turn agent-a0123456:T001 /, 'below the record, the turn that holds its line');
    await k.press(':'); await k.press(typed('zzzzzzzz:L1')); await k.press(KEY.enter); f = frameOf(app);
    assert.equal(f[23], 'no transcript has the address prefix zzzzzzzz in any project');
    await k.press(':'); await k.press(typed('not an address')); await k.press(KEY.enter); f = frameOf(app);
    assert.equal(`${f[22]} ${f[23]}`, 'not an address: not an address (an address is <prefix>:L<line> or <prefix>:T<turn>, as ltms prints it)', 'a long message on the last two lines');
    await k.press(':'); await k.press(typed('11111111:L9999')); await k.press(KEY.enter); f = frameOf(app);
    assert.equal(`${f[21]} ${f[22]} ${f[23]}`, 'no record was parsed on line 9999 of 11111111-1111-4111-8111-111111111111.jsonl: the line is blank, not a JSON object, or past the end of the file', 'a longer one on three');
    await k.press(':'); await k.press(typed('11111111:L2')); await k.press(KEY.escape); f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Session 11111111 /, 'Esc leaves the line without opening anything');

    // the keys, and back on any key
    await k.press('?'); f = frameOf(app);
    assert.equal(f[0], 'ltms-reader  Keys');
    assert.ok(f.some((l) => l.startsWith('  /') && l.includes('search')));
    await k.press('x'); f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Session 11111111 /);

    // a larger window: the same view, redrawn whole
    app.resize(200, 60); f = frameOf(app);
    assert.equal(f.length, 60);
    await k.press(KEY.ctrlc);
    assert.deepEqual(exits, [130], 'Ctrl-C quits with 130');
    await k.press('q');
    assert.deepEqual(exits, [130], 'nothing after quitting');
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

test('q quits with 0, from any view but a line being typed', async () => {
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const exits = [];
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC', onExit: (code) => exits.push(code) });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press('/'); await k.press('q');
    assert.deepEqual(exits, [], 'q is typed into the search');
    assert.equal(frameOf(app)[23], '/ search in every project: q');
    await k.press(KEY.escape); await k.press('q');
    assert.deepEqual(exits, [0]);
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

test('two Esc pressed together go back once; Alt and a letter does nothing', async () => {
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press(KEY.enter); await k.press(KEY.enter);
    assert.equal(top(app.state).kind, 'session');
    await k.press('\x1b\x1b');
    assert.equal(top(app.state).kind, 'sessions');
    await k.press('\x1bq');
    assert.equal(app.quitting, null, 'Alt-q is not q');
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

test('a projects folder that cannot be listed: said on the screen, by its path and its error code', { skip: process.getuid?.() === 0 ? 'root reads any folder' : false }, async () => {
  const { chmodSync, mkdirSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const base = mkdtempSync(path.join(tmpdir(), 'ltms-reader-shut-')), shut = path.join(base, 'projects');
  mkdirSync(shut);
  chmodSync(shut, 0o000);
  const source = new RootSource({ root: shut });
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
  try {
    app.start(); await app.idle();
    const f = frameOf(app);
    assert.equal(f[1], 'the projects folder could not be listed');
    // the message takes as many lines as the path needs (TMPDIR's length decides it): each line indented, broken at a
    // space (which goes) or inside a word (nothing goes), and together the path and the code
    const body = [];
    for (let i = 2; f[i] !== ''; i++) { assert.ok(f[i].startsWith('  '), `line ${i + 1}: ${JSON.stringify(f[i])}`); body.push(f[i].slice(2)); }
    const escaped = body.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.match(`${shut}: EACCES (scandir)`, new RegExp(`^${escaped.join('(?: |)')}$`), `the lines ${JSON.stringify(body)}`);
  } finally { app.dispose(); source.dispose(); chmodSync(shut, 0o755); rmSync(base, { recursive: true, force: true }); }
});

// R.F8: a paste arrives as keys; with bracketed paste on (ESC[?2004h, as the screen enters) the terminal marks it, and
// readline gives its start and end as the keys paste-start and paste-end (measured, Node 26)
test('R.F8: a paste is text: its new lines do not submit the line it is pasted into; outside a line, its keys do nothing', async () => {
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const exits = [];
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC', onExit: (code) => exits.push(code) });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press('/');
    await k.press('\x1b[200~npm test\rquit the reader?\x1b[201~');
    assert.deepEqual(exits, [], 'the reader still running');
    assert.equal(top(app.state).kind, 'projects', 'nothing was searched');
    assert.equal(frameOf(app)[23], '/ search in every project: npm test quit the reader?', 'the new line as a space, the rest typed');
    await k.press(KEY.enter);
    assert.equal(top(app.state).kind, 'search', 'Enter typed after the paste runs it');
    await k.press(KEY.escape);
    await k.press('\x1b[200~q\r/x\nj\x1b[201~');
    assert.deepEqual(exits, [], 'a paste outside a line: its q does not quit');
    assert.equal(app.state.input, null, 'nor does its / open a line');
    assert.equal(top(app.state).kind, 'projects', 'nor does its new line open a row');
    await k.press('q');
    assert.deepEqual(exits, [0], 'q typed after the paste quits');
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

// R.F7: the README (and the design's Search row): Enter on a search opens the turn at its first match
test('R.F7: after a search, Enter opens the turn at its first match, its record selected; the session\'s row is one up', async () => {
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press(KEY.enter);   // -work-demo's sessions
    await k.press('/'); await k.press(typed('npm test')); await k.press(KEY.enter);
    let f = frameOf(app);
    assert.equal(f[0], 'ltms-reader  Search "npm test"  in -work-demo');
    assert.match(selected(f), /^> 11111111:T003 {2}typed /, 'the first hit selected');
    await k.press(KEY.enter); f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Turn 11111111:T003 /, 'Enter opens the turn');
    assert.match(selected(f), /^> 11111111:L24 {2}call /, 'at its first match');
    await k.press(KEY.left); await k.press(KEY.left); f = frameOf(app);
    assert.match(f[0], /^ltms-reader {2}Search "npm test"/);
    await k.press(KEY.up); f = frameOf(app);
    assert.match(selected(f), /^> 11111111 {7}2026-01-05 09:03 /, 'the session\'s row above the hit');
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

// R.F11: the README's keys say q quits; on the keys screen it went back instead
test('R.F11: q on the keys screen quits, as everywhere but a line being typed', async () => {
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const exits = [];
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC', onExit: (code) => exits.push(code) });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press('?'); await k.press('q');
    assert.deepEqual(exits, [0], 'q quits with 0');
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

test('R.F11: the keys screen says so: q quits, any other key goes back', async () => {
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const exits = [];
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC', onExit: (code) => exits.push(code) });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press('?');
    const f = frameOf(app);
    assert.equal(f[0], 'ltms-reader  Keys');
    assert.equal(f[1], 'q quits; any other key goes back');
    assert.match(f[23], /^q or Ctrl-C quits {2}any other key goes back$/);
    await k.press('x');
    assert.match(frameOf(app)[0], /^ltms-reader {2}Projects/, 'x goes back');
    assert.deepEqual(exits, []);
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});
