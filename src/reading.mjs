// src/reading.mjs — one transcript read in the reader's own process, with ltms's parser, and the session view of it
// (src/view.mjs). A terminal app has no editor to protect, so it needs no separate reading process (DESIGN.md, "One view
// layer, two faces").
//
// The file is opened without following a symbolic link at its last step (O_NOFOLLOW), and without blocking on a FIFO put
// at its name (O_NONBLOCK); it must be a regular file, and it is read from the descriptor checked. A transcript too
// large to parse in this process's memory is refused before it is read, with its size and the NODE_OPTIONS that would
// let it be read: the rule is ltms's own (a file over a tenth of the runtime's memory limit is skipped, so the reader
// and ltms's lists agree on which files can be read; parsing takes 5 to 8 times a file's size), the memory limit read
// as memoryLimit reads it, and a file over 480 MB cannot be read at all, by JavaScript's limit on a string's length.
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import path from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { parseTranscript } from '#ltms';
import { prefixOf, sessionView } from './view.mjs';

export const MB = 1024 * 1024;
/** No memory setting reads a file over this: its text would pass JavaScript's limit on a string's length. */
export const STRING_MAX = 480 * MB;

export class Refusal extends Error { constructor(kind, message) { super(message); this.kind = kind; } }

/** NODE_OPTIONS's words, as Node reads them (its ParseNodeOptionsEnvVar): apart at spaces, a double-quoted stretch part
 *  of a word with its spaces, a backslash in one taking the character after it as it is. */
function nodeOptionWords(s) {
  const out = [];
  let word = null, quoted = false;
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (c === '\\' && quoted && i + 1 < s.length) c = s[++i];
    else if (c === '"') { quoted = !quoted; continue; }
    else if (c === ' ' && !quoted) { if (word !== null) out.push(word); word = null; continue; }
    word = (word ?? '') + c;
  }
  if (word !== null) out.push(word);
  return out;
}

/** The memory Node reads for --max-old-space-size-percentage: the process's constraint (a cgroup's limit), where there
 *  is one, else the machine's. */
function memoryOfNode() {
  const c = typeof process.constrainedMemory === 'function' ? process.constrainedMemory() : 0;
  return c > 0 && Number.isSafeInteger(c) ? c : totalmem();
}

/**
 * The memory limit the size rules read (Z1, round 7): Node's heap limit (V8's heap_size_limit, ltms's measure), but no
 * more than the old space's where Node's flags set it. A heap limit is the old space and the young generation's reserve,
 * and the reserve is sized from the machine's memory, not from the old space set: with --max-old-space-size=16, measured,
 * the heap limit is 64 MB on Node 20.20.2 and 22.23.3, 208 MB on 24.22.3 and 112 MB on 26.13.1 (with
 * --max-semi-space-size=1 too, 19 MB). A transcript's text and what its parse makes of it live in the old space: by a
 * tenth of the heap limit, under an old space of 16 MB, Node 24 read a transcript of 8 to 20 MB and its parse ran the old
 * space out (R.F14 on Box B's Node 24.18.0), and Node 26 one of 10 or 11 MB (round 7's probe, admit.mjs). The flags, as
 * Node and V8 take them (measured on Node 22.23.3 and 24.22.3): --max-old-space-size=N (or --max_old_space_size), in
 * NODE_OPTIONS or on node's command line, the command line's over NODE_OPTIONS', the last given, 0 setting none; and
 * --max-old-space-size-percentage=P (Node 22 and later), the old space at P per cent of the memory Node reads (in MB,
 * rounded down), over --max-old-space-size wherever each is given. Where no flag sets the old space, V8 sizes the old
 * space and the young generation together, from the memory it finds, and the heap limit is the measure. Not read: a
 * limit set by --max-heap-size (the heap limit is then about it) or by an embedder. `heap`, `execArgv`, `nodeOptions` and
 * `memory` are this process's when not given.
 */
export function memoryLimit({ heap = getHeapStatistics().heap_size_limit, execArgv = process.execArgv, nodeOptions = process.env.NODE_OPTIONS, memory = memoryOfNode() } = {}) {
  let size = 0, percent = 0;
  for (const word of [...(typeof nodeOptions === 'string' ? nodeOptionWords(nodeOptions) : []), ...execArgv]) {
    const m = /^--max[-_]old[-_]space[-_]size(?:[-_](percentage))?=(.*)$/.exec(word);
    if (!m) continue;
    const v = Number(m[2]);
    if (m[1]) { if (v > 0 && v <= 100) percent = v; } else if (Number.isInteger(v) && v >= 0) size = v;
  }
  const old = percent > 0 ? Math.floor((Math.floor(memory / MB) * percent) / 100) * MB : size > 0 ? size * MB : null;
  return old === null ? heap : Math.min(heap, old);
}

/** The largest transcript this process reads, by ltms's rule, for a memory limit of `heapLimit` bytes. */
export const sizeLimit = (heapLimit) => Math.min(STRING_MAX, Math.floor(heapLimit / 10));

/** Why a file of `size` bytes is not read here (with the NODE_OPTIONS that would let it be, before `again`, the command
 *  that was run: src/start.mjs's againOf), or null when it is read. `heapLimit`: the memory limit (memoryLimit). */
export function tooLarge(size, heapLimit = memoryLimit(), again = 'npx ltms-reader') {
  const limit = sizeLimit(heapLimit);
  if (size <= limit) return null;
  const mb = (n) => `${Math.ceil(n / MB).toLocaleString('en-US')} MB`;
  if (size > STRING_MAX) return `it is ${mb(size)}: no memory setting lets it be read, since its text would pass JavaScript's limit on a string's length (about ${mb(STRING_MAX)} here); ltms skips it too`;
  // ltms's rule reads a file of up to a tenth of the heap's limit; the old space alone, set to ten times the size, is enough
  const need = Math.ceil((size * 10) / MB / 256) * 256;
  return `it is ${mb(size)}, and this process reads a transcript of up to ${mb(limit)} (a tenth of its memory limit, as ltms reads; parsing takes 5 to 8 times a file's size). To read it, give Node more memory: NODE_OPTIONS=--max-old-space-size=${need} ${again}`;
}

/** What a transcript's parse takes, at most, for each byte of the file (ltms's figure: 5 to 8 times a file's size). */
export const PARSE_PER_BYTE = 8;
/** What a record's view takes, at most, for each byte of the record's line in the file. Measured (R.F1's probe, one
 *  record of each kind): its strings (the record as JSON, and the parts it re-writes as JSON) and the marks of its lines
 *  took up to 5.5 bytes a byte, for an array of numbers (re-written with indents, some 6 characters a byte); a JSON
 *  that holds one character outside Latin-1 takes two bytes a character, so up to 12; this is that with a margin. */
export const RECORD_VIEW_PER_BYTE = 16;

/** What a record's view needs beside the JSON it writes (N3), measured: over six records nested deep (lists 200 to 990
 *  deep, one of Hebrew strings), the view opened, its text and its JSON laid out, at an old space of 9 to 24 MB more
 *  than that JSON (recordViewBytes) on Node 26, and of 18 to 73 MB more on Node 20; Node's heap limit, which this rule
 *  read then, is the old space and 96 MB more on Node 26, 48 on Node 20. At the heap where each failed, on both, the rule
 *  refuses it; and so it does reading the old space set (memoryLimit, Z1), the smaller. */
export const BUILT_MARGIN = 96 * MB;

/**
 * Why the record written on a line of `bytes` bytes, in a transcript of `fileSize` bytes, is not shown here (with the
 * NODE_OPTIONS that would let it be, before `again`, the command that was run), or null when it is shown: its view, at
 * RECORD_VIEW_PER_BYTE times its size, must fit beside the transcript's parse, at PARSE_PER_BYTE times the file's size,
 * in nine tenths of the heap limit (R.F1: a record a transcript's size allowed ran Node's heap out, and the abort left
 * the terminal raw); and so must the JSON the view writes of it, `built` bytes (view.mjs recordViewBytes), and
 * BUILT_MARGIN (N3: a record nested deep, its line small, wrote JSON hundreds of times its size, and ran the heap out).
 */
export function recordTooLarge(bytes, fileSize, heapLimit = memoryLimit(), again = 'npx ltms-reader', built = 0) {
  const room = 0.9 * heapLimit - PARSE_PER_BYTE * fileSize;
  const limit = Math.max(0, Math.floor(room / RECORD_VIEW_PER_BYTE));
  const size = (n, round) => (n < MB ? `${round(n / 1024).toLocaleString('en-US')} KB` : `${round(n / MB).toLocaleString('en-US')} MB`);
  // the setting at which both fit: its old space alone (Node's limit is that and more), and a tenth of it for the transcript
  const need = (view) => Math.ceil(Math.max(10 * fileSize, (PARSE_PER_BYTE * fileSize + view) / 0.9) / MB / 256) * 256;
  const view = Math.max(RECORD_VIEW_PER_BYTE * bytes, built > 0 ? built + BUILT_MARGIN : 0);
  if (bytes > limit) return `it is ${size(bytes, Math.ceil)}, and in a transcript of ${size(fileSize, Math.ceil)} this process shows a record of up to ${size(limit, Math.floor)} (its view takes up to ${RECORD_VIEW_PER_BYTE} times a record's size, the transcript's parse up to ${PARSE_PER_BYTE} times the file's, both within nine tenths of the memory limit). To show it, give Node more memory: NODE_OPTIONS=--max-old-space-size=${need(view)} ${again}`;
  if (built > 0 && built + BUILT_MARGIN > room) return `it is ${size(bytes, Math.ceil)}, and its view would write ${size(built, Math.ceil)} of JSON (indented, as JSON is, once more at each level a value is nested in), which with what the view needs beside it (${size(BUILT_MARGIN, Math.ceil)}) does not fit beside the transcript's parse in nine tenths of the memory limit. To show it, give Node more memory: NODE_OPTIONS=--max-old-space-size=${need(view)} ${again}`;
  return null;
}

/**
 * Read and parse one transcript; `abs` is its full path (already checked by the caller to be a regular file reached
 * through no symbolic link). Returns { abs, name, prefix, size, t, view }: `view` is the session view, uncapped (a
 * terminal draws only the rows on screen), whose turns, calls and compactions are those `ltms skeleton` prints.
 * heapLimit: the limit the size rule reads by (the runtime's when not given); again: the command a refusal names.
 */
export function readTranscript(abs, { heapLimit, again } = {}) {
  let fd;
  try { fd = openSync(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); }
  catch (e) {
    if (e.code === 'ELOOP' || e.code === 'EMLINK') throw new Refusal('not-file', `${abs} is a symbolic link; a transcript is read only as a regular file`);
    if (e.code === 'ENOENT') throw new Refusal('missing', `no file at ${abs}: it may have been moved, or removed by Claude Code's cleanup`);
    throw new Refusal('unreadable', `${abs} could not be opened (${e.code ?? 'unreadable'})`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Refusal('not-file', `${abs} is not a regular file`);
    const why = tooLarge(st.size, heapLimit, again);
    if (why) throw new Refusal('too-large', `${abs} is not read: ${why}`);
    const t = parseTranscript(readFileSync(fd, 'utf8'));
    const name = path.basename(abs);
    return { abs, name, prefix: prefixOf(name), size: st.size, mtimeMs: st.mtimeMs, t, view: sessionView(t, { name, caps: false }) };
  } finally { closeSync(fd); }
}
