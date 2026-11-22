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

/** UAX #14's class HL, the Hebrew letters: the letters (General_Category Lo) of the Hebrew blocks, as UnicodeData.txt
 *  17.0.0 has them; ICU 78.3 (Unicode 17.0) gives the same 75 code points the class (measured in round 7). */
export const HEBREW_LETTER = /^[\u05d0-\u05ea\u05ef-\u05f2\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40-\ufb41\ufb43-\ufb44\ufb46-\ufb4f]$/;
/** UAX #14's LB9, as the tests have it (R8e, round 8): what it folds into the character before it, class CM and ZWJ, by
 *  LineBreak.txt 17.0.0, as ICU 78.3 gives it (round 8's probe cmsets.py: 2,704 code points, class SA's marks among them,
 *  which LB1 makes CM): the marks (General_Category M) but 31 of other classes (21 GL, U+0F7F BA, 2 VF, 7 VI), and 192
 *  that are not marks: C0 and C1 controls, ALM, ZWNJ, ZWJ, LRM, RLM, the embeddings, overrides and isolates, U+206A to
 *  U+206F, U+3035, U+FFF9 to U+FFFB, U+1BCA0 to U+1BCA3, U+1D173 to U+1D17A, the tags. */
export const MARKS_NOT_CM = [0x35c, 0x35d, 0x35e, 0x35f, 0x360, 0x361, 0x362, 0xf7f, 0x1aeb, 0x1b44, 0x1bf2, 0x1bf3, 0x1dcd, 0x1dfc, 0xa9c0, 0xfe20, 0xfe22, 0xfe24, 0xfe26, 0xfe27, 0xfe29, 0xfe2b, 0xfe2d, 0xfe2e, 0x11046, 0x1107f, 0x1134d, 0x113d0, 0x1193e, 0x11f42, 0x16fe4];
export const CM_NOT_MARK = /^[\u0000-\u0008\u000e-\u001f\u007f-\u0084\u0086-\u009f\u061c\u200c-\u200f\u202a-\u202e\u2066-\u206f\u3035\ufff9-\ufffb\u{1bca0}-\u{1bca3}\u{1d173}-\u{1d17a}\u{e0001}\u{e0020}-\u{e007f}]$/u;
export const lb9Folds = (cp) => { const c = String.fromCodePoint(cp); return /^\p{M}$/u.test(c) ? !MARKS_NOT_CM.includes(cp) : CM_NOT_MARK.test(c); };
/** The code point that ends at offset j of s (a surrogate pair read whole), and where it begins. */
export function codePointBefore(s, j) {
  const lo = s.charCodeAt(j - 1), hi = j >= 2 ? s.charCodeAt(j - 2) : 0;
  return lo >= 0xdc00 && lo <= 0xdfff && hi >= 0xd800 && hi <= 0xdbff ? [((hi - 0xd800) << 10) + (lo - 0xdc00) + 0x10000, j - 2] : [lo, j - 1];
}
/** The character LB9 gives the class of what ends at offset j of s, the run of what it folds before j passed over:
 *  [its code point, where it begins], or [-1, 0] where there is none. */
export function lb9Base(s, j) {
  while (j > 0) { const [cp, at] = codePointBefore(s, j); if (!lb9Folds(cp)) return [cp, at]; j = at; }
  return [-1, 0];
}
/** Whether what is before offset i of s is a Hebrew letter, what LB9 folds into it after it passed over (its marks, ZWJ,
 *  and the characters of class CM that are not marks: R8e, round 8): after a Hebrew letter, a hyphen-minus gives no
 *  break (LB21a: HL HY ×, unless a Hebrew letter follows). */
export function afterHebrewLetter(s, i) {
  const [cp] = lb9Base(s, i);
  return cp >= 0 && HEBREW_LETTER.test(String.fromCodePoint(cp));
}

/** The left-to-right override "reader" mode writes around a row that holds right-to-left text (Y1, round 6). */
export const LRO = '\u202d', PDF = '\u202c';

/** Whether a grapheme cluster takes no column, by the README's rule: every character in it a nonspacing or enclosing
 *  mark, or a format character but the soft hyphen, or a Hangul medial vowel or final consonant. */
export const takesNoColumn = (c) => [...c].every((ch) => ch !== '\u00ad' && /^[\p{Mn}\p{Me}\p{Cf}\u1160-\u11ff\ud7b0-\ud7ff]$/u.test(ch));

/** The left-to-right mark "reader" mode writes between such a row's first cluster that takes a column and its LRO (0.1.1).
 *  A transcript's own marks are written as they are, so the reader's is found by its place, never by its character. */
export const LRM = String.fromCharCode(0x200e);

/** A text for a failure's message: its JSON, with what a terminal does not show written as <U+XXXX>: DEL and the C1
 *  controls, the format characters (LRM, RLM, ALM, LRO, PDF, ZWSP and WJ among them), the line and paragraph separators
 *  (the claims run on 0.1.1, RV-4: JSON.stringify leaves them as they are, so that a message about a row with an RLM
 *  where its LRM goes read the same as one about the row as it should be). */
export const legible = (s) => (JSON.stringify(s) ?? String(s)).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => `<U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}>`);

/**
 * A row as the screen writes it (its escape sequences taken out), without the reader's own controls, after checking
 * where they are (Y1, round 6; Z3, round 7; 0.1.1): in "reader" mode, a row that holds right-to-left text (a character
 * of class R, AL or AN, by the tests' own reference of UAX #9) and a cluster that takes a column has LRM and LRO right
 * after the first such cluster (never in the row's first column: Z3) and PDF as its last character, and no other LRO or
 * PDF; a row that holds right-to-left text but no cluster that takes a column, any other row, and every row in
 * "terminal" mode, have no LRO and no PDF. Any other LRM is a transcript's own, written as it is, and is kept in its
 * place in what this returns: the reader's LRM is found by its place, never by its character; and where the LRM and LRO
 * are is where a grapheme cluster of the row's text ends, the three taken out (Intl.Segmenter: the repairs' re-check,
 * its P1, the two written between a letter and its mark, passed, as the segmenter then read the letter alone as the
 * row's first cluster). So on a row without the
 * override this cannot tell a stray LRM of the reader's from a transcript's (the claims run on 0.1.1, RV-3: this said
 * such a row has "none of the three"); a test that compares the row's text with displayOrder's tells them apart. Throws
 * an AssertionError otherwise, the row in its message as legible() writes it.
 */
export function withoutOverride(row, mode = 'reader') {
  const bare = row.replace(/[\u202c\u202d]/g, '');
  const rtl = mode === 'reader' && [...bare].some((c) => [REFERENCE.R, REFERENCE.AL, REFERENCE.AN].includes(REFERENCE.classOf(c.codePointAt(0))));
  const cs = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(bare)].map((x) => x.segment), k = cs.findIndex((c) => !takesNoColumn(c));
  if (!rtl || k < 0) { assert.equal(row, bare, `${mode}: a row without the override: ${legible(row)}`); return row; }
  const first = cs.slice(0, k + 1).join(''), rest = bare.slice(first.length + LRM.length);
  assert.equal(row, `${first}${LRM}${LRO}${rest}${PDF}`, `a row that holds right-to-left text, LRM and LRO after its first cluster that takes a column and PDF last: ${legible(row)}`);
  const text = `${first}${rest}`;
  assert.ok([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].some((x) => x.index + x.segment.length === first.length), `the LRM and LRO inside a grapheme cluster of the row's text: ${legible(row)}`);
  return text;
}
