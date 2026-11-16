// src/helper.mjs — the extension's reading process. It reads one transcript at a time with ltms's parser and answers the
// extension over stdin and stdout: one JSON request per line in, one JSON reply per line out. The extension starts it with
// the editor's own binary as Node (ELECTRON_RUN_AS_NODE=1), so a large transcript is parsed outside the editor's process,
// and its memory is given back when this process exits: when stdin closes, or after LTMS_GUI_IDLE_MS without a request.
//
// The extension checks every path before it sends one; this process still reads only regular files (never through a
// symbolic link at the last step), and keeps the parses of the most recent files, up to LTMS_GUI_CACHE_BYTES of source.
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { parseTranscript } from '#ltms';
import { fieldWindow, recordIndexAt, recordView, sessionView, turnItems } from './view.mjs';
import { onLines } from './lines.mjs';

const IDLE_MS = Number(process.env.LTMS_GUI_IDLE_MS) > 0 ? Number(process.env.LTMS_GUI_IDLE_MS) : 600_000;
const CACHE_BYTES = Number(process.env.LTMS_GUI_CACHE_BYTES) > 0 ? Number(process.env.LTMS_GUI_CACHE_BYTES) : 128 * 1024 * 1024;
// ltms's own rule (its cli.js): a file over a tenth of the runtime's heap limit is skipped, so the session view and the
// lists ltms makes agree on which files can be read; and never past about 480 MB, under JavaScript's string limit.
const MAX_FILE = Math.min(480 * 1024 * 1024, Math.floor(getHeapStatistics().heap_size_limit / 10));

class Refusal extends Error { constructor(kind, message) { super(message); this.kind = kind; } }

const cache = new Map();   // key → { t, bytes }, the most recently used last
/** Open one transcript as load() does, and return its descriptor and its stat; the caller closes it. */
function openChecked(file, dir) {
  let fd;
  // the folder is checked before the open as well as after; O_NONBLOCK, so a FIFO put at the name cannot block the open
  if (typeof dir === 'string') { let real; try { real = realpathSync(dirname(file)); } catch { real = null; } if (real !== dir) throw new Refusal('not-file', `${file} is no longer in the folder that was checked (a folder on its path was replaced)`); }
  try { fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); }
  catch (e) {
    if (e.code === 'ELOOP' || e.code === 'EMLINK') throw new Refusal('not-file', `${file} is a symbolic link; transcripts are read only as regular files`);
    let st; try { st = lstatSync(file); } catch { throw new Refusal('missing', `no file at ${file} (${e.code ?? 'unreadable'}): it may have been moved, or removed by Claude Code's cleanup`); }
    if (st.isSymbolicLink()) throw new Refusal('not-file', `${file} is a symbolic link; transcripts are read only as regular files`);
    throw new Refusal('unreadable', `${file} could not be opened (${e.code ?? 'unreadable'})`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Refusal('not-file', `${file} is not a regular file`);
    if (typeof dir === 'string' && realpathSync(dirname(file)) !== dir) throw new Refusal('not-file', `${file} is no longer in the folder that was checked (a folder on its path was replaced)`);
    // A9: a folder on the path flipped to a link and back around the open would pass both checks above; the descriptor
    // must be the very file the name stands for now
    let now; try { now = lstatSync(file); } catch { now = null; }
    if (!now || now.dev !== st.dev || now.ino !== st.ino) throw new Refusal('not-file', `${file} is not the file that was opened (a folder on its path was replaced while it was opened)`);
    return { fd, st };
  } catch (e) { closeSync(fd); throw e; }
}

/** The sha256 of a transcript's bytes, read 1 MiB at a time from the descriptor checked (so two copies can be told
 *  identical without holding either whole). */
function digest(file, dir) {
  const { fd, st } = openChecked(file, dir);
  try {
    const h = createHash('sha256'), buf = Buffer.allocUnsafe(1 << 20);
    let size = 0;
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) { h.update(buf.subarray(0, n)); size += n; }
    return { sha256: h.digest('hex'), size, mtimeMs: st.mtimeMs, ino: String(st.ino), dev: String(st.dev) };
  } finally { closeSync(fd); }
}

/** Read one transcript: opened without following a link at the last step (O_NOFOLLOW), checked to be a regular file
 *  in the folder the extension checked (`dir`, so a folder swapped for a link since is refused), and read from the
 *  descriptor it checked. */
function load(file, dir) {
  const { fd, st } = openChecked(file, dir);
  try {
    if (st.size > MAX_FILE) throw new Refusal('too-large', `${file} is ${Math.round(st.size / 1048576)} MB; like ltms, the reader skips a transcript over a tenth of its memory limit (${Math.round(MAX_FILE / 1048576)} MB here)`);
    const key = `${file}\0${st.size}\0${st.mtimeMs}\0${st.ino}`;
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit.t; }
    for (const k of [...cache.keys()]) if (k.startsWith(`${file}\0`)) cache.delete(k);   // an older reading of the same file
    const t = parseTranscript(readFileSync(fd, 'utf8'));
    cache.set(key, { t, bytes: st.size });
    let total = 0;
    for (const v of cache.values()) total += v.bytes;
    for (const [k, v] of cache) { if (total <= CACHE_BYTES || cache.size <= 1) break; cache.delete(k); total -= v.bytes; }
    return t;
  } finally { closeSync(fd); }
}

const name = (q) => { if (typeof q.name !== 'string' || !/^[^/\\\0]+\.jsonl$/.test(q.name)) throw new Refusal('bad-request', 'a request names its file by its name, ending in .jsonl'); return q.name; };
const file = (q) => { if (typeof q.file !== 'string' || q.file === '' || q.file.includes('\0')) throw new Refusal('bad-request', 'a request names its file by its full path'); return q.file; };
const line = (q) => { if (!Number.isSafeInteger(q.line) || q.line < 1) throw new Refusal('bad-request', `a line is a whole number from 1; given ${JSON.stringify(q.line)}`); return q.line; };

const ops = {
  digest: (q) => digest(file(q), q.dir),
  hello: () => ({ pid: process.pid, node: process.versions.node, maxFile: MAX_FILE, ltms: JSON.parse(readFileSync(createRequire(import.meta.url).resolve('#ltms/package.json'), 'utf8')).version }),
  session: (q) => sessionView(load(file(q), q.dir), { name: name(q) }),
  turn: (q) => {
    if (typeof q.ta !== 'string' || q.ta.length > 40) throw new Refusal('bad-request', 'a turn is named by its id, as <prefix>:T<n>');
    const r = turnItems(load(file(q), q.dir), { name: name(q), ta: q.ta });
    if (!r) throw new Refusal('no-turn', `${q.ta} is not a turn of ${q.name}`);
    return { ta: q.ta, ...r };
  },
  record: (q) => {
    const v = recordView(load(file(q), q.dir), line(q), { name: name(q), whole: q.whole === true });
    if (!v) throw new Refusal('no-record', `no record was parsed on line ${q.line} of ${q.name}: the line is blank, not a JSON object, or past the end of the file`);
    return v;
  },
  window: (q) => {
    const t = load(file(q), q.dir), i = recordIndexAt(t, line(q));
    if (i === undefined) throw new Refusal('no-record', `no record was parsed on line ${q.line} of ${name(q)}`);
    if (!Number.isSafeInteger(q.at) || q.at < 0 || !Array.isArray(q.field) || q.field.length > 64 || !q.field.every((k) => typeof k === 'string' || Number.isSafeInteger(k))) throw new Refusal('bad-request', 'a match is named by its field (a key path) and its offset');
    return fieldWindow(t.records[i], q.field, q.at, 600);
  },
};

let idle;
const touch = () => { clearTimeout(idle); idle = setTimeout(() => process.exit(0), IDLE_MS); idle.unref?.(); };
const reply = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
touch();
onLines(process.stdin, (l) => {
  if (l === '') return;
  touch();
  let q;
  try { q = JSON.parse(l); } catch { reply({ id: null, ok: false, error: { kind: 'bad-request', message: 'a request is one JSON object on one line' } }); return; }
  const id = Number.isSafeInteger(q?.id) ? q.id : null;
  const op = Object.hasOwn(ops, q?.op) ? ops[q.op] : null;
  if (!op) { reply({ id, ok: false, error: { kind: 'bad-request', message: `no operation ${JSON.stringify(q?.op)}; known: ${Object.keys(ops).join(', ')}` } }); return; }
  try { reply({ id, ok: true, result: op(q) }); }
  catch (e) {
    // ltms's rule: an internal error is reported by its kind, never by its message, which could quote the transcript
    if (e instanceof Refusal) reply({ id, ok: false, error: { kind: e.kind, message: e.message } });
    else reply({ id, ok: false, error: { kind: 'internal', message: `${e?.name ?? 'Error'} while answering ${q.op}` } });
  }
}, () => process.exit(0));
