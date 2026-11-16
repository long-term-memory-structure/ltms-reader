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
