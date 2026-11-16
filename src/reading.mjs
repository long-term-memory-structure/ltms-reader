// src/reading.mjs — one transcript read in the reader's own process, with ltms's parser, and the session view of it
// (src/view.mjs). A terminal app has no editor to protect, so it needs no separate reading process (DESIGN.md, "One view
// layer, two faces").
//
// The file is opened without following a symbolic link at its last step (O_NOFOLLOW), and without blocking on a FIFO put
// at its name (O_NONBLOCK); it must be a regular file, and it is read from the descriptor checked. A transcript too
// large to parse in this process's memory is refused before it is read, with its size and the NODE_OPTIONS that would
// let it be read: the rule is ltms's own (a file over a tenth of the runtime's memory limit is skipped, so the reader
// and ltms's lists agree on which files can be read; parsing takes 5 to 8 times a file's size), and a file over 480 MB
// cannot be read at all, by JavaScript's limit on a string's length.
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { parseTranscript } from '#ltms';
import { prefixOf, sessionView } from './view.mjs';

export const MB = 1024 * 1024;
/** No memory setting reads a file over this: its text would pass JavaScript's limit on a string's length. */
export const STRING_MAX = 480 * MB;

export class Refusal extends Error { constructor(kind, message) { super(message); this.kind = kind; } }

/** The largest transcript this process reads, by ltms's rule, for a heap limit of `heapLimit` bytes. */
export const sizeLimit = (heapLimit) => Math.min(STRING_MAX, Math.floor(heapLimit / 10));

/** Why a file of `size` bytes is not read here (with the NODE_OPTIONS that would let it be, before `again`, the command
 *  that was run: src/start.mjs's againOf), or null when it is read. */
export function tooLarge(size, heapLimit = getHeapStatistics().heap_size_limit, again = 'npx ltms-reader') {
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
 *  reads, is the old space and 96 MB more on Node 26, 48 on Node 20. At the heap where each failed, on both, the rule
 *  refuses it. */
export const BUILT_MARGIN = 96 * MB;

/**
 * Why the record written on a line of `bytes` bytes, in a transcript of `fileSize` bytes, is not shown here (with the
 * NODE_OPTIONS that would let it be, before `again`, the command that was run), or null when it is shown: its view, at
 * RECORD_VIEW_PER_BYTE times its size, must fit beside the transcript's parse, at PARSE_PER_BYTE times the file's size,
 * in nine tenths of the heap limit (R.F1: a record a transcript's size allowed ran Node's heap out, and the abort left
 * the terminal raw); and so must the JSON the view writes of it, `built` bytes (view.mjs recordViewBytes), and
 * BUILT_MARGIN (N3: a record nested deep, its line small, wrote JSON hundreds of times its size, and ran the heap out).
 */
export function recordTooLarge(bytes, fileSize, heapLimit = getHeapStatistics().heap_size_limit, again = 'npx ltms-reader', built = 0) {
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
