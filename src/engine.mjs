// src/engine.mjs — everything the extension knows how to read, with no editor in it (so it is tested as it is):
// the projects under the root, a project's sessions (`ltms index`), a session's turns and any record in it (the helper,
// on ltms's library), and search (`ltms search`). `index` and `search` run ltms's own CLI (#ltms/cli, which the host
// package maps: ltms-reader to its dependency's, the extension to its vendored copy's), so the lines the page draws are
// the lines an agent reads from the same command.
//
// Names come from the page; paths never do. A project is a directory name the root lists; a transcript is its path in
// that project ('/'-separated), any regular .jsonl at any depth that ltms's own walk would read (src/layout.mjs). Every
// one is checked here against the disk, without following a symbolic link (ltms follows none under a directory either).
//
// Copies: a project can hold one session in several files (a mirror of pinned sessions kept inside it lists each pinned
// session again). Files with the same name and the same bytes (sha256, computed in the reading process and kept by
// device, inode, size and time) are one transcript: one row, one target for an address, its hits shown once, and the
// others named as its copies. Same name, other bytes: other versions, each kept, each naming the others.
import { spawn } from 'node:child_process';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onLines } from './lines.mjs';
import { prefixOf } from './view.mjs';
import { agentsOf, byPlace, classify, identifies, parentOf, transcriptAt, walk } from './layout.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** ltms's CLI, resolved from the package this file sits in (its package.json "imports" maps #ltms/cli). */
export const CLI = createRequire(import.meta.url).resolve('#ltms/cli');
export const HELPER = path.join(HERE, 'helper.mjs');

/** The environment a child gets: what a Node program needs to find home, temp, locale and Claude Code's configuration,
 *  nothing else of the editor's, and the switch that makes the editor's binary run as Node. */
const PASS = ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'windir', 'TEMP', 'TMP', 'TMPDIR', 'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'CLAUDE_CONFIG_DIR'];
export function childEnv(from = process.env, extra = {}) {
  const env = {};
  for (const k of PASS) if (typeof from[k] === 'string') env[k] = from[k];
  return { ...env, ...extra, ELECTRON_RUN_AS_NODE: '1' };
}

export class Refusal extends Error { constructor(kind, message) { super(message); this.kind = kind; } }

/** A list read in less than this is read again when anything under its folder changed; a slower one is kept, and the
 *  page is told what changed (ms). */
export const AUTO_MS = 3000;
/** How long one walk of a project serves the requests of one action (ms). */
export const WALK_MS = 3000;

/** What changed between two snapshots (path → size:time): null when nothing did; else the counts and the first paths. */
export function changes(before, now) {
  const changed = [], added = [], removed = [];
  for (const [rel, sig] of now) { const b = before.get(rel); if (b === undefined) added.push(rel); else if (b !== sig) changed.push(rel); }
  for (const rel of before.keys()) if (!now.has(rel)) removed.push(rel);
  const count = changed.length + added.length + removed.length;
  return count ? { count, changed: changed.slice(0, 20), added: added.slice(0, 20), removed: removed.slice(0, 20), counts: { changed: changed.length, added: added.length, removed: removed.length } } : null;
}

const PLAIN = /^[^/\\\0]+$/;
const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const isName = (s) => typeof s === 'string' && s !== '.' && s !== '..' && PLAIN.test(s) && s.length <= 255;
const kindOf = (p) => { try { const s = lstatSync(p); return s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other'; } catch { return 'none'; } };

/** Run ltms's CLI and collect its JSON lines. Never through a shell: the query is one argument. */
export function runLtms(args, { runtime = process.execPath, env = childEnv(), signal, maxStdout = 256 * 1024 * 1024, maxStderr = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(runtime, [CLI, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const lines = [];
    let size = 0, stderr = '', bad = 0, over = false;
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, { once: true });
    onLines(child.stdout, (l) => {
      size += l.length + 1;
      if (size > maxStdout) { if (!over) { over = true; child.kill(); } return; }
      if (l === '') return;
      try { lines.push(JSON.parse(l)); } catch { bad++; }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { if (stderr.length < maxStderr) stderr += d.slice(0, maxStderr - stderr.length); });
    child.on('error', (e) => { signal?.removeEventListener('abort', onAbort); reject(new Refusal('no-runtime', `could not start ltms with ${runtime} (${e.code ?? e.message})`)); });
    child.on('close', (code, sig) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Refusal('cancelled', 'cancelled'));
      if (over) return reject(new Refusal('too-large', `ltms printed more than ${Math.round(maxStdout / 1048576)} MB; ask for fewer at a time`));
      if (bad) return reject(new Refusal('bad-output', `ltms printed ${bad} line(s) that are not JSON`));
      resolve({ code, signal: sig, lines, stderr, ms: Date.now() - t0 });
    });
  });
}

/** One long-lived helper process (src/helper.mjs), started on the first request and again after it exits. */
export class HelperClient {
  constructor({ runtime = process.execPath, env = childEnv(), idleMs = 600_000, timeoutMs = 300_000, log = () => {} } = {}) {
    Object.assign(this, { runtime, env: { ...env, LTMS_GUI_IDLE_MS: String(idleMs) }, timeoutMs, log });
    this.child = null; this.next = 1; this.pending = new Map();
  }
  start() {
    const child = spawn(this.runtime, [HELPER], { env: this.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    onLines(child.stdout, (l) => {
      let m; try { m = JSON.parse(l); } catch { this.log(`helper: a line that is not JSON (${l.length} characters)`); return; }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(new Refusal(m.error?.kind ?? 'internal', m.error?.message ?? 'the helper refused'));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => this.log(`helper stderr: ${String(d).slice(0, 2000).trimEnd()}`));
    const gone = (why) => {
      if (this.child === child) this.child = null;
      for (const [, p] of this.pending) p.reject(new Refusal('helper-exit', `the reading process ended (${why}) before it answered`));
      this.pending.clear();
    };
    child.on('error', (e) => gone(`could not start: ${e.code ?? e.message}`));
    child.on('exit', (code, sig) => gone(sig ? `signal ${sig}` : `exit ${code}`));
    child.stdin.on('error', () => {});
  }
  request(op, args) {
    if (!this.child) this.start();
    const id = this.next++;
    return new Promise((resolve, reject) => {
      // a request with no answer in time ends with a refusal that names the file, and the reading process is started again
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Refusal('timeout', `the reading process gave no answer in ${Math.round(this.timeoutMs / 1000)} s${args?.name ? ` for ${args.name}` : ''}; it was restarted, so asking again starts afresh`));
        this.dispose();
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.child.stdin.write(`${JSON.stringify({ id, op, ...args })}\n`);
    });
  }
  dispose() { const c = this.child; this.child = null; c?.kill(); }
}

export class Engine {
  /** root: the folder holding the projects (Claude Code's <config>/projects). */
  constructor({ root, runtime = process.execPath, env = childEnv(), idleMs = 600_000, timeoutMs = 300_000, log = () => {} }) {
    Object.assign(this, { given: path.resolve(root), runtime, env, log });
    this.root = this.given;
    this.rootState();   // resolved now, so a session asked for before the projects is checked against the real folder
    this.helper = new HelperClient({ runtime, env, idleMs, timeoutMs, log });
    this.indexCache = new Map();
    this.digests = new Map();
    this.walks = new Map();
    this.indexRun = null;
    this.search = null;
  }

  /** The root itself may be a symbolic link (a projects folder moved to another disk): it is the user's own setting or
   *  Claude Code's configuration, so it is resolved, once it exists. Nothing below it is followed. */
  rootState() {
    if (this.root === this.given) try { const real = realpathSync(this.given); if (kindOf(real) === 'dir') this.root = real; } catch {}
    return kindOf(this.root);
  }

  /** The root as the page shows it: the home folder written as ~, so a picture of the page does not show the user's
   *  name in a path. */
  rootShown() { const h = homedir(), g = this.given; return h && (g === h || g.startsWith(`${h}${path.sep}`)) ? `~${g.slice(h.length)}` : g; }

  /** The project folders under the root, newest file first: each with its count of transcript (.jsonl) files at its top
   *  (ltms index says which of them are sessions). A folder that cannot be listed is kept, marked, and the rest go on;
   *  symbolic links are counted, not entered. */
  projects() {
    const state = this.rootState();
    if (state !== 'dir') return { root: this.root, rootShown: this.rootShown(), state, projects: [], links: 0 };
    const projects = [];
    let links = 0;
    for (const e of readdirSync(this.root, { withFileTypes: true })) {
      if (e.isSymbolicLink()) { links++; continue; }
      if (!e.isDirectory() || !isName(e.name)) continue;
      let files = 0, newest = 0, newestFile = null;
      try {
        for (const f of readdirSync(path.join(this.root, e.name), { withFileTypes: true })) {
          if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
          files++;
          try { const m = lstatSync(path.join(this.root, e.name, f.name)).mtimeMs; if (m > newest) { newest = m; newestFile = f.name; } } catch {}
        }
      } catch (err) { projects.push({ name: e.name, files: null, newest: null, unreadable: err?.code ?? 'unreadable' }); continue; }
      projects.push({ name: e.name, files, newest: newest || null, newestFile });
    }
    projects.sort((a, b) => (b.newest ?? 0) - (a.newest ?? 0) || a.name.localeCompare(b.name));
    return { root: this.root, rootShown: this.rootShown(), state, projects, links };
  }

  /** A path as the page shows it: the home folder written as ~. */
  shown(p) { const h = homedir(); return h && (p === h || p.startsWith(`${h}${path.sep}`)) ? `~${p.slice(h.length)}` : p; }

  /**
   * Each project's working directory (A.F16: the folder's name is the path with every other character written as -,
   * which cannot be read back): the cwd its newest transcript's first records hold, read from that file's first 64 KB
   * only, without blocking the editor's process; with ~ for home; null when no complete line there says it. The projects
   * as projects() listed them (names, newest files).
   */
  async projectPaths(list) {
    const out = {};
    for (const p of list) {
      out[p.name] = null;
      if (!p.newestFile) continue;
      let fh;
      try {
        const file = this.sessionFile(p.name, p.newestFile).abs;
        fh = await openFile(file, 'r');
        const buf = Buffer.alloc(64 * 1024), { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        const text = buf.subarray(0, bytesRead).toString('utf8'), lines = text.split('\n');
        if (bytesRead === buf.length) lines.pop();   // the last line may be cut: only whole lines are read
        for (const l of lines) {
          let r; try { r = JSON.parse(l); } catch { continue; }
          if (typeof r?.cwd === 'string' && r.cwd.length > 0 && r.cwd.length <= 4096) { out[p.name] = this.shown(r.cwd); break; }
        }
      } catch {} finally { await fh?.close().catch(() => {}); }
    }
    return out;
  }

  projectDir(project) {
    if (!isName(project)) throw new Refusal('bad-name', `${JSON.stringify(project)} is not a project folder's name`);
    const dir = path.join(this.root, project), k = kindOf(dir);
    if (k !== 'dir') throw new Refusal('no-project', k === 'link' ? `${project} is a symbolic link under ${this.root}; it is not entered` : `no project folder ${project} under ${this.root}`);
    return dir;
  }

  /** A transcript of the project, by its path in it: any regular .jsonl at any depth that ltms's walk reads, every
   *  folder on the way a real one (src/layout.mjs). */
  sessionFile(project, file) {
    const dir = this.projectDir(project);
    const r = transcriptAt(dir, file);
    if (r.refused) throw new Refusal(r.refused, r.refused === 'bad-name' ? r.why : `${project}: ${r.why}`);
    return r;
  }

  /** The sha256 of a transcript (the reading process computes it), kept by device, inode, size and time. */
  async digestOf(project, file) {
    const { abs } = this.sessionFile(project, file);
    let st; try { st = lstatSync(abs); } catch { throw new Refusal('no-session', `${project}: no file ${file}`); }
    const key = `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`;
    const hit = this.digests.get(key);
    if (hit) return hit;
    const d = await this.helper.request('digest', { file: abs, dir: path.dirname(abs), name: path.basename(abs) });
    // kept only if the file did not change while it was read
    if (d.size === st.size && d.mtimeMs === st.mtimeMs) this.digests.set(key, d.sha256);
    return d.sha256;
  }

  /**
   * The transcripts among `files` (paths in one project) that are one transcript: same name and same bytes. Returns a Map
   * from each file with a same-named sibling among `files` to { rep, copies, others }: rep is the copy shown (the fewest
   * folders, then by path: Claude Code's own place first), copies the identical ones besides it, others the files of the
   * same name whose bytes differ (each its own row, naming the rest). A file whose name no other shares is not in the Map,
   * nor one whose name does not stand for one transcript (layout.mjs identifies: a workflow's journal.jsonl is in every run).
   */
  async groupsOf(project, files) {
    const byName = new Map();
    for (const f of files) { const n = f.slice(f.lastIndexOf('/') + 1); if (!identifies(n)) continue; if (!byName.has(n)) byName.set(n, []); byName.get(n).push(f); }
    const out = new Map();
    for (const same of byName.values()) {
      if (same.length < 2) continue;
      const contents = new Map();   // size, then sha256 when two share a size → files
      const bySize = new Map();
      for (const f of same) {
        let size = null;
        try { size = lstatSync(this.sessionFile(project, f).abs).size; } catch {}
        const k = String(size);
        if (!bySize.has(k)) bySize.set(k, []);
        bySize.get(k).push(f);
      }
      for (const [size, fs] of bySize) {
        if (fs.length === 1 || size === 'null') { for (const f of fs) contents.set(`${size}:${f}`, [f]); continue; }
        for (const f of fs) {
          let sha; try { sha = await this.digestOf(project, f); } catch { sha = `unreadable:${f}`; }
          const k = `${size}:${sha}`;
          if (!contents.has(k)) contents.set(k, []);
          contents.get(k).push(f);
        }
      }
      const groups = [...contents.values()].map((g) => g.sort(byPlace));
      const reps = groups.map((g) => g[0]);
      for (const g of groups) {
        const entry = { rep: g[0], copies: g.slice(1), others: reps.filter((r) => r !== g[0]).sort(byPlace) };
        for (const f of g) out.set(f, entry);
      }
    }
    return out;
  }

  /** What is there now under a project's folder, as far as it can change what `ltms index` prints (a list read before is
   *  compared with it): a file it reads by its size and time; a file it counts and does not read (in a session's own
   *  folder, a set-aside copy) by its presence; a symbolic link, a file whose name is not UTF-8, a folder holding PINS.log
   *  by their presence; nothing under such a folder (it is not entered). */
  snapshot(dir) {
    const w = walk(dir), cls = classify(w), sig = new Map();
    for (const f of w.files) { const c = cls.get(f.rel); if (c === 'read') sig.set(f.rel, `${f.size}:${f.mtimeMs}`); else if (c !== 'pinned') sig.set(f.rel, c); }
    for (const r of w.linkRels) sig.set(r, 'link');
    for (const r of w.lossy) sig.set(r, 'lossy');
    for (const r of w.pinStores) sig.set(`${r}/PINS.log`, 'pins');
    return { w, sig, byRel: new Map(w.files.map((f) => [f.rel, f])) };
  }

  /** A walk of a project, kept for WALK_MS: the several walks one action needs (its copies, an address, a search's
   *  folding) share one, in the editor's own process. The list's change test never uses it. */
  walkOf(dir) {
    const hit = this.walks.get(dir);
    if (hit && Date.now() - hit.at < WALK_MS) return hit.w;
    const w = walk(dir);
    this.walks.set(dir, { at: Date.now(), w });
    return w;
  }

  /**
   * A project's sessions, as `ltms index` lists them, newest first; each line gains `file`, its path in the project, and
   * the lines of identical copies are folded into the one shown (copies, others: groupsOf). The list read last is kept:
   * asked again, it is answered at once when nothing under the folder changed; when something did, it is read again if
   * that run took less than AUTO_MS, else answered at once with what changed (`changed`), for the page to offer a new
   * reading (our own project: 34 s a run, and the session being written changes it every few seconds). fresh: read again.
   */
  async index(project, { fresh = false } = {}) {
    const dir = this.projectDir(project);
    const now = this.snapshot(dir);
    const kept = this.indexCache.get(dir);
    if (kept && !fresh) {
      const changed = changes(kept.sig, now.sig);
      if (!changed) return kept.value;
      if (kept.value.ms + kept.value.copiesMs >= AUTO_MS) return { ...kept.value, changed: { ...changed, since: kept.value.at } };
    }
    // one run per folder at a time; a run for another folder is stopped (the page shows one project). A run reading this
    // folder already is joined; what changed since it started is said with its list; asked to read again (fresh) after a
    // change it has not seen, a new run replaces it
    const going = this.indexRun?.dir === dir ? this.indexRun : null;
    if (going) {
      const since = changes(going.sig, now.sig);
      if (!since) return going.promise;
      if (!fresh) return going.promise.then((v) => ({ ...v, changed: { ...since, since: v.at } }));
    }
    this.indexRun?.ac.abort();
    const ac = new AbortController(), run = { dir, ac, sig: now.sig, promise: null };
    run.promise = this.indexOnce(project, dir, now, ac.signal).finally(() => { if (this.indexRun === run) this.indexRun = null; });
    this.indexRun = run;
    return run.promise;
  }

  async indexOnce(project, dir, now, signal) {
    const at = Date.now();
    const r = await runLtms(['index', '--max', '0', '--', dir], { runtime: this.runtime, env: this.env, signal });
    const coverage = r.lines.find((l) => l.k === 'coverage') ?? null;
    // a run that ended without its coverage line (killed, out of memory) is a failure, said, and never kept
    if (!coverage || r.signal) throw new Refusal('index-failed', `ltms index ended ${r.signal ? `by signal ${r.signal}` : `with exit ${r.code}`} before its coverage line${r.stderr.trim() ? `: ${this.tidy(r.stderr.trim().split('\n').pop().slice(0, 300))}` : ''}`);
    const lines = [];
    for (const l of r.lines) {
      if (l.k !== 'session') continue;
      const rel = path.relative(dir, String(l.path));
      if (rel.startsWith('..') || path.isAbsolute(rel)) { this.log(`index: a session outside ${dir} was left out`); continue; }
      lines.push({ ...l, file: rel.split(path.sep).join('/') });
    }
    const t0 = Date.now();
    // the groups take in the files of the same names that ltms does not list (in a session's own folder, with no turn):
    // a row names every copy the session view names (B15)
    const listed = new Set(lines.map((l) => l.file)), named = new Set(lines.map((l) => l.file.slice(l.file.lastIndexOf('/') + 1)));
    const extra = now.w.files.map((f) => f.rel).filter((r) => !listed.has(r) && named.has(r.slice(r.lastIndexOf('/') + 1)));
    const groups = await this.groupsOf(project, [...listed, ...extra]);
    const lineOf = new Map(lines.map((l) => [l.file, l]));
    // A1: the bytes are compared after ltms read the files, and a file can change during a run: a copy's line is folded
    // only when ltms printed the same as for the copy shown in every field read from the transcript's bytes (not its
    // path, nor its agents, which ltms counts in each copy's own folder: the session's head links every copy); else it
    // stays, marked
    const sameAs = (a, b) => { const k = ({ path: _p, file: _f, agents: _a, ...rest }) => JSON.stringify(rest); return !!a && !!b && k(a) === k(b); };
    const sessions = [];
    let copies = 0, copyBytes = 0;
    for (const l of lines) {
      const g = groups.get(l.file);
      if (g && g.rep !== l.file && g.copies.includes(l.file)) {
        if (sameAs(lineOf.get(g.rep), l)) { copies++; copyBytes += now.byRel.get(l.file)?.size ?? 0; continue; }
        sessions.push({ ...l, copies: [g.rep, ...g.copies].filter((f) => f !== l.file), others: g.others, copyOf: g.rep, readDiffers: lineOf.has(g.rep) });
        continue;
      }
      sessions.push({ ...l, copies: g?.copies ?? [], others: g?.others ?? [] });
    }
    const value = { project, coverage, sessions, copies: { files: copies, bytes: copyBytes }, stderr: this.tidy(r.stderr.trim()), code: r.code, ms: r.ms, copiesMs: Date.now() - t0, at, changed: null };
    this.indexCache.set(dir, { sig: now.sig, value, lines: lineOf });
    return value;
  }

  /** B3: what ltms index printed for this file in the list read last, if it printed a line for it; else undefined. */
  ltmsLine(project, file) { try { return this.indexCache.get(this.projectDir(project))?.lines?.get(file); } catch { return undefined; } }

  /** The agent transcripts of a session: every agent-*.jsonl at any depth of its own folder, as ltms index counts them
   *  ({ agents: [{ file, name, group, bytes, mtime }], known }). */
  agents(project, file) { this.sessionFile(project, file); return agentsOf(this.projectDir(project), file); }

  /** For an agent's transcript, the session whose own folder holds it (its path), or null. */
  parent(project, file) { this.sessionFile(project, file); return parentOf(this.projectDir(project), file); }

  /** The other files of the project with this transcript's name: { copies (identical), others (other bytes) }. */
  async copiesOf(project, file) {
    this.sessionFile(project, file);
    const name = file.slice(file.lastIndexOf('/') + 1);
    const same = this.walkOf(this.projectDir(project)).files.map((f) => f.rel).filter((r) => r.slice(r.lastIndexOf('/') + 1) === name);
    if (!same.includes(file)) same.push(file);
    const g = (await this.groupsOf(project, same)).get(file);
    return g ? { shown: g.rep, copies: [g.rep, ...g.copies].filter((f) => f !== file), others: g.others } : { shown: file, copies: [], others: [] };
  }

  /** The transcripts whose address prefix is `prefix` (ltms's prefixOf of the file's name), in one project or in every
   *  project (null), at any depth; identical copies come back once (the copy Claude Code keeps first), naming the rest. */
  async resolve(project, prefix, { prefer = null } = {}) {
    if (typeof prefix !== 'string' || !/^(?:agent-[0-9A-Za-z._-]{1,8}|[0-9A-Za-z._-]{1,8})$/.test(prefix)) throw new Refusal('bad-name', `${JSON.stringify(prefix)} is not an address prefix (the first 8 characters of a session's file name, or agent- and the first 8 of an agent's id)`);
    // over every project, the one the page shows is looked in first, and alone when it holds the prefix (A7)
    if (project === null && typeof prefer === 'string') { let here = []; try { here = await this.resolve(prefer, prefix); } catch {} if (here.length) return here; }
    const names = project === null ? this.projects().projects.filter((p) => !p.unreadable).map((p) => p.name) : [project];
    const found = [];
    for (const name of names) {
      let dir; try { dir = this.projectDir(name); } catch { continue; }
      const hits = this.walkOf(dir).files.map((f) => f.rel).filter((r) => prefixOf(r.slice(r.lastIndexOf('/') + 1)) === prefix);
      if (!hits.length) continue;
      const groups = await this.groupsOf(name, hits);
      for (const f of hits.filter((h) => !groups.has(h) || groups.get(h).rep === h).sort(byPlace)) {
        const g = groups.get(f);
        found.push({ project: name, file: f, copies: g?.copies ?? [], others: g?.others ?? [] });
      }
    }
    return found;
  }

  /** What a search over one project (or every project, null: the whole folder, as ltms walks it) would read: its
   *  transcripts' count and bytes. */
  scope(project) {
    const dir = project === null ? (this.rootState() === 'dir' ? this.root : null) : this.projectDir(project);
    let files = 0, bytes = 0;
    let cut = false;
    if (dir) { const w = this.walkOf(dir); cut = w.cut; for (const f of w.files) { files++; bytes += f.size; } }
    return { files, bytes, cut };
  }

  // the reading process gets the folder the file must be in, and opens the file without following a link
  session(project, file) { const { abs, name } = this.sessionFile(project, file); return this.helper.request('session', { file: abs, dir: path.dirname(abs), name }); }
  turn(project, file, ta) { const { abs, name } = this.sessionFile(project, file); return this.helper.request('turn', { file: abs, dir: path.dirname(abs), name, ta }); }
  record(project, file, line, whole = false) { const { abs, name } = this.sessionFile(project, file); return this.helper.request('record', { file: abs, dir: path.dirname(abs), name, line, whole }); }
  window(project, file, line, field, at) { const { abs, name } = this.sessionFile(project, file); return this.helper.request('window', { file: abs, dir: path.dirname(abs), name, line, field, at }); }

  /** `ltms search` over one project, or over every project (project null). A new search cancels the one running. */
  async searchFor({ project = null, q, skip = 0, max = 50, substring = false, kinds = null }) {
    if (typeof q !== 'string' || q.trim() === '' || q.length > 2000 || q.includes('\0')) throw new Refusal('bad-query', 'a query is one to 2,000 characters of text');
    if (!Number.isSafeInteger(skip) || skip < 0 || !Number.isSafeInteger(max) || max < 1 || max > 500) throw new Refusal('bad-query', 'skip is 0 or more, and max 1 to 500');
    if (kinds !== null && !(Array.isArray(kinds) && kinds.length && kinds.every((k) => typeof k === 'string' && /^[a-z]+$/.test(k)))) throw new Refusal('bad-query', 'kinds are names of the kinds of text');
    const dir = project === null ? this.root : this.projectDir(project);
    if (project === null && this.rootState() !== 'dir') throw new Refusal('no-root', `no folder at ${this.root}`);
    this.search?.abort();
    const ac = new AbortController();
    this.search = ac;
    const args = ['search', '--max', String(max), '--skip', String(skip), ...(substring ? ['--substring'] : []), ...(kinds ? ['--kind', kinds.join(',')] : []), '--', q, dir];
    const r = await runLtms(args, { runtime: this.runtime, env: this.env, signal: ac.signal });
    if (this.search === ac) this.search = null;
    const files = new Map();
    for (const l of r.lines) {
      if (l.k !== 'file') continue;
      const rel = path.relative(this.root, String(l.path)).split(path.sep);
      if (rel[0] === '..' || path.isAbsolute(rel.join('/')) || rel.length < 2) { this.log(`search: a file outside the root was left out (${l.path})`); continue; }
      files.set(l.f, { f: l.f, p: l.p, last: l.last ?? null, project: rel[0], file: rel.slice(1).join('/'), copies: [], others: [], copyOf: null });
    }
    // identical copies (one name, the same bytes, in one project) hold the same hits. On this page, each group's copies
    // are folded under the first of them present (by place); that one is marked as a copy when the copy shown first is not
    // on this page. A1: a copy is folded only when each of its hits on this page is one the kept copy has here too (the
    // bytes are compared after ltms read them, and a file can change during a run); else it stays, marked.
    const folded = new Set();
    const hitsOf = new Map();
    for (const l of r.lines) if (l.k === 'hit') { if (!hitsOf.has(l.f)) hitsOf.set(l.f, []); hitsOf.get(l.f).push(JSON.stringify({ ta: l.ta, ch: l.ch, at: l.at })); }
    const byProject = new Map();
    for (const f of files.values()) { if (!byProject.has(f.project)) byProject.set(f.project, []); byProject.get(f.project).push(f); }
    for (const [proj, fs] of byProject) {
      let dir; try { dir = this.projectDir(proj); } catch { continue; }
      const want = new Set(fs.map((f) => baseName(f.file))), names = new Map();
      for (const w of this.walkOf(dir).files) { const n = baseName(w.rel); if (want.has(n)) { if (!names.has(n)) names.set(n, []); names.get(n).push(w.rel); } }
      const shared = [...names.values()].filter((v) => v.length > 1).flat();
      if (!shared.length) continue;
      const groups = await this.groupsOf(proj, shared);
      const present = new Map();   // a group's rep → its files on this page, by place
      for (const f of fs) { const g = groups.get(f.file); if (!g) continue; f.others = g.others; if (!present.has(g.rep)) present.set(g.rep, []); present.get(g.rep).push(f); }
      for (const [repName, here] of present) {
        here.sort((a, b) => byPlace(a.file, b.file));
        const keep = here[0], kept = new Set(hitsOf.get(keep.f) ?? []);
        const g = groups.get(keep.file);
        keep.copies = [g.rep, ...g.copies].filter((x) => x !== keep.file);
        if (keep.file !== repName) keep.copyOf = repName;
        for (const f of here.slice(1)) {
          f.copies = [g.rep, ...g.copies].filter((x) => x !== f.file);
          if ((hitsOf.get(f.f) ?? []).every((h) => kept.has(h))) { files.delete(f.f); folded.add(f.f); }
          else { f.copyOf = repName; f.readDiffers = true; }
        }
      }
    }
    const hitLines = r.lines.filter((l) => l.k === 'hit');
    return {
      q, project, skip, max, substring, kinds,
      coverage: r.lines.find((l) => l.k === 'coverage') ?? null,
      files: [...files.values()],
      hits: hitLines.filter((l) => files.has(l.f)),
      folded: { files: folded.size, turns: hitLines.filter((l) => folded.has(l.f)).length },
      stderr: this.tidy(r.stderr.trim()), code: r.code, ms: r.ms,
    };
  }

  /** What ltms printed, with the projects folder written as the page shows it (~ for home). */
  tidy(text) { const shown = this.rootShown(); return [this.root, this.given].reduce((t, p) => (p && p !== shown ? t.split(p).join(shown) : t), text); }

  cancelSearch() { this.search?.abort(); this.search = null; }
  dispose() { this.cancelSearch(); this.indexRun?.ac.abort(); this.indexRun = null; this.helper.dispose(); }
}
