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
import { FX, KEY, keyboard, makeRoot, plainOf, withoutOverride } from './helpers.mjs';

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

// V2 (round 5): the keys screen gave each key's words max(1, cols - 16 - 4) columns beside a key column of 16, so that
// at 20 columns, the narrowest the reader draws, its lines took 2 + 16 + 2 + 1 = 21 (round 4's check: 55 of 55 frames
// at 20 columns, heights 5 to 59; the same at da5b8bb). Every size the reader draws, the keys screen within it.
test('V2: the keys screen at every size from 20 x 5 to 200 x 60: no line wider than the screen, the last one column short of it', async () => {
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press('?');
    let frames = 0;
    const wide = [];
    for (let cols = 20; cols <= 200; cols++) {
      for (let rows = 5; rows <= 60; rows++) {
        app.resize(cols, rows);
        const f = plainOf(app.lines());
        assert.equal(f.length, rows, `${cols} x ${rows}: the frame's lines`);
        assert.equal(f[0], 'ltms-reader  Keys', `${cols} x ${rows}: the keys screen`);
        f.forEach((l, i) => { if (width(l) > (i === rows - 1 ? cols - 1 : cols)) wide.push(`${cols} x ${rows}, line ${i + 1}: ${width(l)} columns: ${JSON.stringify(l)}`); });
        frames++;
      }
    }
    assert.equal(frames, 181 * 56);
    assert.deepEqual(wide.slice(0, 3), [], `${wide.length} lines wider than the screen, in ${new Set(wide.map((w) => w.split(',')[0])).size} frames of ${frames}`);
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

// R.F10: at the design's 80 x 24, a record's place ("lines a to b of N") and the last line's "q quits" were cut
test('R.F10: at 80 x 24, every view\'s last line keeps "? keys  q quits" whole, the longest addresses too; a record\'s place is whole', async () => {
  const { cpSync, mkdirSync } = await import('node:fs');
  const r = makeRoot();
  // a project whose folder's name is long, as Claude Code names a deep working directory
  const long = '-home-someone-work-repositories-company-a-long-project-name';
  mkdirSync(path.join(r.root, long));
  cpSync(path.join(r.root, '-work-demo', '11111111-1111-4111-8111-111111111111.jsonl'), path.join(r.root, long, '11111111-1111-4111-8111-111111111111.jsonl'));
  const source = new RootSource({ root: r.root });
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
  const k = keyboard(app);
  // every line looked at, and what it should be; the misses are listed together at the end
  const seen = [];
  const look = (what, i, re) => { const l = frameOf(app)[i]; seen.push({ what, line: l, ok: re.test(l) }); };
  const quits = (address) => new RegExp(`^${address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} {2}.*\\? keys {2}q quits$`);
  try {
    app.start(); await app.idle();
    top(app.state).sel = top(app.state).rows.findIndex((x) => x.name === long);
    await k.press(KEY.down); await k.press(KEY.up);
    look('Projects, a long project name', 23, quits(long));
    top(app.state).sel = top(app.state).rows.findIndex((x) => x.name === '-work-demo');
    await k.press(KEY.enter);
    look('Sessions', 23, quits('22222222'));
    await k.press(KEY.down); await k.press(KEY.enter);
    look('a session', 23, quits('11111111:T001'));
    await k.press(KEY.enter);
    look('a turn', 23, quits('11111111:L2'));
    await k.press(KEY.enter);
    look('a record', 23, quits('11111111:L2'));
    look('a record\'s place', 1, /^lines 1 to \d+ of \d+ {2}/);
    await k.press('j');
    look('a record\'s place, as JSON', 1, /^lines 1 to \d+ of \d+ {2}/);
    await k.press(':'); await k.press('agent-a0123456:L2'); await k.press(KEY.enter);
    look('an agent\'s record', 23, quits('agent-a0123456:L2'));
    await k.press(KEY.left);
    look('an agent\'s turn', 23, quits('agent-a0123456:L2'));
    await k.press(KEY.left);
    look('an agent\'s session', 23, quits('agent-a0123456:T001'));
    await k.press('/'); await k.press('npm test'); await k.press(KEY.enter);
    look('Search', 23, quits('11111111:T003'));
    assert.deepEqual(seen.filter((x) => !x.ok), [], `the lines that are cut, of ${seen.length}`);
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

test('R.F10: a hint in the room left: its last two keys always, the others from the first as they fit; cut only when the two alone do not fit', async () => {
  const { hintIn } = await import('../src/views.mjs');
  const hint = ['j JSON', 'Esc back', 'PgUp PgDn pages', '/ search', ': address', '? keys', 'q quits'];
  assert.equal(hintIn(hint, 200), 'j JSON  Esc back  PgUp PgDn pages  / search  : address  ? keys  q quits');
  assert.equal(hintIn(hint, 65), 'j JSON  Esc back  PgUp PgDn pages  / search  ? keys  q quits');
  assert.equal(hintIn(hint, 33), 'j JSON  Esc back  ? keys  q quits');
  assert.equal(hintIn(hint, 22), '? keys  q quits');
  assert.equal(hintIn(hint, 15), '? keys  q quits');
  assert.equal(hintIn(hint, 10), '? keys  q…');
  assert.equal(hintIn('q or Ctrl-C quits  any other key goes back', 20), 'q or Ctrl-C quits  …');
});

// R.F2: a project whose ltms index takes 3 s or more is kept (src/engine.mjs AUTO_MS), and when its files change it is
// answered from what was kept, with what changed; the Sessions view said nothing of it
test('R.F2: a project\'s sessions answered from the list kept after its files changed: the view says when it was read and how many changed', async () => {
  const { appendFileSync } = await import('node:fs');
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const app = new App({ source, cols: 200, rows: 24, timeZone: 'UTC' });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press(KEY.enter);
    let f = frameOf(app);
    assert.equal(f[0], 'ltms-reader  Sessions  -work-demo');
    assert.doesNotMatch(f[1], /changed/, 'read now: nothing to say');
    // as if that reading had taken a minute, as a large project's does; then a session's file grows
    source.engine.indexCache.get(path.join(r.root, '-work-demo')).value.ms = 60_000;
    await k.press(KEY.escape);
    appendFileSync(path.join(r.root, '-work-demo', '11111111-1111-4111-8111-111111111111.jsonl'), '\n');
    await k.press(KEY.enter);
    f = frameOf(app);
    assert.equal(f[0], 'ltms-reader  Sessions  -work-demo');
    // its counts on the line under the title, the notice on a line of its own (N2: at first it led the counts' line)
    assert.match(f[1], /^2 sessions /, f[1]);
    assert.match(f[2], /^this list was read at \d{4}-\d\d-\d\d \d\d:\d\d, and 1 file changed since: r reads it again$/, f[2]);
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

test('N2: a kept list at 80 and 100 columns: the counts and coverage whole on their own line, the notice whole on its own; narrower, the notice cut only with …', async () => {
  const { appendFileSync } = await import('node:fs');
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press(KEY.enter);
    source.engine.indexCache.get(path.join(r.root, '-work-demo')).value.ms = 60_000;
    await k.press(KEY.escape);
    appendFileSync(path.join(r.root, '-work-demo', '11111111-1111-4111-8111-111111111111.jsonl'), '\n');
    await k.press(KEY.enter);
    // what the line says, written here from the view's data, not by the code under test
    const d = top(app.state).data, c = d.coverage.files;
    const counts = `${d.sessions.length} sessions  ${c.found} files found, ${c.read} read, ${c.failed} failed  ${(d.ms / 1000).toFixed(1)} s`;
    const at = new Date(d.changed.since).toISOString();
    const notice = `this list was read at ${at.slice(0, 10)} ${at.slice(11, 16)}, and 1 file changed since: r reads it again`;
    for (const cols of [80, 100, 120, 200]) {
      app.resize(cols, 24);
      const f = frameOf(app);
      assert.equal(f[0], 'ltms-reader  Sessions  -work-demo');
      assert.equal(f[1], counts, `${cols}: the counts and coverage, whole, on the line under the title`);
      const h = f.findIndex((l) => l.startsWith('  session '));
      assert.ok(h > 2, `${cols}: the column headings after the notice`);
      assert.equal(f.slice(2, h).join(' '), notice, `${cols}: the notice whole, on lines of its own: ${JSON.stringify(f.slice(2, h))}`);
      const v = top(app.state);
      assert.ok(f.slice(h + 1).some((l) => l.startsWith(`> ${v.rows[v.sel].p} `)), `${cols}: the list below, its selected row in sight`);
    }
    for (const cols of [40, 60, 79]) {
      app.resize(cols, 24);
      const f = frameOf(app);
      const shown = f.slice(1, f.findIndex((l) => l.startsWith('  session')));
      const n = shown.find((l) => l.startsWith('this list was read'));
      assert.ok(n, `${cols}: the notice is shown`);
      assert.ok(n === notice || (n.endsWith('…') && notice.startsWith(n.slice(0, -1))), `${cols}: the notice whole, or cut with the reader's own ellipsis: ${JSON.stringify(n)}`);
    }
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

test('N2: with the notice above the list, a page is the rows in sight less one: PgDn from the top keeps the first row in sight', async () => {
  const sessions = Array.from({ length: 40 }, (_, i) => ({ p: `s${String(i).padStart(7, '0')}`, first: '2026-01-01T00:00:00.000Z', last: '2026-01-01T00:00:00.000Z', turns: 1, calls: 0, failures: 0, compactions: [], agents: 0, file: `s${i}.jsonl`, firstPrompt: null, lastReply: null }));
  const source = {
    kind: 'root', rootShown: '/r',
    projects: () => ({ rootShown: '/r', state: 'dir', projects: [{ name: '-p', transcripts: 40, newest: 0 }], links: 0 }),
    sessions: () => ({ sessions, coverage: { files: { found: 40, read: 40, failed: 0 } }, copies: { files: 0 }, ms: 60_000, changed: { count: 1, since: Date.UTC(2026, 10, 16, 5, 43) } }),
    dispose() {},
  };
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press(KEY.enter);
    let f = frameOf(app);
    assert.equal(f[2], 'this list was read at 2026-11-16 05:43, and 1 file changed since: r reads it', 'the notice, on two lines at 80 columns');
    const first = f.findIndex((l) => l.startsWith('> s0000000'));
    const last = f.findIndex((l, i) => i > first && !/^ {2}s\d{7} /.test(l)) - 1;
    assert.ok(first > 0 && last > first, 'the list in sight');
    await k.press(KEY.pagedown);
    f = frameOf(app);
    assert.ok(f[first].startsWith('  s0000000 '), `the first row still in sight, at its place: ${f[first]}`);
    assert.ok(f[last].startsWith(`> s${String(last - first).padStart(7, '0')} `), `the selection on the last row in sight: ${f[last]}`);
    await k.press(KEY.end);
    f = frameOf(app);
    assert.ok(f[last].startsWith('> s0000039 '), `End: the last session selected, on the last row in sight: ${f[last]}`);
    assert.ok(f[first].startsWith(`  s${String(39 - (last - first)).padStart(7, '0')} `), `and the rows above it in sight: ${f[first]}`);
    await k.press(KEY.up);
    f = frameOf(app);
    assert.ok(f[first].startsWith(`  s${String(39 - (last - first)).padStart(7, '0')} `), `Up within the rows in sight does not scroll the list: ${f[first]}`);
    assert.ok(f[last - 1].startsWith('> s0000038 '), f[last - 1]);
  } finally { app.dispose(); }
});

// R5 (S377, round 3): round 2's check planted a defect in N2's fallback (sessionsHead kept the whole head however low
// the screen: 'return whole ? whole : of(false)') and the suite passed; under it the list's selected row left the
// screen at 80 x 5 with the short counts and at 80 x 6 with the long ones. On a screen too low to keep the whole head
// and a row of the list, each of its lines takes one line, cut with …, and the selected row stays in sight.
test('N2 (R5): a kept list on a screen too low for its whole head: the counts and the notice in sight, and the selected row', async () => {
  const sessions = Array.from({ length: 40 }, (_, i) => ({ p: `s${String(i).padStart(7, '0')}`, first: '2026-01-01T00:00:00.000Z', last: '2026-01-01T00:00:00.000Z', turns: 1, calls: 0, failures: 0, compactions: [], agents: 0, file: `s${i}.jsonl`, firstPrompt: null, lastReply: null }));
  const counts = {
    short: { coverage: { files: { found: 40, read: 40, failed: 0 } }, copies: { files: 0 } },
    long: { coverage: { files: { found: 43, read: 43, failed: 0, notConversation: 3 } }, copies: { files: 2 } },
  };
  for (const [kind, extra] of Object.entries(counts)) {
    const source = {
      kind: 'root', rootShown: '/r',
      projects: () => ({ rootShown: '/r', state: 'dir', projects: [{ name: '-p', transcripts: 40, newest: 0 }], links: 0 }),
      sessions: () => ({ sessions, ...extra, ms: 60_000, changed: { count: 1, since: Date.UTC(2026, 10, 16, 5, 43) } }),
      dispose() {},
    };
    const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
    const k = keyboard(app);
    try {
      app.start(); await app.idle();
      await k.press(KEY.enter);
      await k.press(KEY.down); await k.press(KEY.down);
      for (const [cols, rows] of [[80, 5], [80, 6], [80, 7], [80, 8], [100, 7], [120, 6], [200, 5]]) {
        app.resize(cols, rows);
        // read as drawn (frameOf's last-line rule is not asked here: under 7 rows the frame is cut at the screen's foot)
        const f = plainOf(app.lines()).map((l) => l.replace(/ +$/, ''));
        assert.equal(f.length, rows, `${kind} counts, ${cols} x ${rows}: the frame's lines`);
        assert.ok(f.every((l) => width(l) <= cols), `${kind} counts, ${cols} x ${rows}: no line wider than the screen`);
        assert.ok(f.some((l) => l.startsWith('> s0000002 ')), `${kind} counts, ${cols} x ${rows}: the selected row in sight: ${JSON.stringify(f)}`);
        // the head: from under the title to the column headings or, where they gave way to the status line (W3: at 5
        // rows), to the list
        const at = f.findIndex((l, i) => i > 0 && (l.startsWith('  session ') || /^[> ] s\d{7} /.test(l)));
        assert.ok(at >= 2, `${kind} counts, ${cols} x ${rows}: the head under the title`);
        assert.ok(rows < 6 || f[at].startsWith('  session '), `${kind} counts, ${cols} x ${rows}: the column headings, from 6 rows`);
        assert.match(f[rows - 1], /\? keys {2}q quits$/, `${kind} counts, ${cols} x ${rows}: the status line, the last line (W3)`);
        const head = f.slice(1, at);
        assert.ok(head.some((l) => /^\d+ sessions {2}/.test(l)) && head.some((l) => l.startsWith('this list was read at ')), `${kind} counts, ${cols} x ${rows}: the counts and the notice: ${JSON.stringify(head)}`);
      }
      // the same counts on a screen high enough: each whole, on as many lines as it takes
      app.resize(80, 24);
      const f = frameOf(app);
      const at = f.findIndex((l) => l.startsWith('  session '));
      assert.ok(f.slice(1, at).every((l) => !l.endsWith('…')), `${kind} counts, 80 x 24: whole: ${JSON.stringify(f.slice(1, at))}`);
    } finally { app.dispose(); }
  }
});

// ---- W1 (S378, round 4): a message wrapped into lines -------------------------------------------------------------------
// Every view that wraps text lays each line of a paragraph out from the paragraph's levels (UAX #9 section 3.4), with the
// paragraph's direction: a message, an error, the reader's own words, as a record's text. Round 3 laid out each line of
// a message as a paragraph of its own, with its own direction: at 40 columns, a message whose second line begins with a
// Hebrew word read 'an address is <prefix>:L<line> or) <the word>'. The forms are GNU FriBidi's library's.
test('W1: a message wrapped into lines, each laid out from its paragraph\'s levels, left to right as the message is: at 40 columns, its second line', async () => {
  const { frameBytes } = await import('../src/screen.mjs');
  const { directionOf } = await import('../src/text.mjs');
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const app = new App({ source, cols: 40, rows: 24, timeZone: 'UTC' });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press(':'); await k.press('[1] abc x abc \u2014 abc \u05e2\u05d5\u05dc\u05dd'); await k.press(KEY.enter);
    const lines = app.lines(), note = lines.slice(-3).map((l) => l[l.length - 1]);
    // the message's three lines, each a line of the one paragraph, in place
    const par = note[0].par;
    assert.ok(typeof par === 'string' && par.startsWith('not an address: [1] abc'), `the message is the paragraph: ${JSON.stringify(note[0])}`);
    for (const s of note) { assert.equal(s.par, par); assert.equal(par.slice(s.at, s.at + s.text.length), s.text); assert.equal(s.dir, directionOf(par)); }
    // each row without the override around a row that holds right-to-left text (Y1, round 6), checked where it is
    const rows = frameBytes(lines, { cols: 40, rows: 24, colour: false, rtl: 'reader' }).split(/\x1b\[\d+;1H\x1b\[2K/).slice(1).map((x) => withoutOverride(x.replace(/\x1b\[[0-9;]*m/g, '')).trimEnd());
    assert.deepEqual(rows.slice(-3), ['not an address: [1] abc x abc \u2014 abc', '\u05dd\u05dc\u05d5\u05e2 (an address is <prefix>:L<line> or', '<prefix>:T<turn>, as ltms prints it)']);
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

test('W1: every line the views wrap is a line of its paragraph: a message, the keys\' screen, an empty Projects', async () => {
  const { directionOf } = await import('../src/text.mjs');
  const check = (lines, what) => {
    let n = 0;
    for (const l of lines) for (const s of l) {
      if (s.par === undefined) continue;
      n++;
      assert.equal(s.par.slice(s.at, s.at + s.text.length), s.text, `${what}: ${JSON.stringify(s)}`);
      assert.equal(s.dir, directionOf(s.par), `${what}: the paragraph's direction`);
    }
    return n;
  };
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const app = new App({ source, cols: 30, rows: 30, timeZone: 'UTC' });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press(KEY.escape);   // a message: "this is the first view: q quits", on two lines at 30 columns
    assert.ok(check(app.lines(), 'a message') >= 2, 'the message\'s lines');
    await k.press('?');
    assert.ok(check(app.lines(), 'the keys') >= 10, 'the keys\' lines');
  } finally { app.dispose(); source.dispose(); r.dispose(); }
  // an empty folder of projects: what it says, wrapped
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const empty = mkdtempSync(path.join(tmpdir(), 'ltms-reader-empty-'));
  const s2 = new RootSource({ root: empty });
  const a2 = new App({ source: s2, cols: 30, rows: 24, timeZone: 'UTC' });
  try { a2.start(); await a2.idle(); assert.ok(check(a2.lines(), 'no project folders') >= 2, 'its lines'); } finally { a2.dispose(); s2.dispose(); rmSync(empty, { recursive: true, force: true }); }
});

// ---- W3 (S378, round 4): the status line on a low screen ----------------------------------------------------------------
// At 80 x 5 the views with column headings (Projects, Sessions, a session, a turn) drew six lines into five rows and the
// last, the status line with "? keys" and "q quits", was cut (found by round 3's builder and confirmed by its check: older
// than round 3). The reader draws from MIN_ROWS rows (5); at every height from there the status line is the last line
// drawn: the detail line gives way first, then the column headings. Under 5 rows it says what it needs.
const lastLines = (app, sizes) => sizes.map(([cols, rows]) => { app.resize(cols, rows); const f = plainOf(app.lines()).map((l) => l.replace(/ +$/, '')); assert.equal(f.length, rows, `${cols} x ${rows}: the frame's lines`); return [cols, rows, f]; });
const LOW = [[80, 5], [80, 6], [80, 7], [80, 8], [80, 9], [200, 5], [200, 6], [120, 5]];
test('W3: in every view, at every height from 5 rows, the last line drawn is the status line, "? keys" and "q quits" in it; the selected row in sight; under 5 rows, the size the reader needs, and q quits', async () => {
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const exits = [];
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC', onExit: (code) => exits.push(code) });
  const k = keyboard(app);
  const look = (what) => {
    for (const [cols, rows, f] of lastLines(app, LOW)) {
      assert.match(f[rows - 1], /\? keys {2}q quits$/, `${what} at ${cols} x ${rows}: the last line: ${JSON.stringify(f)}`);
      if (what !== 'a record' && what !== 'a record as JSON') assert.ok(f.some((l) => l.startsWith('> ')), `${what} at ${cols} x ${rows}: the selected row in sight: ${JSON.stringify(f)}`);
    }
    app.resize(80, 24);
  };
  try {
    app.start(); await app.idle(); look('Projects');
    await k.press(KEY.enter); look('Sessions');
    await k.press(KEY.enter); look('a session');
    await k.press(KEY.enter); look('a turn');
    await k.press(KEY.enter); look('a record');
    await k.press('j'); look('a record as JSON');
    await k.press('/'); await k.press('demo'); await k.press(KEY.enter); look('a search');
    // the keys' screen: its own status line
    await k.press('?');
    for (const [cols, rows, f] of lastLines(app, LOW)) assert.equal(f[rows - 1], 'q or Ctrl-C quits  any other key goes back', `the keys at ${cols} x ${rows}`);
    await k.press(KEY.escape); app.resize(80, 24);
    // a message takes the last line's place, and the lines above it it needs
    while (app.state.stack.length > 1) await k.press(KEY.escape);
    await k.press(KEY.escape);
    for (const [cols, rows, f] of lastLines(app, LOW)) assert.equal(f[rows - 1], 'this is the first view: q quits', `a message at ${cols} x ${rows}`);
    // under 5 rows: the size it needs, and nothing else; q quits there too
    for (const rows of [4, 3, 1]) {
      app.resize(80, rows);
      const f = plainOf(app.lines());
      assert.equal(f.length, rows);
      assert.equal(f[0].trimEnd(), `ltms-reader needs 20 x 5 at least; this is 80 x ${rows}`);
    }
    await k.press('q');
    assert.deepEqual(exits, [0], 'q quits at 80 x 1');
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

test('W3: a kept Sessions list (its counts and its notice above the list) at 5 and 6 rows: the status line last, the counts, the notice and the selected row in sight', async () => {
  const sessions = Array.from({ length: 40 }, (_, i) => ({ p: `s${String(i).padStart(7, '0')}`, first: '2026-01-01T00:00:00.000Z', last: '2026-01-01T00:00:00.000Z', turns: 1, calls: 0, failures: 0, compactions: [], agents: 0, file: `s${i}.jsonl`, firstPrompt: null, lastReply: null }));
  const source = {
    kind: 'root', rootShown: '/r',
    projects: () => ({ rootShown: '/r', state: 'dir', projects: [{ name: '-p', transcripts: 40, newest: 0 }], links: 0 }),
    sessions: () => ({ sessions, coverage: { files: { found: 43, read: 43, failed: 0, notConversation: 3 } }, copies: { files: 2 }, ms: 60_000, changed: { count: 1, since: Date.UTC(2026, 10, 16, 5, 43) } }),
    dispose() {},
  };
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press(KEY.enter); await k.press(KEY.down); await k.press(KEY.down);
    for (const [cols, rows, f] of lastLines(app, [[80, 5], [80, 6], [120, 6], [200, 5], [200, 6], [40, 5], [40, 6]])) {
      assert.match(f[rows - 1], /^s0000002 {2}.*\? keys {2}q quits$/, `${cols} x ${rows}: the status line last: ${JSON.stringify(f)}`);
      assert.ok(f.some((l) => /^\d+ sessions {2}/.test(l)) && f.some((l) => l.startsWith('this list was read at ')), `${cols} x ${rows}: the counts and the notice: ${JSON.stringify(f)}`);
      assert.ok(f.some((l) => l.startsWith('> s0000002 ')), `${cols} x ${rows}: the selected row: ${JSON.stringify(f)}`);
    }
  } finally { app.dispose(); }
});

// Under 20 x 5 the reader draws what it needs and nothing else. It was one line cut to the screen's width, so that under
// 26 columns the size was cut away ('ltms-reader needs …' at 20 x 4 and 19 x 24): it is wrapped over the lines there are,
// a size ("20 x 5", the screen's own) kept on one line (the finisher of round 4). The sizes below are those where all of
// it fits, every width from 7 columns (6 for "20 x 5" and one short); at 20 x 2, its first two lines.
test('W3: under 20 x 5, the size the reader needs, wrapped over the lines there are: every character of it on the screen, in order, "20 x 5" and the screen\'s own size each on one line, each line one column short of the screen; at 20 x 2 its first two lines; q quits', async () => {
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const exits = [];
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC', onExit: (code) => exits.push(code) });
  const k = keyboard(app);
  const frameAt = (cols, rows) => { app.resize(cols, rows); const f = plainOf(app.lines()).map((l) => l.replace(/ +$/, '')); assert.equal(f.length, rows, `${cols} x ${rows}: the frame's lines`); return f; };
  const sizes = [...Array.from({ length: 13 }, (_, i) => [7 + i, 24]), ...Array.from({ length: 41 }, (_, i) => [[20 + i, 4], [20 + i, 3]]).flat(), [80, 1], [200, 4]];
  try {
    app.start(); await app.idle();
    for (const [cols, rows] of sizes) {
      const f = frameAt(cols, rows), said = `ltms-reader needs 20 x 5 at least; this is ${cols} x ${rows}`;
      assert.ok(f.every((l) => width(l) <= cols - 1), `${cols} x ${rows}: each line one column short of the screen: ${JSON.stringify(f)}`);
      assert.equal(f.join('').replace(/ /g, ''), said.replace(/ /g, ''), `${cols} x ${rows}: what it needs, every character in order: ${JSON.stringify(f)}`);
      assert.ok(f.some((l) => l.includes('20 x 5')) && f.some((l) => l.includes(`${cols} x ${rows}`)), `${cols} x ${rows}: "20 x 5" and its own size, each on one line: ${JSON.stringify(f)}`);
    }
    assert.equal(sizes.length, 13 + 82 + 2);
    assert.deepEqual(frameAt(20, 2), ['ltms-reader needs', '20 x 5 at least;'], '20 x 2: its first two lines');
    await k.press('q');
    assert.deepEqual(exits, [0], 'q quits at 20 x 2');
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

// ---- Y2 (round 6, his F2, pick (a)): r reads the list on screen again ---------------------------------------------------
// The lists were read once: a project whose files changed showed its sessions as they were read (saying when, and how
// many files changed since: R.F2) until the reader started again. r reads Projects, or a project's Sessions, again (ltms
// index afresh), and keeps the selection on its row while that row is there.
test('Y2: r reads a project\'s Sessions again: a transcript added after the list was read is listed, the selection kept on its session; one removed is gone, the selection at its place; the list kept before r says so', async () => {
  const { cpSync, rmSync } = await import('node:fs');
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const app = new App({ source, cols: 200, rows: 24, timeZone: 'UTC' });
  const k = keyboard(app);
  const dir = path.join(r.root, '-work-demo'), added = '55555555-5555-4555-8555-555555555555.jsonl';
  try {
    app.start(); await app.idle();
    await k.press(KEY.enter);
    assert.equal(frameOf(app)[0], 'ltms-reader  Sessions  -work-demo');
    // as if that reading had taken a minute, as a large project's does: kept, not read again by itself (R.F2)
    source.engine.indexCache.get(dir).value.ms = 60_000;
    await k.press(KEY.escape);
    cpSync(path.join(FX, 'unicode.jsonl'), path.join(dir, added));
    await k.press(KEY.enter);
    let v = top(app.state), f = frameOf(app);
    assert.ok(!v.rows.some((x) => x.file === added), 'the list as it was read: the new transcript not in it');
    assert.match(f[2], /changed since: r reads it again$/, f[2]);
    await k.press(KEY.down);
    const chosen = v.rows[v.sel].file;
    assert.equal(v.rows.length, 2);
    await k.press('r');
    v = top(app.state); f = frameOf(app);
    assert.deepEqual(v.rows.map((x) => x.file).sort(), [...['11111111-1111-4111-8111-111111111111.jsonl', '22222222-2222-4222-8222-222222222222.jsonl'], added].sort(), 'read again: the new transcript listed');
    assert.equal(v.rows[v.sel].file, chosen, 'the selection on the same session');
    assert.ok(f.some((l) => l.startsWith('  55555555 ')), `its row: ${JSON.stringify(f)}`);
    assert.ok(f.some((l) => l.startsWith(`> ${v.rows[v.sel].p} `)), 'the selected row in sight');
    assert.doesNotMatch(f[2], /changed since/, 'read now: no notice');
    assert.match(f[1], /^3 sessions /, f[1]);
    // the selected session's file removed: r, and the selection at the place it was
    const at = v.sel;
    rmSync(path.join(dir, chosen));
    await k.press('r');
    v = top(app.state);
    assert.equal(v.rows.length, 2, 'the removed transcript is gone');
    assert.ok(!v.rows.some((x) => x.file === chosen));
    assert.equal(v.sel, Math.min(at, v.rows.length - 1), 'the selection at its place');
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

test('Y2: r reads Projects again: a project folder made after the list was read is listed, the selection kept on its project; on another view r says what it reads; typed into a line, r is text', async () => {
  const { cpSync, mkdirSync } = await import('node:fs');
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press(KEY.down);
    let v = top(app.state);
    assert.equal(v.rows[v.sel].name, '-work-other');
    mkdirSync(path.join(r.root, '-work-new'));
    cpSync(path.join(FX, 'demo.jsonl'), path.join(r.root, '-work-new', '66666666-6666-4666-8666-666666666666.jsonl'));
    assert.deepEqual(v.rows.map((x) => x.name), ['-work-demo', '-work-other'], 'not listed before r');
    await k.press('r');
    v = top(app.state);
    assert.deepEqual(v.rows.map((x) => x.name).sort(), ['-work-demo', '-work-new', '-work-other'], 'read again: the new project listed');
    assert.equal(v.rows[v.sel].name, '-work-other', 'the selection on the same project');
    let f = frameOf(app);
    assert.ok(f.some((l) => l.startsWith('> -work-other ')), `the selected row: ${JSON.stringify(f)}`);
    assert.match(f[1], /^3 project folders/, f[1]);
    // on a session's view: a note, nothing read
    await k.press(KEY.enter); await k.press(KEY.enter);
    assert.equal(top(app.state).kind, 'session');
    const rows = top(app.state).rows;
    await k.press('r');
    assert.equal(top(app.state).rows, rows, 'the session not read again');
    f = frameOf(app);
    assert.match(f[23], /^r reads a list again: Projects, or a project's Sessions/, f[23]);
    // typed into the search line, r is a letter of the words
    await k.press('/'); await k.press('rr');
    assert.equal(app.state.input.text, 'rr');
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

// Z4 (round 7): two of the mutants round 6's check planted on Y2 passed every test (its y2probe killed them): r pressed
// while a project's Sessions list was still being read started a second reading, with no note ('y2-reading-reread');
// and after a reading that failed, r said the list was being read, and read nothing ('y2-error-blocks').
test('Z4: r while a project\'s Sessions list is being read: a note says so, and no second reading starts; once read, the list is shown', async () => {
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const calls = [], sessions = source.sessions.bind(source);
  let release = () => {};
  const held = new Promise((res) => { release = res; });
  // the first reading held until let go, as a large project's takes a while; each call counted
  source.sessions = (p, o) => { calls.push(o ?? null); return calls.length === 1 ? held.then(() => sessions(p, o)) : sessions(p, o); };
  const app = new App({ source, cols: 120, rows: 30, timeZone: 'UTC' });
  try {
    app.start(); await app.idle();
    // the keys given as the screen gives them, not waiting for the App to be idle, which it is not until the reading is
    // let go
    app.key('\r', { name: 'return', sequence: '\r' });
    await new Promise((res) => setTimeout(res, 20));
    let v = top(app.state);
    assert.equal(v.kind, 'sessions');
    assert.ok(!v.data && !v.error, 'being read');
    app.key('r', { name: 'r', sequence: 'r' });
    assert.equal(app.state.note?.text, 'the sessions of -work-demo are being read');
    assert.equal(calls.length, 1, 'no second reading');
    release();
    await app.idle();
    v = top(app.state);
    assert.equal(v.rows.length, 2, 'the list, once read');
    assert.equal(calls.length, 1);
  } finally { release(); app.dispose(); source.dispose(); r.dispose(); }
});

test('Z4: r after a reading of a project\'s Sessions that failed: read again, afresh, and the list is shown', async () => {
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const calls = [], sessions = source.sessions.bind(source);
  source.sessions = (p, o) => { calls.push(o ?? null); return calls.length === 1 ? Promise.reject(new Error('a planted failure of ltms index')) : sessions(p, o); };
  const app = new App({ source, cols: 120, rows: 30, timeZone: 'UTC' });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press(KEY.enter);
    let v = top(app.state);
    assert.equal(v.kind, 'sessions');
    assert.ok(v.error, 'the reading failed');
    assert.equal(v.rows.length, 0);
    await k.press('r');
    v = top(app.state);
    assert.equal(calls.length, 2, 'read again');
    assert.deepEqual(calls[1], { fresh: true });
    assert.equal(v.error, null);
    assert.equal(v.rows.length, 2, 'the list shown');
    assert.equal(app.state.note, null, 'no note');
  } finally { app.dispose(); source.dispose(); r.dispose(); }
});

test('Y2: the keys screen, --help and the README list r', async () => {
  const { readFileSync } = await import('node:fs');
  const { KEYS } = await import('../src/views.mjs');
  const { USAGE } = await import('../src/start.mjs');
  assert.deepEqual(KEYS.find(([key]) => key === 'r'), ['r', 'in Projects and in a project\'s Sessions: read the list again, the selection kept on its row']);
  const r = makeRoot();
  const source = new RootSource({ root: r.root });
  const app = new App({ source, cols: 120, rows: 30, timeZone: 'UTC' });
  const k = keyboard(app);
  try {
    app.start(); await app.idle();
    await k.press('?');
    assert.ok(frameOf(app).some((l) => /^ {2}r {17}in Projects and in a project's Sessions: read the list again, the selection kept on its row$/.test(l)), JSON.stringify(frameOf(app)));
  } finally { app.dispose(); source.dispose(); r.dispose(); }
  assert.match(USAGE.replace(/\s+/g, ' '), /: opens an address; r reads a list again \(Projects, a project's Sessions\); \? the keys; q quits\./);
  assert.match(readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'README.md'), 'utf8'), /^\| `r` \| in Projects and in a project's Sessions: read the list again, the selection kept on the same row while it is there \|$/m);
});
