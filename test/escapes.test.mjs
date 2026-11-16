// test/escapes.test.mjs — what a transcript holds never reaches the terminal as a control. The whole command (src/main.mjs)
// runs on streams of this test's own, standing for a terminal, over test/fixtures/escapes.jsonl (ESC sequences: colours,
// cursor moves, the alternate screen, a title, a hyperlink, device queries; OSC 52, which writes the clipboard; BEL; C1
// controls, raw in the file; the other C0 controls and DEL) and over a folder of projects whose own names hold ESC and BEL.
// Every view is drawn, every record as text and as JSON, a search and the keys; then every byte written is read: the only
// escape sequences are the reader's own (the alternate screen, the cursor, wrapping, a position, an erase, its styles),
// and no other control character is there at all. Then each way out restores the terminal.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/main.mjs';
import { ENTER, LEAVE } from '../src/screen.mjs';
import { width } from '../src/text.mjs';
import { top } from '../src/views.mjs';
import { KEY, OWN, terminal } from './helpers.mjs';

const FILE = path.join(OWN, 'escapes.jsonl');
/** The reader's own sequences: the alternate screen, the cursor, wrapping, bracketed paste, a position, a line erased,
 *  and its styles. */
const OWN_SEQ = /^(?:\x1b\[\?1049[hl]|\x1b\[\?25[hl]|\x1b\[\?7[hl]|\x1b\[\?2004[hl]|\x1b\[\d{1,3};1H|\x1b\[2?K|\x1b\[(?:0|1|2|7|31|36)m)/;

/** What reorders or hides text (R.F5): bidirectional embeddings, overrides and isolates, the byte order mark, the line
 *  and paragraph separators, the tag characters. */
const reordersOrHides = (c) => (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff || c === 0x2028 || c === 0x2029 || (c >= 0xe0000 && c <= 0xe007f);

/** Every place in `bytes` where something other than the reader's own sequences would act on a terminal, or would
 *  reorder or hide what the reader writes. */
export function strangers(bytes) {
  const bad = [];
  for (let i = 0; i < bytes.length;) {
    const c = bytes.codePointAt(i);
    if (c === 0x1b) {
      const m = OWN_SEQ.exec(bytes.slice(i, i + 16));
      if (!m) { bad.push({ at: i, what: JSON.stringify(bytes.slice(i, i + 12)) }); i++; continue; }
      i += m[0].length; continue;
    }
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || reordersOrHides(c)) bad.push({ at: i, what: `U+${c.toString(16).padStart(4, '0')}` });
    i += c > 0xffff ? 2 : 1;
  }
  return bad;
}

const settle = async (h, ms = 5) => { await new Promise((r) => setTimeout(r, ms)); await h.app.idle(); };
/** Each key, and the frame it gives checked: within the columns, no control character in its text. */
async function press(t, h, bytes) {
  t.stdin.write(bytes);
  await settle(h, bytes.endsWith('\x1b') ? 80 : 5);
  if (h.app.quitting !== null) return;
  const { cols, rows } = h.app.state;
  h.app.lines().forEach((l, i) => {
    const text = l.map((x) => x.text).join('');
    assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(text), `line ${i + 1}: a control character`);
    assert.ok(width(text) <= (i === rows - 1 ? cols - 1 : cols), `line ${i + 1} is ${width(text)} columns: ${JSON.stringify(text)}`);
  });
}

/** Every string in a parsed value, joined. */
const strings = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? Object.values(v).map(strings).join('\n') : '');

test('the screen enters and leaves by these bytes: the alternate screen, the cursor, wrapping, bracketed paste (R.F8); styles reset on the way out', () => {
  assert.equal(ENTER, '\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h');
  assert.equal(LEAVE, '\x1b[?2004l\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l');
});

test('the fixture holds what a terminal would act on', () => {
  const all = strings(readFileSync(FILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
  for (const [what, re] of [['OSC 52', /\x1b\]52;c;/], ['a title', /\x1b\]0;/], ['the alternate screen', /\x1b\[\?1049[hl]/], ['a cursor move', /\x1b\[10;10H/], ['BEL', /\x07/], ['a reset', /\x1bc/], ['CR', /\r/], ['DEL', /\x7f/], ['BS', /\x08/], ['NUL', /\x00/], ['VT and FF', /\x0b[\s\S]*\x0c|\x0c[\s\S]*\x0b/]]) assert.match(all, re, what);
  for (const c of ['\u009b', '\u0085', '\u009d', '\u009c', '\u0090', '\u009e', '\u009f', '\u008d']) assert.ok(readFileSync(FILE, 'utf8').includes(c), `C1 U+${c.codePointAt(0).toString(16)} raw in the file`);
});

test('over the escapes transcript, every view, record and search: no byte acts on the terminal but the reader\'s own', async () => {
  const t = terminal();
  const h = main([FILE], { stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, env: { NO_COLOR: '' }, proc: t.proc });
  assert.equal(typeof h, 'object', 'the screen opened');
  await settle(h);
  const sv = top(h.app.state);
  assert.equal(sv.kind, 'session');
  for (let i = 0; i < sv.rows.length; i++) {
    sv.sel = i;
    await press(t, h, KEY.enter);
    const tv = top(h.app.state);
    for (let k = 0; k < tv.rows.length; k++) {
      tv.sel = k;
      await press(t, h, KEY.enter);
      assert.equal(top(h.app.state).kind, 'record', `${tv.rows[k].a} opens`);
      await press(t, h, KEY.end); await press(t, h, 'j'); await press(t, h, KEY.end); await press(t, h, KEY.left);
    }
    await press(t, h, KEY.left);
  }
  await press(t, h, '/'); await press(t, h, 'clipboard'); await press(t, h, KEY.enter);
  assert.equal(top(h.app.state).kind, 'search');
  assert.ok(top(h.app.state).result.hits.length >= 1, 'ltms search finds the word next to the OSC 52 sequence');
  await press(t, h, KEY.down); await press(t, h, KEY.enter);
  await press(t, h, '?'); await press(t, h, 'x');
  await press(t, h, 'q');
  assert.deepEqual(t.proc.exits, [0]);
  const out = t.out();
  assert.deepEqual(strangers(out), [], 'only the reader\'s own sequences');
  assert.ok(out.startsWith(ENTER) && out.endsWith(LEAVE), 'the alternate screen entered first, left last');
  assert.deepEqual(t.stdin.raw, [true, false], 'raw mode on, then off');
  // what the transcript held is on the screen, inert (read with the reader's own sequences taken out, so that a record's
  // lines, wrapped at the columns, join again)
  const text = out.replace(new RegExp(OWN_SEQ.source.slice(1), 'g'), '');
  for (const shown of ['␛]52;c;cGF5bG9hZA==\\x07 clipboard', '␛[2J␛[H cleared', '␛[?1049l left', '\\x9b31m csi', '\\x85 nel', 'carriage\\x0d return', 'delete\\x7f', 'nul\\x00', '␛[2JBash', 'peer␛]52;c;b3JpZ2lu\\x07',
    'reorder \\u202edesserp\\u202c isolate \\u2067ltr\\u2069 embed \\u202ax\\u202c bom\\ufeff ls\\u2028ps\\u2029 tags\\u{e0041}\\u{e0042}', 'Bash\\u202e', 'echo \\u2068x\\u2069\\ufeff', 'out \\u202dy\\u202c\\u2028\\u2029 \\u2066z\\u2069\\u{e0041}', 'done \\u202ederedro\\u202c \\ufeff']) {
    assert.ok(text.includes(shown), `shown as text: ${JSON.stringify(shown)}`);
  }
  assert.equal(t.err(), '', 'nothing on stderr');
});

test('a folder of projects whose names hold ESC and BEL: shown, not acted on', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'ltms-reader-esc-'));
  try {
    const project = path.join(base, 'projects', `-work-\x1b]0;title\x07-esc${String.fromCodePoint(0x202e)}`);
    mkdirSync(project, { recursive: true });
    cpSync(FILE, path.join(project, `\x1b[2J\x07x-55555555${String.fromCodePoint(0x2068)}.jsonl`));
    const t = terminal({ cols: 200, rows: 60 });
    const h = main([path.join(base, 'projects')], { stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, env: {}, proc: t.proc });
    await settle(h);
    await press(t, h, KEY.enter); await settle(h, 50);
    assert.equal(top(h.app.state).kind, 'sessions');
    assert.equal(top(h.app.state).rows.length, 1, 'ltms index lists the session');
    await press(t, h, KEY.enter); await press(t, h, KEY.enter); await press(t, h, KEY.enter);
    assert.equal(top(h.app.state).kind, 'record');
    await press(t, h, KEY.ctrlc);
    assert.deepEqual(t.proc.exits, [130]);
    const out = t.out();
    assert.deepEqual(strangers(out), []);
    assert.ok(out.includes('-work-␛]0;title\\x07-esc\\u202e'), 'the project\'s name, shown, its override too (R.F5)');
    assert.ok(out.includes('x-55555555\\u2068.jsonl'), 'the file\'s name, its isolate shown (R.F5)');
    assert.ok(out.includes('␛[2J\\x07x-5'), 'the session\'s prefix, shown');
    assert.ok(/\x1b\[3[16]m/.test(out), 'colour, with NO_COLOR unset');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('NO_COLOR set: no colour, the selected row still in reverse', async () => {
  const t = terminal();
  const h = main([FILE], { stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, env: { NO_COLOR: '1' }, proc: t.proc });
  await settle(h);
  await press(t, h, KEY.enter); await press(t, h, KEY.down); await press(t, h, 'q');
  const out = t.out();
  assert.ok(!/\x1b\[3\dm/.test(out), 'no colour');
  assert.ok(out.includes('\x1b[7m> '), 'reverse for the selected row');
  assert.deepEqual(strangers(out), []);
});

test('every way out restores the terminal: q, Ctrl-C, SIGTERM, SIGHUP, SIGINT, an uncaught error, a rejection', async () => {
  const ways = [
    ['q', (t) => t.stdin.write('q'), 0],
    ['Ctrl-C', (t) => t.stdin.write(KEY.ctrlc), 130],
    ['SIGTERM', (t) => t.proc.emit('SIGTERM'), 143],
    ['SIGHUP', (t) => t.proc.emit('SIGHUP'), 129],
    ['SIGINT', (t) => t.proc.emit('SIGINT'), 130],
    ['an uncaught error', (t) => t.proc.emit('uncaughtException', Object.assign(new TypeError('a secret from a transcript'), { stack: `TypeError: a secret from a transcript\n    at x (file://${path.join(OWN, '..', '..', 'src', 'app.mjs')}:1:1)\n    at elsewhere (/somewhere/else.js:2:2)` })), 1],
    ['a rejection', (t) => t.proc.emit('unhandledRejection', new Error('another secret')), 1],
  ];
  for (const [what, act, code] of ways) {
    const t = terminal();
    const h = main([FILE], { stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, env: {}, proc: t.proc });
    await settle(h);
    await press(t, h, KEY.enter);
    act(t);
    await settle(h);
    assert.deepEqual(t.proc.exits, [code], `${what}: exit ${code}`);
    assert.deepEqual(t.stdin.raw, [true, false], `${what}: raw mode off`);
    const out = t.out();
    assert.ok(out.endsWith(LEAVE), `${what}: the terminal restored last`);
    assert.equal(out.indexOf(LEAVE), out.length - LEAVE.length, `${what}: restored once`);
    if (code === 1) {
      const err = t.err();
      const order = t.log.map(([n]) => n);
      assert.ok(order.lastIndexOf('out') < order.indexOf('err'), `${what}: the error printed after the restore`);
      assert.match(err, /^ltms-reader: an internal error \((TypeError|Error)\) ended it; the terminal was restored\.\n/);
      assert.ok(!err.includes('secret'), `${what}: the message is not printed`);
      assert.match(err, /Its message is not printed: it could quote a transcript\.\n$/);
      if (what === 'an uncaught error') { assert.ok(err.includes('src/app.mjs:1:1'), 'where it happened, in this package'); assert.ok(!err.includes('/somewhere/else.js'), 'not elsewhere'); }
    } else assert.equal(t.err(), '', `${what}: nothing on stderr`);
    t.stdin.write('q'); t.proc.emit('SIGTERM');
    assert.deepEqual(t.proc.exits, [code], `${what}: nothing after the way out`);
  }
});

// N5 (S377): SIGKILL of the command's own process left the screen's process raw until the terminal hung up. The command
// opens an IPC channel to it; when the command's process is gone, the channel closes, and the screen restores the
// terminal and ends, as on SIGHUP. The channel is unref'd: it keeps nothing running.
test("N5: the command's process gone (its IPC channel closed), the terminal still this process group's: the terminal restored, raw mode off, then SIGKILL to itself (R3); nothing on stderr", async () => {
  const t = terminal();
  t.proc.channel = { unrefs: 0, unref() { this.unrefs++; } };
  const h = main([FILE], { stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, env: {}, proc: t.proc, owner: () => ({ ours: true, group: 7 }), modes: () => 'raw' });
  await settle(h);
  await press(t, h, KEY.enter);
  t.proc.emit('disconnect');
  await settle(h);
  assert.deepEqual(t.proc.kills, [[4242, 'SIGKILL']], 'it ends by SIGKILL: not by Node\'s exit, which would put back the modes it started with');
  assert.deepEqual(t.proc.exits, [], 'no exit');
  assert.deepEqual(t.stdin.raw, [true, false], 'raw mode off');
  assert.ok(t.out().endsWith(LEAVE), 'the terminal restored last');
  assert.equal(t.err(), '', 'nothing on stderr: the pipe to the command is gone');
  assert.equal(t.proc.channel.unrefs, 1, 'the channel unref\'d once: it keeps nothing running');
});

// R3 (S377, round 3): a shell with job control has taken the terminal back when the command's process is gone: the
// screen's process writes the leave sequence and leaves the modes to the shell; if they are still the screen's raw
// modes (a shell that sets none), Node's own exit puts back those this process started with.
for (const [what, now, end] of [
  ['the shell has set its own modes: they are left as they are; SIGKILL to itself', 'the shell\'s', { kills: [[4242, 'SIGKILL']], exits: [] }],
  ['the modes are still the screen\'s raw ones (a shell that sets none): Node\'s own exit puts back the modes it started with', 'raw', { kills: [], exits: [129] }],
]) {
  test(`R3: the command's process gone, the terminal taken back by a shell; ${what}`, async () => {
    const t = terminal();
    t.proc.channel = { unref() {} };
    let reads = 0;
    const h = main([FILE], { stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, env: {}, proc: t.proc, owner: () => ({ ours: false, group: 7 }), modes: () => (reads++ === 0 ? 'raw' : now) });
    await settle(h);
    t.proc.emit('disconnect');
    await settle(h);
    assert.deepEqual({ kills: t.proc.kills, exits: t.proc.exits }, end);
    assert.deepEqual(t.stdin.raw, [true], 'the modes not set here: the kernel refuses them to a background group, and they are the shell\'s');
    assert.ok(t.out().endsWith(LEAVE), 'the leave sequence written last');
    assert.equal(reads, 2, 'the modes read when the screen opened, and once after');
  });
}

test("N5: without a channel (the screen run by itself), nothing is watched", async () => {
  const t = terminal();
  const h = main([FILE], { stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, env: {}, proc: t.proc });
  await settle(h);
  t.proc.emit('disconnect');
  await settle(h);
  assert.deepEqual(t.proc.exits, [], 'still running');
  await press(t, h, 'q');
  assert.deepEqual(t.proc.exits, [0]);
});

test('the window resized: the frame drawn whole again at its new size', async () => {
  const t = terminal();
  const h = main([FILE], { stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, env: {}, proc: t.proc });
  await settle(h);
  assert.ok(t.out().includes('\x1b[24;1H') && !t.out().includes('\x1b[25;1H'), 'drawn at 24 rows');
  const before = t.out().length;
  Object.assign(t.stdout, { columns: 120, rows: 40 });
  t.stdout.emit('resize');
  await settle(h);
  const again = t.out().slice(before);
  for (let row = 1; row <= 40; row++) assert.ok(again.includes(`\x1b[${row};1H`), `row ${row} drawn again`);
  assert.deepEqual([h.app.state.cols, h.app.state.rows], [120, 40]);
  await press(t, h, 'q');
  assert.deepEqual(strangers(t.out()), []);
});

test('the writer itself: a control character in a line, from anywhere, goes out visible', async () => {
  const { frameBytes } = await import('../src/screen.mjs');
  const lines = [[{ text: 'a\x1b]52;c;eA==\x07b', style: null }, { text: '\u009b2J\nnext\tcol\r', style: 'sel' }], []];
  const out = frameBytes(lines, { cols: 80, rows: 2, colour: false });
  assert.deepEqual(strangers(out), []);
  assert.ok(out.includes('a␛]52;c;eA==\\x07b'));
  assert.ok(out.includes('\\x9b2J\\nnext\\tcol\\x0d'), 'a new line and a tab inside a line are shown too');
});

test('Esc alone goes back within a tenth of a second (readline waits half a second unless told)', async () => {
  const t = terminal();
  const h = main([FILE], { stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, env: {}, proc: t.proc });
  await settle(h);
  await press(t, h, KEY.enter);
  assert.equal(top(h.app.state).kind, 'turn');
  t.stdin.write(KEY.escape);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(top(h.app.state).kind, 'session', 'back after 100 ms');
  await press(t, h, 'q');
});

// R.F6: a row the reader counts as full width was not erased; a terminal that draws an emoji and VS16 one column wide
// (wcwidth: U+26A0 one, U+FE0F none) drew it shorter, and the cells after it kept the frame before.
/** A terminal of `rows` x `cols` cells that draws every code point one column wide but U+FE0F (none), and reads the
 *  reader's position (CSI r;1H), erase (CSI K, CSI 2K) and style sequences; what it shows, row by row. */
function narrowEmojiTerminal(cols, rows) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
  let r = 0, c = 0;
  return {
    write(bytes) {
      for (let i = 0; i < bytes.length;) {
        const m = /^\x1b\[(?:(\d+);1H|(2?)K|[\d;?]*[A-Za-z])/.exec(bytes.slice(i, i + 16));
        if (m) {
          if (m[1]) { r = Number(m[1]) - 1; c = 0; }
          else if (m[0].endsWith('K')) { for (let k = m[2] ? 0 : c; k < cols; k++) grid[r][k] = ' '; }
          i += m[0].length; continue;
        }
        const ch = String.fromCodePoint(bytes.codePointAt(i));
        i += ch.length;
        if (ch === '\ufe0f') continue;
        if (c < cols) grid[r][c++] = ch;
      }
    },
    screen: () => grid.map((row) => row.join('')),
  };
}

test('R.F6: each row is erased whole before it is written: ESC[2K right after its position, full rows and short ones alike', async () => {
  const { frameBytes } = await import('../src/screen.mjs');
  const full = [{ text: 'x'.repeat(40), style: null }], short = [{ text: 'y', style: 'dim' }];
  const out = frameBytes([full, short, [], full], { cols: 40, rows: 4, colour: false });
  for (let row = 1; row <= 4; row++) assert.ok(out.includes(`\x1b[${row};1H\x1b[2K`), `row ${row}: erased after its position: ${JSON.stringify(out)}`);
});

test('R.F6: on a terminal that draws an emoji with VS16 one column wide, no cell of the frame before is left', async () => {
  const { frameBytes } = await import('../src/screen.mjs');
  const { cut } = await import('../src/text.mjs');
  const cols = 80, rows = 6;
  const before = Array.from({ length: rows }, () => [{ text: 'X'.repeat(cols), style: null }]);
  // U+26A0 U+FE0F and ' check ', cut to the screen's width as the reader counts it: 80 columns, the emoji two each
  const row = cut('\u26a0\ufe0f check '.repeat(20), cols).text;
  const after = Array.from({ length: rows }, () => [{ text: row, style: null }]);
  const term = narrowEmojiTerminal(cols, rows);
  term.write(frameBytes(before, { cols, rows }));
  term.write(frameBytes(after, { cols, rows }));
  const stale = term.screen().filter((l) => l.includes('X'));
  assert.deepEqual(stale, [], 'rows that keep cells of the frame before');
  // the model itself: the row is drawn nine columns short there
  assert.equal(term.screen()[0].trimEnd().length, cols - 9);
});
