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
    assert.match(f[2], /^this list was read at \d{4}-\d\d-\d\d \d\d:\d\d, and 1 file changed since: it is read again when ltms-reader starts again$/, f[2]);
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
    const notice = `this list was read at ${at.slice(0, 10)} ${at.slice(11, 16)}, and 1 file changed since: it is read again when ltms-reader starts again`;
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
    assert.equal(f[2], 'this list was read at 2026-11-16 05:43, and 1 file changed since: it is read', 'the notice, on two lines at 80 columns');
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
        const at = f.findIndex((l) => l.startsWith('  session '));
        assert.ok(at >= 2, `${kind} counts, ${cols} x ${rows}: the column headings`);
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
