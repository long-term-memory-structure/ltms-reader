// test/escapes.test.mjs — what a transcript holds never reaches the terminal as a control. The whole command (src/main.mjs)
// runs on streams of this test's own, standing for a terminal, over test/fixtures/escapes.jsonl (ESC sequences: colours,
// cursor moves, the alternate screen, a title, a hyperlink, device queries; OSC 52, which writes the clipboard; BEL; C1
// controls, raw in the file; the other C0 controls and DEL) and over a folder of projects whose own names hold ESC and BEL.
// Every view is drawn, every record as text and as JSON, a search and the keys; then every byte written is read: the only
// escape sequences are the reader's own (the alternate screen, the cursor, wrapping, a position, an erase, its styles),
// and no other control character is there at all. Then each way out restores the terminal.
import { EventEmitter } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/main.mjs';
import { ENTER, LEAVE } from '../src/screen.mjs';
import { width } from '../src/text.mjs';
import { top } from '../src/views.mjs';
import { KEY, OWN } from './helpers.mjs';

const FILE = path.join(OWN, 'escapes.jsonl');
/** The reader's own sequences: the alternate screen, the cursor, wrapping, a position, an erase, and its styles. */
const OWN_SEQ = /^(?:\x1b\[\?1049[hl]|\x1b\[\?25[hl]|\x1b\[\?7[hl]|\x1b\[\d{1,3};1H|\x1b\[K|\x1b\[(?:0|1|2|7|31|36)m)/;

/** Every place in `bytes` where something other than the reader's own sequences would act on a terminal. */
export function strangers(bytes) {
  const bad = [];
  for (let i = 0; i < bytes.length;) {
    const c = bytes.codePointAt(i);
    if (c === 0x1b) {
      const m = OWN_SEQ.exec(bytes.slice(i, i + 16));
      if (!m) { bad.push({ at: i, what: JSON.stringify(bytes.slice(i, i + 12)) }); i++; continue; }
      i += m[0].length; continue;
    }
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) bad.push({ at: i, what: `U+${c.toString(16).padStart(4, '0')}` });
    i += c > 0xffff ? 2 : 1;
  }
  return bad;
}

/** Streams standing for a terminal, and a process standing for this one: everything written, in the order written. */
function terminal({ cols = 80, rows = 24 } = {}) {
  const log = [];
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.raw = [];
  stdin.setRawMode = (on) => { stdin.raw.push(on); return stdin; };
  const sink = (name) => Object.assign(new Writable({ write(chunk, enc, cb) { log.push([name, String(chunk)]); cb(); } }), { isTTY: true, columns: cols, rows });
  const stdout = sink('out'), stderr = sink('err');
  const proc = Object.assign(new EventEmitter(), { exits: [], exit(code) { this.exits.push(code); } });
  return { stdin, stdout, stderr, proc, log, out: () => log.filter(([n]) => n === 'out').map(([, s]) => s).join(''), err: () => log.filter(([n]) => n === 'err').map(([, s]) => s).join('') };
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
  for (const shown of ['␛]52;c;cGF5bG9hZA==\\x07 clipboard', '␛[2J␛[H cleared', '␛[?1049l left', '\\x9b31m csi', '\\x85 nel', 'carriage\\x0d return', 'delete\\x7f', 'nul\\x00', '␛[2JBash', 'peer␛]52;c;b3JpZ2lu\\x07']) {
    assert.ok(text.includes(shown), `shown as text: ${JSON.stringify(shown)}`);
  }
  assert.equal(t.err(), '', 'nothing on stderr');
});

test('a folder of projects whose names hold ESC and BEL: shown, not acted on', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'ltms-reader-esc-'));
  try {
    const project = path.join(base, 'projects', '-work-\x1b]0;title\x07-esc');
    mkdirSync(project, { recursive: true });
    cpSync(FILE, path.join(project, '\x1b[2J\x07x-55555555.jsonl'));
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
    assert.ok(out.includes('-work-␛]0;title\\x07-esc'), 'the project\'s name, shown');
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
