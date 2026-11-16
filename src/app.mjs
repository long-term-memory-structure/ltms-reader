// src/app.mjs — the reader's state, and what each key does to it. No terminal in it: the screen (src/screen.mjs) passes
// each key in and draws render(state); the tests drive it the same way.
//
// The state is a stack of views: the bottom one is Projects (a folder of projects) or the session (one transcript);
// Enter pushes the row's view, Esc pops it. A search or an address pushes what it opens on top of where it was, so Esc
// goes back there. Lists come from the source (src/sources.mjs): the projects at once, a project's sessions by ltms
// index and a search by ltms search, each while the screen says what is being read; a session is read in this process,
// after a frame that says which file is being read.
import { recordTooLarge } from './reading.mjs';
import { clusters } from './text.mjs';
import { recordIndexAt, recordView } from './view.mjs';
import { bodyHeight, coverageText, recordLines, render, top, topOf } from './views.mjs';

/** An address as ltms prints it: a prefix (8 characters of a session's file name, or agent- and 8 of an agent's id)
 *  and a line (L) or a turn (T). */
export const ADDRESS = /^(agent-[0-9A-Za-z._-]{1,8}|[0-9A-Za-z._-]{1,8}):([LT])(\d{1,9})$/;
const MAX_INPUT = 2000;
/** The turns a search shows at a time. */
export const SEARCH_MAX = 100;
/** What the screen says of an error: a refusal's own words (they name paths and sizes), a system error's code and path,
 *  else only its kind: its message could quote a transcript. */
const message = (e) => {
  if (e && typeof e.message === 'string' && e.kind) return e.message;
  if (typeof e?.code === 'string' && typeof e?.syscall === 'string') return `${typeof e.path === 'string' ? `${e.path}: ` : ''}${e.code} (${e.syscall})`;
  return `${e?.name ?? 'Error'} while reading (an internal error; its message is not shown, since it could quote a transcript)`;
};

/** The rows of a session view: each turn, and after it each compaction in it (with the summary that follows it); the
 *  compactions before the first prompt first. */
export function sessionRows(view) {
  const rows = [];
  const pairs = (items, lead) => {
    const out = [];
    items.forEach((x, i) => {
      if (x.kind === 'compaction') {
        const next = items.slice(i + 1).find((y) => y.kind === 'compaction' || y.kind === 'summary');
        const s = next?.kind === 'summary' ? next : null;
        out.push({ kind: 'compaction', a: x.a, line: x.line, summary: s?.a ?? null, sline: s?.line ?? null, trigger: x.trigger, pre: x.pre, post: x.post, time: x.time, by: x.by?.ta ?? null, lead });
      } else if (x.kind === 'summary' && !(items[i - 1]?.kind === 'compaction' || out.some((r) => r.summary === x.a))) {
        out.push({ kind: 'summary', a: x.a, line: x.line, text: x.text, more: x.more ?? 0, time: x.time, lead });
      }
    });
    return out;
  };
  rows.push(...pairs(view.lead, true));
  view.turns.forEach((t, i) => {
    rows.push({ kind: 'turn', index: i, ta: t.ta, a: t.a, line: t.line, ch: t.ch, calls: t.calls, failed: t.failed, prompt: t.prompt.text, promptMore: t.prompt.more, command: t.command, n: t.n, time: t.time, from: t.from, to: t.to, records: t.records });
    rows.push(...pairs(t.items, false));
  });
  return rows;
}

/** The rows of a turn view: its prompt, then its items in the order they were written; a call's result right after it. */
export function turnRows(t) {
  const rows = [{ kind: 'prompt', a: t.a, line: t.line, ch: t.ch, n: t.n, text: t.prompt.text, more: t.prompt.more, command: t.command, time: t.time }];
  t.items.forEach((x, i) => {
    if (x.kind === 'call') {
      rows.push({ kind: 'call', item: x, a: x.a, line: x.line, tool: x.tool, ok: x.ok, inputKey: x.input.key, inputText: x.input.text, inputMore: x.input.more, r: x.r, time: x.time });
      if (x.r) rows.push({ kind: 'result', call: x, a: x.r, line: x.rline, n: x.n, text: x.result?.text ?? '', more: x.result?.more ?? 0, of: x.a, ok: x.ok });
    } else if (x.kind === 'compaction') {
      const next = t.items.slice(i + 1).find((y) => y.kind === 'compaction' || y.kind === 'summary');
      rows.push({ kind: 'compaction', a: x.a, line: x.line, trigger: x.trigger, pre: x.pre, post: x.post, summary: next?.kind === 'summary' ? next.a : null, time: x.time, by: x.by?.ta ?? null });
    } else {
      rows.push({ kind: x.kind, a: x.a, line: x.line, text: x.text, more: x.more ?? 0, sub: x.sub, command: x.command ?? null, time: x.time });
    }
  });
  return rows;
}

/** The rows of a search's page: its coverage and notices, then each file with a hit and its matching turns. */
export function searchRows(result) {
  const rows = [{ kind: 'info', text: coverageText(result.coverage) }];
  const notices = String(result.stderr ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/^ltms search: \d+ matching turns? in /.test(l));
  for (const n of notices) rows.push({ kind: 'info', text: n });
  const byF = new Map(result.files.map((f) => [f.f, f]));
  let last = null;
  for (const h of result.hits) {
    const f = byF.get(h.f);
    if (!f) continue;
    if (f !== last) { rows.push({ kind: 'file', f: f.f, p: f.p, project: f.project, file: f.file, last: f.last, copies: f.copies?.length ?? 0 }); last = f; }
    rows.push({ kind: 'hit', ta: h.ta, ch: h.ch, at: Array.isArray(h.at) ? h.at : [], project: f.project, file: f.file });
  }
  const c = result.coverage, shown = c?.shown?.turns ?? result.hits.length, left = c?.left ?? 0;
  if (left > 0) rows.push({ kind: 'more', skip: result.skip + shown, next: Math.min(left, result.max), left });
  return rows;
}

export class App {
  /**
   * source: a RootSource or a FileSource. cols, rows: the screen's size. timeZone: for the times shown (this machine's
   * when undefined). onChange(): the state changed, draw it. onExit(code): a key or a command asked to quit.
   */
  constructor({ source, cols = 80, rows = 24, timeZone, now = Date.now, onChange = () => {}, onExit = () => {} }) {
    Object.assign(this, { source, now, onChange, onExit });
    this.state = { cols, rows, stack: [], input: null, help: false, note: null, timeZone, now: now() };
    this.pending = new Set();
    this.tick = null;
    this.doc = null;   // the transcript read last: { key, doc }
    this.quitting = null;
    this.pasting = false;   // between a paste's start and its end
  }

  /** The first views: Projects (and, when one project was given, its sessions), or the one transcript's session. */
  start({ project = null } = {}) {
    if (this.source.kind === 'file') this.openSession(null, this.source.name);
    else {
      this.pushProjects();
      if (project !== null) this.pushSessions(project);
    }
    this.changed();
  }

  lines() { return render(this.state, this.state.cols, this.state.rows); }
  resize(cols, rows) { this.state.cols = cols; this.state.rows = rows; this.changed(); }
  changed() { this.state.now = this.now(); this.onChange(); }

  /** Resolves when nothing is being read. */
  async idle() { while (this.pending.size) await Promise.allSettled([...this.pending]); }

  track(p) {
    const done = p.finally(() => {
      this.pending.delete(done);
      if (!this.pending.size && this.tick) { clearInterval(this.tick); this.tick = null; }
      this.changed();
    });
    this.pending.add(done);
    if (!this.tick) { this.tick = setInterval(() => this.changed(), 1000); this.tick.unref?.(); }
    return done;
  }

  dispose() { if (this.tick) clearInterval(this.tick); this.tick = null; }

  // ---- views ----------------------------------------------------------------------------------------------------------
  push(v) { this.state.stack.push({ sel: 0, top: 0, ...v }); return top(this.state); }

  pushProjects() {
    let data;
    try { data = this.source.projects(); } catch (e) { this.push({ kind: 'projects', data: null, error: message(e), rootShown: this.source.rootShown, rows: [] }); return; }
    this.push({ kind: 'projects', data, rows: data.projects.map((p) => ({ kind: 'project', ...p })) });
  }

  pushSessions(project) {
    const v = this.push({ kind: 'sessions', project, data: null, rows: [], since: this.now() });
    let p;
    try { p = Promise.resolve(this.source.sessions(project)); } catch (e) { p = Promise.reject(e); }
    this.track(p.then((d) => {
      v.data = d;
      v.rows = d.sessions.map((s) => ({ kind: 'session', p: s.p, first: s.first, last: s.last, turns: s.turns, calls: s.calls, failures: s.failures, compactions: Array.isArray(s.compactions) ? s.compactions.length : 0, agents: s.agents, file: s.file, firstPrompt: s.firstPrompt, lastReply: s.lastReply, copies: s.copies?.length ?? 0 }));
    }, (e) => { v.error = message(e); }));
  }

  /** The transcript, read in this process: the one read last when it is the same file, unchanged. */
  readDoc(project, file) {
    const key = `${project}\0${file}`;
    const d = this.doc?.key === key ? this.doc.doc : null;
    if (d && this.source.unchanged?.(d)) return d;
    const doc = this.source.open(project, file);
    this.doc = { key, doc };
    if (this.source.errorClasses) {
      this.track(this.source.errorClasses(doc).then((ek) => { doc.ek = ek; }, () => { doc.ekError = true; }));
    }
    return doc;
  }

  /** Push a session's view; it is read after a frame that says so. `then` opens a turn in it once read ({ ta }, with the
   *  row on line `at` selected) or a record ({ line }, above the turn that holds it). On the session's own view, `then`
   *  opens there, without a second copy of the view. */
  openSession(project, file, then = null) {
    const here = top(this.state);
    if (then && here?.kind === 'session' && here.project === project && here.file === file && here.doc) { this.then(here, then); this.changed(); return here; }
    const v = this.push({ kind: 'session', project, file, doc: null, rows: [], since: this.now() });
    this.track(new Promise((resolve) => setImmediate(resolve)).then(() => {
      const doc = this.readDoc(project, file);
      v.doc = doc;
      v.rows = sessionRows(doc.view);
      if (then && top(this.state) === v) this.then(v, then);
    }).catch((e) => { v.error = message(e); }));
    this.changed();
    return v;
  }

  /** In a session read: open the turn named, or the record on a line (in the turn that holds it, when one does). */
  then(sv, { ta = null, line = null, at = null }) {
    const doc = sv.doc, turns = doc.view.turns;
    const holds = (t, n) => t.line === n || t.items.some((x) => x.line === n || x.rline === n);
    let ti = ta !== null ? turns.findIndex((t) => t.ta === ta) : turns.findIndex((t) => holds(t, line));
    if (ta !== null && ti < 0) { this.note(`${ta} is not a turn of ${doc.name} (it has ${turns.length})`, true); return; }
    if (ti >= 0) {
      sv.sel = Math.max(0, sv.rows.findIndex((r) => r.kind === 'turn' && r.index === ti));
      const tv = this.pushTurn(sv, ti);
      const n = line ?? at;
      if (n !== null) { const k = tv.rows.findIndex((r) => r.line === n); if (k >= 0) tv.sel = k; }
    }
    if (line !== null) this.pushRecord(sv.project, sv.file, doc, line);
  }

  pushTurn(sv, i) {
    const t = sv.doc.view.turns[i];
    return this.push({ kind: 'turn', project: sv.project, file: sv.file, doc: sv.doc, turn: t, rows: turnRows(t) });
  }

  /** Push the record on a line: refused, before anything of it is laid out, when its view would not fit in this
   *  process's memory beside the transcript's parse (src/reading.mjs recordTooLarge): the view says so, with the
   *  NODE_OPTIONS that would let it be shown. */
  pushRecord(project, file, doc, line) {
    const i = recordIndexAt(doc.t, line);
    if (i === undefined) { this.note(`no record was parsed on line ${line} of ${doc.name}: the line is blank, not a JSON object, or past the end of the file`, true); return null; }
    const a = `${doc.prefix}:L${line}`;
    const why = recordTooLarge(doc.t.positions[i].bytes, doc.size, this.source.reading?.heapLimit, this.source.reading?.again);
    if (why) return this.push({ kind: 'record', project, file, doc, line, a, rec: null, json: false, error: `${a} is not shown: ${why}` });
    const rec = recordView(doc.t, line, { name: doc.name, whole: true });
    return this.push({ kind: 'record', project, file, doc, line, a, rec, json: false });
  }

  pushSearch(q) {
    const where = this.scope();
    const v = this.push({ kind: 'search', q, project: where.project, scopeShown: where.shown, skip: 0, max: SEARCH_MAX, result: null, rows: [], since: this.now() });
    this.runSearch(v);
  }

  runSearch(v) {
    v.result = null; v.error = null; v.rows = []; v.since = this.now();
    let p;
    try { p = Promise.resolve(this.source.search({ project: v.project, q: v.q, skip: v.skip, max: v.max })); } catch (e) { p = Promise.reject(e); }
    this.track(p.then((r) => {
      v.result = r; v.rows = searchRows(r);
      // the first matching turn selected, so that Enter opens it at its first match (R.F7: the session's row above it
      // was selected, and Enter opened the session)
      const hit = v.rows.findIndex((x) => x.kind === 'hit');
      v.sel = hit >= 0 ? hit : Math.max(0, v.rows.findIndex((x) => x.kind !== 'info')); v.top = 0;
    }, (e) => { v.error = message(e); }));
  }

  /** What a search covers from here: the project of the view on top (every project from Projects), or the one file. */
  scope() {
    if (this.source.kind === 'file') return { project: null, shown: `in ${this.source.name}` };
    const v = top(this.state);
    const project = v.kind === 'projects' ? null : v.project ?? null;
    return { project, shown: project === null ? 'in every project' : `in ${project}` };
  }

  note(text, bad = false) { this.state.note = { text, bad }; }

  // ---- keys -----------------------------------------------------------------------------------------------------------
  /** One keypress, as readline's emitKeypressEvents gives it: the string, and { name, ctrl, meta, shift, sequence }. A
   *  paste (bracketed by the terminal: readline's paste-start and paste-end) is text: into the line being typed, its new
   *  lines and tabs as spaces, never submitting it; with no line being typed, nothing (R.F8). Ctrl-C quits even then. */
  key(str, k = {}) {
    if (this.quitting !== null) return;
    if (k.ctrl && k.name === 'c') return this.exit(130);
    if (k.name === 'paste-start' || k.name === 'paste-end') { this.pasting = k.name === 'paste-start'; return this.changed(); }
    if (this.pasting) {
      if (this.state.input && typeof str === 'string' && !k.ctrl && !k.meta) this.inputKey(str.replace(/[\r\n\t]/g, ' '), {});
      return this.changed();
    }
    this.state.note = null;
    if (this.state.input) { this.inputKey(str, k); return this.changed(); }
    // the keys screen: q quits there too (R.F11), any other key goes back
    if (this.state.help) { if (k.name === 'q' && !k.ctrl && !k.meta) return this.exit(0); this.state.help = false; return this.changed(); }
    const v = top(this.state);
    const name = k.name;
    // a key with Ctrl does nothing here (but Ctrl-C, above); with Alt (meta), a named key is the key itself: two Esc
    // pressed at once arrive as one Esc with meta
    if (k.ctrl) return this.changed();
    if (name === 'up') this.move(v, -1);
    else if (name === 'down') this.move(v, 1);
    else if (name === 'pageup') this.move(v, -this.page(v));
    else if (name === 'pagedown') this.move(v, this.page(v));
    else if (name === 'home') this.move(v, -Infinity);
    else if (name === 'end') this.move(v, Infinity);
    else if (name === 'return' || name === 'enter' || name === 'right') this.open(v);
    else if (name === 'escape' || name === 'left') this.back();
    else if (k.meta) { /* Alt and a character: nothing */ }
    else if (name === 'q') return this.exit(0);
    else if (str === '/') this.state.input = { kind: 'search', text: '', scopeShown: this.scope().shown };
    else if (str === ':') this.state.input = { kind: 'address', text: '' };
    else if (str === '?') this.state.help = true;
    else if (str === 'j' && v.kind === 'record' && v.rec) { v.json = !v.json; v.top = 0; }
    this.changed();
  }

  page(v) { return Math.max(1, bodyHeight(this.state.rows, headed(v)) - 1); }

  move(v, delta) {
    if (v.kind === 'record') {
      if (!v.rec) return;
      const n = recordLines(v.rec, v.json, this.state.cols).length, h = bodyHeight(this.state.rows, false);
      v.top = Math.max(0, Math.min(Math.max(0, n - h), delta === -Infinity ? 0 : delta === Infinity ? n : (v.top ?? 0) + delta));
      return;
    }
    const rows = v.rows ?? [];
    if (!rows.length) return;
    const ok = (i) => rows[i] && rows[i].kind !== 'info';
    let i = delta === -Infinity ? 0 : delta === Infinity ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, v.sel + delta));
    const dir = delta < 0 ? -1 : 1;
    while (rows[i] && !ok(i)) i += dir;
    if (!ok(i)) { i = Math.max(0, Math.min(rows.length - 1, i)); while (rows[i] && !ok(i)) i -= dir; }
    if (!ok(i)) return;
    v.sel = i;
    v.top = topOf(v, rows.length, bodyHeight(this.state.rows, headed(v)));
  }

  open(v) {
    const r = v.rows?.[v.sel];
    if (!r) return;
    try {
      if (v.kind === 'projects') { if (!r.unreadable) this.pushSessions(r.name); else this.note(`${r.name} cannot be listed (${r.unreadable})`, true); }
      else if (v.kind === 'sessions') this.openSession(v.project, r.file);
      else if (v.kind === 'session') {
        if (!v.doc) return;
        if (r.kind === 'turn') this.pushTurn(v, r.index);
        else this.pushRecord(v.project, v.file, v.doc, r.kind === 'compaction' ? r.sline ?? r.line : r.line);
      } else if (v.kind === 'turn') this.pushRecord(v.project, v.file, v.doc, r.line);
      else if (v.kind === 'search') {
        if (r.kind === 'file') this.openSession(r.project, r.file);
        else if (r.kind === 'hit') this.openSession(r.project, r.file, { ta: r.ta, at: lineOf(r.at[0]?.a) });
        else if (r.kind === 'more') { v.skip = r.skip; this.runSearch(v); }
      }
    } catch (e) { this.note(message(e), true); }
  }

  back() {
    if (this.state.stack.length > 1) { this.state.stack.pop(); return; }
    this.note('this is the first view: q quits');
  }

  inputKey(str, k) {
    const inp = this.state.input;
    if (k.name === 'escape') { this.state.input = null; return; }
    if (k.name === 'return' || k.name === 'enter') {
      const text = inp.text.trim();
      this.state.input = null;
      if (text === '') return;
      if (inp.kind === 'search') this.pushSearch(text);
      else this.openAddress(text);
      return;
    }
    if (k.name === 'backspace') { const cs = [...clusters(inp.text)]; cs.pop(); inp.text = cs.join(''); return; }
    if (k.ctrl && k.name === 'u') { inp.text = ''; return; }
    if (k.ctrl || k.meta || typeof str !== 'string' || str === '') return;
    if (/[\u0000-\u001f\u007f-\u009f]/.test(str)) return;
    if (inp.text.length + str.length <= MAX_INPUT) inp.text += str;
  }

  /** Open an address as ltms prints it: the transcript its prefix names (in the project on screen first), then the
   *  turn or the record. */
  openAddress(text) {
    const m = ADDRESS.exec(text);
    if (!m) { this.note(`not an address: ${text} (an address is <prefix>:L<line> or <prefix>:T<turn>, as ltms prints it)`, true); return; }
    const [, prefix, kind, n] = m;
    const then = kind === 'L' ? { line: Number(n) } : { ta: `${prefix}:T${String(Number(n)).padStart(3, '0')}` };
    const here = this.scope().project;
    const known = this.state.stack.findLast?.((v) => v.kind === 'sessions' && v.project === here)?.rows.find((r) => r.p === prefix);
    if (known) { this.openSession(here, known.file, then); return; }
    let p;
    try { p = Promise.resolve(this.source.resolve(prefix, { prefer: here })); } catch (e) { p = Promise.reject(e); }
    this.note(`looking for ${prefix} ...`);
    this.track(p.then((found) => {
      this.state.note = null;
      if (!found.length) { this.note(this.source.kind === 'file' ? `${prefix} is not this transcript's prefix (${this.source.prefix})` : `no transcript has the address prefix ${prefix} in any project`, true); return; }
      if (found.length > 1) this.note(`${found.length} transcripts have the prefix ${prefix}; this is the first, ${found[0].project}/${found[0].file}`, true);
      this.openSession(found[0].project, found[0].file, then);
    }, (e) => { this.note(message(e), true); }));
  }

  exit(code) {
    if (this.quitting !== null) return;
    this.quitting = code;
    this.dispose();
    this.onExit(code);
  }
}

/** Whether a view's list has a line of column headings above it (as views.mjs draws it). */
const headed = (v) => v.kind !== 'record' && v.kind !== 'search';

/** The line of an address <prefix>:L<line>, or null. */
export const lineOf = (a) => { const m = /:L(\d+)$/.exec(String(a ?? '')); return m ? Number(m[1]) : null; };
