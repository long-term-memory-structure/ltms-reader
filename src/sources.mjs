// src/sources.mjs — where the reader's rows come from: a folder of project folders (the engine: the projects by ltms's
// walk, a project's sessions by `ltms index`, search by `ltms search`, an address's transcript by its prefix), or one
// transcript. Either way a session is read in this process (src/reading.mjs), and the error class of each failed call
// comes from `ltms skeleton`, so the lines the screen draws are the lines an agent reads from the same commands.
import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Engine, childEnv, runLtms } from './engine.mjs';
import { classify, walk } from './layout.mjs';
import { readTranscript } from './reading.mjs';
import { prefixOf } from './view.mjs';

/** The failed calls' error classes, as `ltms skeleton` prints them for the transcript at `abs`: a Map from each call of
 *  `view` (its item) to its `ek`. Calls are matched by turn, address, result's address, ok and result length (two calls
 *  of one record share an address), in the order both give them. */
export async function errorClasses(abs, view, run = runLtms) {
  const r = await run(['skeleton', '--', abs]);
  const lists = new Map();
  const key = (ta, a, rr, ok, n) => JSON.stringify([ta, a, rr, ok, n]);
  for (const l of r.lines) {
    if (l.k !== 'call') continue;
    const k = key(l.ta, l.a, l.r, l.ok, l.n);
    if (!lists.has(k)) lists.set(k, []);
    lists.get(k).push(l.ek ?? null);
  }
  const out = new Map();
  for (const t of view.turns) for (const x of t.items) {
    if (x.kind !== 'call') continue;
    const list = lists.get(key(t.ta, x.a, x.r, x.ok, x.n));
    if (list?.length) out.set(x, list.shift());
  }
  return out;
}

/** Whether the transcript read as `doc` is still the file at its path, unchanged (its size and time). */
export function unchanged(doc) {
  try { const st = lstatSync(doc.abs); return st.isFile() && st.size === doc.size && st.mtimeMs === doc.mtimeMs; } catch { return false; }
}

/** A path with the home folder written as ~. */
export function shownPath(p) { const h = homedir(); return h && (p === h || p.startsWith(`${h}${path.sep}`)) ? `~${p.slice(h.length)}` : p; }

/** The projects folder given (or Claude Code's), read through the engine. `only`: the one project shown, when the
 *  folder given was a project's own. `again`: the command that was run (src/start.mjs's againOf), which a refusal of a
 *  transcript too large names; `heapLimit`: the limit its size rule reads by (the runtime's when not given). */
export class RootSource {
  constructor({ root, only = null, env = childEnv(process.env), engine = null, again = undefined, heapLimit = undefined }) {
    this.kind = 'root';
    this.engine = engine ?? new Engine({ root, env });
    this.only = only;
    this.env = env;
    this.reading = { again, heapLimit };
  }

  get rootShown() { return this.engine.rootShown(); }

  /** The project folders, newest first, each with the count of the transcripts `ltms index` would read in it (ltms's
   *  walk: any depth, but a session's own folder, the set-aside copies and a pin store). */
  projects() {
    const p = this.engine.projects();
    const list = p.projects.filter((x) => this.only === null || x.name === this.only).map((x) => {
      if (x.unreadable) return { name: x.name, transcripts: null, newest: null, unreadable: x.unreadable };
      let transcripts = null, cut = false;
      try {
        const w = walk(path.join(p.root, x.name)), cls = classify(w);
        transcripts = [...cls.values()].filter((c) => c === 'read').length;
        cut = w.cut;
      } catch {}
      return { name: x.name, transcripts, cut, newest: x.newest };
    });
    return { rootShown: p.rootShown, state: p.state, projects: list, links: p.links };
  }

  /** A project's sessions, as `ltms index` lists them, newest first; `fresh`: read again, not answered from the list kept
   *  (r, Y2). */
  sessions(project, { fresh = false } = {}) { return this.engine.index(project, { fresh }); }

  /** One transcript of a project, read here. */
  open(project, file) { return { project, file, ...readTranscript(this.engine.sessionFile(project, file).abs, this.reading) }; }

  unchanged(doc) { return unchanged(doc); }

  errorClasses(doc) { return errorClasses(doc.abs, doc.view, (args) => runLtms(args, { env: this.env })); }

  /** `ltms search` over one project, or every project (null). */
  search({ project, q, skip = 0, max = 100 }) { return this.engine.searchFor({ project, q, skip, max }); }

  /** The transcripts whose address prefix is `prefix`, the project `prefer` first: [{ project, file }]. */
  resolve(prefix, { prefer = null } = {}) {
    return this.engine.resolve(null, prefix, { prefer }).then((found) => found.filter((f) => this.only === null || f.project === this.only));
  }

  /** A path as the screen shows it: the home folder as ~. */
  shown(p) { return this.engine.shown(p); }

  dispose() { this.engine.dispose(); }
}

/** One transcript, given by its path; `again` and `heapLimit` as RootSource's. */
export class FileSource {
  constructor({ file, env = childEnv(process.env), again = undefined, heapLimit = undefined }) {
    this.kind = 'file';
    this.file = file;
    this.name = path.basename(file);
    this.prefix = prefixOf(this.name);
    this.env = env;
    this.running = null;
    this.reading = { again, heapLimit };
  }

  open() { return { project: null, file: this.name, ...readTranscript(this.file, this.reading) }; }

  unchanged(doc) { return unchanged(doc); }

  errorClasses(doc) { return errorClasses(doc.abs, doc.view, (args) => runLtms(args, { env: this.env })); }

  /** `ltms search` over this one file, shaped as the engine shapes a search over a folder. */
  async search({ q, skip = 0, max = 100 }) {
    this.running?.abort();
    const ac = new AbortController();
    this.running = ac;
    const r = await runLtms(['search', '--no-cache', '--max', String(max), '--skip', String(skip), '--', q, this.file], { env: this.env, signal: ac.signal });
    if (this.running === ac) this.running = null;
    const files = r.lines.filter((l) => l.k === 'file').map((l) => ({ f: l.f, p: l.p, last: l.last ?? null, project: null, file: this.name, copies: [], others: [], copyOf: null }));
    return { q, project: null, skip, max, coverage: r.lines.find((l) => l.k === 'coverage') ?? null, files, hits: r.lines.filter((l) => l.k === 'hit'), folded: { files: 0, turns: 0 }, stderr: r.stderr.trim(), code: r.code, ms: r.ms };
  }

  /** This file, when `prefix` is its address prefix. */
  async resolve(prefix) { return prefix === this.prefix ? [{ project: null, file: this.name }] : []; }

  shown(p) { return shownPath(p); }

  dispose() { this.running?.abort(); }
}
