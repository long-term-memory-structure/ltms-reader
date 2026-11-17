// test/helpers.mjs — what the screen's tests share (not a test file: node --test runs only *.test.mjs here).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as REFERENCE from './uba-reference.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, '..');
export const FX = path.join(HERE, 'fixtures', 'ltms');
export const OWN = path.join(HERE, 'fixtures');
export const BIN = path.join(ROOT, 'bin', 'ltms-reader.mjs');
/** ltms's CLI, by the package's name: a route to it that does not pass through the code under test. */
export const CLI = createRequire(import.meta.url).resolve('long-term-memory-structure/dist/cli.js');

/** ltms's JSON lines for these arguments (its exit status is not checked: a file with warnings exits 1). */
export function ltms(args) {
  let out;
  try { out = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = String(e.stdout ?? ''); }
  return out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export const DEMO = '11111111-1111-4111-8111-111111111111.jsonl';
export const COMP = '22222222-2222-4222-8222-222222222222.jsonl';
export const UNI = '33333333-3333-4333-8333-333333333333.jsonl';
export const HEB = '44444444-4444-4444-8444-444444444444.jsonl';

/** A folder of project folders, made of the fixtures, in a folder of the test's own (never the user's projects):
 *  -work-demo (demo, compacted, and demo's agent in its own folder), -work-other (unicode, and the Hebrew-English
 *  transcript). Returns { root, dispose }. */
export function makeRoot(prefix = 'ltms-reader-screen-') {
  const base = mkdtempSync(path.join(tmpdir(), prefix));
  const root = path.join(base, 'projects');
  const demo = path.join(root, '-work-demo'), other = path.join(root, '-work-other');
  mkdirSync(path.join(demo, DEMO.slice(0, -6), 'subagents'), { recursive: true });
  mkdirSync(other, { recursive: true });
  cpSync(path.join(FX, 'demo.jsonl'), path.join(demo, DEMO));
  cpSync(path.join(FX, 'compacted.jsonl'), path.join(demo, COMP));
  cpSync(path.join(FX, 'agent-a0123456789abcdef.jsonl'), path.join(demo, DEMO.slice(0, -6), 'subagents', 'agent-a0123456789abcdef.jsonl'));
  cpSync(path.join(FX, 'unicode.jsonl'), path.join(other, UNI));
  cpSync(path.join(OWN, 'hebrew-english.jsonl'), path.join(other, HEB));
  // the projects are listed newest file first: -work-demo, then -work-other, whatever the copies' own times
  for (const [dir, day] of [[demo, 10], [other, 9]]) for (const f of [DEMO, COMP, UNI, HEB]) { try { utimesSync(path.join(dir, f), new Date(Date.UTC(2026, 10, day)), new Date(Date.UTC(2026, 10, day))); } catch {} }
  return { base, root, dispose: () => rmSync(base, { recursive: true, force: true }) };
}

/** The bytes a terminal sends for each key. */
export const KEY = Object.freeze({
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', pageup: '\x1b[5~', pagedown: '\x1b[6~', home: '\x1b[H', end: '\x1b[F',
  enter: '\r', escape: '\x1b', backspace: '\x7f', ctrlc: '\x03', ctrlu: '\x15',
});

/** Keys into an App the way the screen gives them: bytes decoded by readline's emitKeypressEvents. */
export function keyboard(app) {
  const input = new PassThrough();
  readline.emitKeypressEvents(input, { escapeCodeTimeout: 20 });
  input.on('keypress', (str, k) => app.key(str, k ?? {}));
  return {
    /** Send bytes, let them be decoded (a lone ESC waits for the timeout), then wait until nothing is being read. */
    async press(bytes) {
      input.write(bytes);
      await new Promise((r) => setImmediate(r));
      if (bytes.endsWith('\x1b')) await new Promise((r) => setTimeout(r, 60));
      await app.idle();
    },
  };
}

export const plainOf = (lines) => lines.map((l) => l.map((s) => s.text).join(''));

/** Streams standing for a terminal, and a process standing for this one, for src/main.mjs's main(): everything written,
 *  in the order written. */
export function terminal({ cols = 80, rows = 24 } = {}) {
  const log = [];
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.raw = [];
  stdin.setRawMode = (on) => { stdin.raw.push(on); return stdin; };
  const sink = (name) => Object.assign(new Writable({ write(chunk, enc, cb) { log.push([name, String(chunk)]); cb(); } }), { isTTY: true, columns: cols, rows });
  const stdout = sink('out'), stderr = sink('err');
  const proc = Object.assign(new EventEmitter(), { pid: 4242, exits: [], exit(code) { this.exits.push(code); }, kills: [], kill(pid, signal) { this.kills.push([pid, signal]); } });
  return { stdin, stdout, stderr, proc, log, out: () => log.filter(([n]) => n === 'out').map(([, s]) => s).join(''), err: () => log.filter(([n]) => n === 'err').map(([, s]) => s).join('') };
}

/** A transcript like the checker's (make_deep.py): a prompt, a call, its result, a reply; the result's toolUseResult a
 *  list nested `depth` deep holding `leaves` ones. */
export function deepRecord(file, depth, leaves) {
  const base = { isSidechain: false, userType: 'external', cwd: '/work/d', sessionId: 'dddddddd-0000-4000-8000-000000000000', version: '2.0.0', gitBranch: 'main', entrypoint: 'cli' };
  const u = (n) => `dd000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const usage = { input_tokens: 1, output_tokens: 1 };
  let v = new Array(leaves).fill(1);
  for (let i = 0; i < depth; i++) v = [v];
  const recs = [
    { ...base, parentUuid: null, type: 'user', message: { role: 'user', content: 'DEEP-T1 read the nested file' }, uuid: u(1), timestamp: '2026-03-01T10:00:00.000Z', promptSource: 'typed' },
    { ...base, parentUuid: u(1), type: 'assistant', message: { id: 'msg_d1', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'toolu_d1', name: 'Bash', input: { command: 'cat nested.json' } }], stop_reason: 'tool_use', usage }, requestId: 'req_d1', uuid: u(2), timestamp: '2026-03-01T10:00:01.000Z' },
    { ...base, parentUuid: u(2), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_d1', content: 'nested', is_error: false }] }, uuid: u(3), timestamp: '2026-03-01T10:00:02.000Z', toolUseResult: { data: v } },
    { ...base, parentUuid: u(3), type: 'assistant', message: { id: 'msg_d2', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage }, requestId: 'req_d2', uuid: u(4), timestamp: '2026-03-01T10:00:03.000Z' },
  ];
  writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/** At most `n` code points of s, with how long it was when it is longer. */
const bounded = (s, n) => { const cps = Array.from(s); return cps.length <= n ? s : `${cps.slice(0, n).join('')}... (${cps.length} code points)`; };

/**
 * Whether two lists of screen lines (each a list of segments { text, style, dir, par, at }) are the same, as
 * assert.deepStrictEqual has them, without node:assert's diff (round 6, Y3 (a): deepEqual over two lists of some 2,000
 * lines that all differed, each naming a paragraph of 100,000 characters, built a diff that took a 3 GB scope's memory,
 * and the test was killed instead of failing). Their lengths, then a sha256 of each (a segment's paragraph by its length
 * and its own sha256, computed once for each paragraph in `memo`); where they differ, the first line that does is written
 * out, at most 300 code points of each, a paragraph as its length, digest and first 16 units. Throws an
 * AssertionError (assert.fail: a message, no diff) when they differ.
 */
export function sameLines(got, want, what, memo = new Map()) {
  const parOf = (p) => {
    if (typeof p !== 'string') return p === undefined ? '(none)' : `(${typeof p})`;
    let d = memo.get(p);
    if (d === undefined) { d = `${p.length}:${createHash('sha256').update(p).digest('hex')}`; memo.set(p, d); }
    return d;
  };
  // each segment by its keys and their values (a paragraph by its digest), undefined told from null as deepStrictEqual
  // tells them
  const u = (v) => (v === undefined ? { undefined: true } : v);
  const keyOf = (line) => (Array.isArray(line) ? JSON.stringify(line.map((s) => Object.keys(s).sort().map((k) => [k, k === 'par' ? parOf(s[k]) : u(s[k])]))) : `(not a line: ${typeof line})`);
  const a = got.map(keyOf), b = want.map(keyOf);
  const digest = (keys) => { const h = createHash('sha256'); for (const k of keys) h.update(k).update('\n'); return h.digest('hex'); };
  const da = digest(a), db = digest(b);
  if (a.length === b.length && da === db) return;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const show = (line) => (line === undefined ? '(no line)' : !Array.isArray(line) ? `(not a line: ${typeof line})` : bounded(JSON.stringify(line.map((s) => (typeof s.par === 'string' ? { ...s, par: `<${s.par.length} units, sha256 ${parOf(s.par).split(':')[1].slice(0, 12)}, beginning ${s.par.slice(0, 16)}>` } : s))), 300));
  assert.fail(`${what}: ${got.length} lines (sha256 ${da.slice(0, 12)}) where ${want.length} were wanted (sha256 ${db.slice(0, 12)}); the first that differs is line ${i}:\n  got:  ${show(got[i])}\n  want: ${show(want[i])}`);
}

/** The left-to-right override "reader" mode writes around a row that holds right-to-left text (Y1, round 6). */
export const LRO = '\u202d', PDF = '\u202c';

/**
 * A row as the screen writes it (its escape sequences taken out), without the override around it, after checking it
 * (Y1, round 6): in "reader" mode, a row that holds right-to-left text (a character of class R, AL or AN, by the tests'
 * own reference of UAX #9) has LRO right after its first grapheme cluster and PDF as its last character, and no other;
 * any other row, and every row in "terminal" mode, has neither. Throws an AssertionError otherwise.
 */
export function withoutOverride(row, mode = 'reader') {
  const bare = row.replace(/[\u202c\u202d]/g, '');
  const rtl = mode === 'reader' && [...bare].some((c) => [REFERENCE.R, REFERENCE.AL, REFERENCE.AN].includes(REFERENCE.classOf(c.codePointAt(0))));
  if (!rtl) { assert.equal(row, bare, `${mode}: a row without the override: ${JSON.stringify(row)}`); return row; }
  const first = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(bare)][0].segment;
  assert.equal(row, `${first}${LRO}${bare.slice(first.length)}${PDF}`, `a row that holds right-to-left text, LRO after its first cluster and PDF last: ${JSON.stringify(row)}`);
  return bare;
}
