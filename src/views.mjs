// src/views.mjs — what the screen shows: one render function per view, (state, columns, rows) → the screen's lines,
// exactly `rows` of them. A line is a list of segments { text, style }: the text already made visible (src/text.mjs),
// one line, cut to its columns (the last line one column short, so nothing is ever written to the screen's last cell);
// the style one of null, 'head', 'dim', 'sel', 'bad', 'addr'. src/screen.mjs writes them; plain() gives their text.
//
// Every list row begins with its address as ltms prints it (a session's prefix, a turn's id, a record's <prefix>:L<line>),
// so the address of what is on screen can be given to an agent as it is; the selected row's is also on the last line.
import { clusters, expandTabs, fit, visible, width, wrap, wrapWords } from './text.mjs';
import { prefixOf } from './view.mjs';

export const MIN_COLS = 20, MIN_ROWS = 5;
export const top = (state) => state.stack[state.stack.length - 1];
export const plain = (lines) => lines.map((l) => l.map((s) => s.text).join(''));

// ---- text into cells ------------------------------------------------------------------------------------------------
/** A label on one line: every control character, the new line and the tab included, visible. */
export const label = (s) => visible(s ?? '').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
/** The first line of a text that holds anything but blanks, made visible, its tabs as spaces. */
export function preview(s) {
  const v = visible(typeof s === 'string' ? s : '');
  const first = v.split('\n').find((l) => l.trim() !== '') ?? '';
  return expandTabs(first).trimEnd();
}
const num = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '-');
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
/** text in exactly w columns: cut with … when longer, padded with spaces (at the left when align is 'right'). */
export function cell(text, w, align = 'left') {
  if (w <= 0) return '';
  const t = fit(text, w), gap = ' '.repeat(Math.max(0, w - width(t)));
  return align === 'right' ? gap + t : t + gap;
}
const seg = (text, style = null) => ({ text, style });
/** One line of plain text in `cols` columns, in one style. */
const line = (text, cols, style = null) => [seg(fit(text, cols), style)];

const formats = new Map();
/** An ISO time as YYYY-MM-DD HH:MM in the time zone of the state (this machine's when none is set). */
export function when(iso, timeZone) {
  if (typeof iso !== 'string' || iso === '') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return label(iso).slice(0, 16);
  const key = timeZone ?? '';
  if (!formats.has(key)) formats.set(key, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const p = Object.fromEntries(formats.get(key).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// ---- the frame --------------------------------------------------------------------------------------------------------
const HINTS = {
  projects: 'Enter opens  / search  : address  ? keys  q quits',
  sessions: 'Enter opens  Esc back  / search  : address  ? keys  q quits',
  session: 'Enter opens  Esc back  / search  : address  ? keys  q quits',
  turn: 'Enter opens the record  Esc back  / search  : address  ? keys  q quits',
  record: 'PgUp PgDn pages  j JSON  Esc back  / search  : address  ? keys  q quits',
  search: 'Enter opens  Esc back  / search  : address  ? keys  q quits',
};

/** The end of s that fits in `cols` columns, in whole clusters (what is typed last stays in sight). */
export function tail(s, cols) {
  const cs = [...clusters(s)];
  let w = 0, i = cs.length;
  while (i > 0 && w + width(cs[i - 1]) <= cols) { w += width(cs[i - 1]); i--; }
  return cs.slice(i).join('');
}

/** The last line: what is being typed, else a message, else the selected row's address and the keys. Never in the
 *  screen's last column. */
function statusLine(state, cols, address, hint = HINTS[top(state).kind] ?? '') {
  const w = cols - 1;
  if (state.input) {
    const prompt = state.input.kind === 'search' ? `/ search ${state.input.scopeShown ?? ''}: ` : ': address: ';
    const room = Math.max(1, w - width(prompt) - 1);
    return [seg(fit(prompt, w)), seg(tail(label(state.input.text), room)), seg(' ', 'sel')];
  }
  if (!address) return line(hint, w, 'dim');
  const a = fit(label(address), w);
  return [seg(a, 'addr'), seg(fit(`  ${hint}`, w - width(a)), 'dim')];
}

/** The body's height for a frame with (or without) a line of column headings. */
export const bodyHeight = (rows, headings) => Math.max(1, rows - 4 - (headings ? 1 : 0));

function frame(state, cols, rows, { title, sub = '', headings = null, body, detail = '', address = null, hint }) {
  const out = [line(title, cols, 'head'), line(sub, cols, 'dim')];
  if (headings) out.push([seg(fit(headings, cols), 'dim')]);
  const h = bodyHeight(rows, !!headings);
  for (let i = 0; i < h; i++) out.push(body[i] ?? []);
  out.push(line(detail, cols, 'dim'));
  out.push(statusLine(state, cols, address, hint));
  if (state.note && !state.input) {
    // a message: on the last line, and on up to two lines above it when it is longer
    const style = state.note.bad ? 'bad' : null, lines = wrapWords(label(state.note.text), cols - 1);
    const shown = lines.length > 3 ? [...lines.slice(0, 2), lines.slice(2).join(' ')] : lines;
    shown.forEach((l, i) => { out[out.length - shown.length + i] = line(l, cols - 1, style); });
  }
  return out.slice(0, rows);
}

/** The first list row in sight: the view's own, moved so that its selected row is in sight. */
export function topOf(view, n, h) {
  let t = Math.max(0, Math.min(view.top ?? 0, n - h));
  const sel = view.sel ?? 0;
  if (sel < t) t = sel;
  if (sel >= t + h) t = sel - h + 1;
  return Math.max(0, t);
}

/** A list row from its cells ([text, columns, align, style]), the last cell taking what is left; the selected row marked
 *  with > and drawn in reverse across the whole width. */
function listRow(cells, cols, selected) {
  const out = [seg(selected ? '> ' : '  ')];
  let used = 2;
  cells.forEach(([text, w, align = 'left', style = null], i) => {
    const last = i === cells.length - 1, room = cols - used;
    if (room <= 0) return;
    const sep = i === 0 ? '' : '  ';
    if (sep) { out.push(seg(fit(sep, room))); used += width(sep); }
    const flex = last && w === 0;   // a last cell of no width takes what is left
    const cw = flex ? Math.max(0, cols - used) : Math.min(w, cols - used);
    const t = flex ? fit(text, cw) : cell(text, cw, align);
    out.push(seg(t, style));
    used += width(t);
  });
  if (selected) {
    const rest = cols - used;
    if (rest > 0) out.push(seg(' '.repeat(rest)));
    return out.map((s) => ({ text: s.text, style: 'sel' }));
  }
  return out;
}

const loadingBody = (view, state, what) => {
  const secs = view.since ? Math.floor(((state.now ?? Date.now()) - view.since) / 1000) : 0;
  return [[seg(`  ${what}${secs >= 1 ? ` (${secs} s)` : ''}`, 'dim')]];
};
const errorBody = (text, cols) => wrapWords(label(text), Math.max(1, cols - 2)).map((l) => [seg('  '), seg(l, 'bad')]);
const textBody = (text, cols, style = 'dim') => text.split('\n').flatMap((p) => wrapWords(expandTabs(visible(p)), Math.max(1, cols - 2))).map((l) => [seg('  '), seg(l, style)]);

function listBody(view, rows, h, toCells, cols) {
  const t = topOf(view, rows.length, h);
  return rows.slice(t, t + h).map((r, i) => listRow(toCells(r), cols, t + i === view.sel && r.kind !== 'info'));
}

// ---- Projects ---------------------------------------------------------------------------------------------------------
export function projects(state, cols, rows) {
  const v = top(state), d = v.data;
  const title = `ltms-reader  Projects  ${label(d?.rootShown ?? v.rootShown ?? '')}`;
  if (v.error) return frame(state, cols, rows, { title, sub: 'the projects folder could not be listed', body: errorBody(v.error, cols) });
  if (!d) return frame(state, cols, rows, { title, body: loadingBody(v, state, 'reading the projects folder') });
  const h = bodyHeight(rows, true);
  const sub = d.state !== 'dir' ? `no folder at ${label(d.rootShown)}` : `${plural(d.projects.length, 'project folder', 'project folders')}${d.links ? `; ${plural(d.links, 'symbolic link', 'symbolic links')} not entered` : ''}`;
  const nameW = Math.max(8, cols - 2 - 2 - 11 - 2 - 16);
  const body = d.projects.length ? listBody(v, v.rows, h, (r) => [[label(r.name), nameW], [r.unreadable ? 'unreadable' : r.transcripts === null ? '?' : `${num(r.transcripts)}${r.cut ? '+' : ''}`, 11, 'right', r.unreadable ? 'bad' : null], [when(r.newest ? new Date(r.newest).toISOString() : '', state.timeZone), 16]], cols)
    : textBody(d.state !== 'dir' ? 'Give ltms-reader a folder of project folders, or one transcript (a .jsonl file).' : 'No project folders here: a project folder holds the transcripts (.jsonl) of the sessions run in one directory.', cols);
  const r = v.rows[v.sel];
  const detail = r ? `${label(d.rootShown)}/${label(r.name)}${r.unreadable ? `: cannot be listed (${label(r.unreadable)})` : ''}` : '';
  return frame(state, cols, rows, { title, sub, headings: `  ${cell('project folder', nameW)}  ${cell('transcripts', 11, 'right')}  newest`, body, detail, address: r ? label(r.name) : null });
}

// ---- Sessions ---------------------------------------------------------------------------------------------------------
export function sessions(state, cols, rows) {
  const v = top(state), d = v.data;
  const title = `ltms-reader  Sessions  ${label(v.project)}`;
  if (v.error) return frame(state, cols, rows, { title, sub: 'ltms index could not list them', body: errorBody(v.error, cols) });
  if (!d) return frame(state, cols, rows, { title, sub: 'ltms index reads every transcript of the project', body: loadingBody(v, state, 'reading the sessions with ltms index') });
  const c = d.coverage?.files ?? {};
  const sub = `${plural(d.sessions.length, 'session', 'sessions')}  ${num(c.found)} files found, ${num(c.read)} read, ${num(c.failed)} failed${c.notConversation ? `, ${num(c.notConversation)} with no conversation` : ''}${d.copies?.files ? `; ${plural(d.copies.files, 'identical copy', 'identical copies')} folded` : ''}  ${((d.ms ?? 0) / 1000).toFixed(1)} s`;
  const pw = Math.min(26, Math.max(8, ...v.rows.map((r) => width(label(r.p)))));
  const wide = cols >= 120;
  const cellsOf = (r) => [
    [label(r.p), pw, 'left', 'addr'], [when(r.first, state.timeZone), 16], [num(r.turns), 5, 'right'], [num(r.calls), 5, 'right'],
    [num(r.failures), 6, 'right', r.failures ? 'bad' : null], [num(r.compactions), 7, 'right'], [r.agents === null || r.agents === undefined ? '?' : num(r.agents), 6, 'right'],
    ...(wide ? [[when(r.last, state.timeZone), 16], [`${label(r.file)}${r.copies ? `  +${plural(r.copies, 'identical copy', 'identical copies')}` : ''}`, 0]] : []),
  ];
  const headings = `  ${cell('session', pw)}  ${cell('started', 16)}  ${cell('turns', 5, 'right')}  ${cell('calls', 5, 'right')}  ${cell('failed', 6, 'right')}  ${cell('compact', 7, 'right')}  ${cell('agents', 6, 'right')}${wide ? `  ${cell('last', 16)}  file` : ''}`;
  const h = bodyHeight(rows, true);
  const body = v.rows.length ? listBody(v, v.rows, h, cellsOf, cols) : textBody('ltms index lists no session here: no transcript in this folder holds a turn.', cols);
  const r = v.rows[v.sel];
  const detail = r ? `${label(r.file)}  first prompt ${label(r.firstPrompt ?? '-')}  last reply ${label(r.lastReply ?? '-')}${r.copies ? `  +${plural(r.copies, 'identical copy', 'identical copies')}` : ''}` : '';
  return frame(state, cols, rows, { title, sub, headings, body, detail, address: r ? label(r.p) : null });
}

// ---- A session --------------------------------------------------------------------------------------------------------
const tokens = (n) => (Number.isFinite(n) ? num(n) : '?');
export function compactionText(r, word = true) {
  return `${word ? 'compaction' : ''}${r.trigger ? ` (${label(r.trigger)})` : ''}${r.summary ? `  summary ${label(r.summary)}` : '  no summary'}${r.pre !== null || r.post !== null ? `  ${tokens(r.pre)} -> ${tokens(r.post)} tokens` : ''}${r.by ? `  made by /compact at ${label(r.by)}` : ''}`;
}
export function session(state, cols, rows) {
  const v = top(state), doc = v.doc;
  const where = v.project === null ? label(v.file) : `${label(v.project)}/${label(v.file)}`;
  const title = `ltms-reader  Session ${label(prefixOf(String(v.file).slice(String(v.file).lastIndexOf('/') + 1)))}  ${where}`;
  if (v.error) return frame(state, cols, rows, { title, sub: 'this transcript could not be read', body: errorBody(v.error, cols) });
  if (!doc) return frame(state, cols, rows, { title, body: loadingBody(v, state, `reading ${label(v.file)}`) });
  const sv = doc.view, failed = sv.index.failures, calls = sv.index.calls;
  const sub = `${plural(sv.turns.length, 'turn', 'turns')}  ${plural(calls, 'call', 'calls')}  ${num(failed)} failed  ${plural(sv.index.compactions.length, 'compaction', 'compactions')}  ${plural(sv.stats.lines, 'line', 'lines')}${sv.stats.first ? `  ${when(sv.stats.first, state.timeZone)} to ${when(sv.stats.last, state.timeZone)}` : ''}`;
  const aw = Math.min(26, Math.max(8, ...v.rows.map((r) => width(label(r.ta ?? r.a)))));
  const h = bodyHeight(rows, true);
  const cellsOf = (r) => (r.kind === 'turn'
    ? [[label(r.ta), aw, 'left', 'addr'], [label(r.ch), 8], [num(r.calls), 5, 'right'], [num(r.failed), 6, 'right', r.failed ? 'bad' : null], [r.command ? `${label(r.command.name)} ${label(r.command.args)}` : preview(r.prompt), 0]]
    : r.kind === 'compaction' ? [[label(r.a), aw, 'left', 'addr'], [compactionText(r), 0, 'left', 'dim']]
      : [[label(r.a), aw, 'left', 'addr'], [`${r.kind}  ${preview(r.text)}`, 0, 'left', 'dim']]);
  const empty = `No turns: ltms reads this file as ${label(sv.fileKind)}, ${plural(sv.stats.lines, 'line', 'lines')}, ${plural(sv.stats.parsed, 'record', 'records')} parsed${sv.problems.count ? `, ${plural(sv.problems.count, 'line', 'lines')} not read` : ''}. A session's turns start at its prompts.`;
  const body = v.rows.length ? listBody(v, v.rows, h, cellsOf, cols) : textBody(empty, cols);
  const r = v.rows[v.sel];
  let detail = '';
  if (r?.kind === 'turn') detail = `${label(r.ta)}  prompt ${label(r.a)}  lines ${r.from} to ${r.to}  ${plural(r.records, 'record', 'records')}${r.time ? `  ${when(r.time, state.timeZone)}` : ''}`;
  else if (r?.kind === 'compaction') detail = `boundary ${label(r.a)}${r.summary ? `  summary ${label(r.summary)}` : ''}${r.time ? `  ${when(r.time, state.timeZone)}` : ''}${r.lead ? '  before the first prompt' : ''}`;
  else if (r) detail = `${label(r.a)}  ${r.kind}`;
  return frame(state, cols, rows, { title, sub, headings: `  ${cell('turn', aw)}  ${cell('channel', 8)}  ${cell('calls', 5, 'right')}  ${cell('failed', 6, 'right')}  prompt`, body, detail, address: r ? (r.ta ?? r.a) : null });
}

// ---- A turn -----------------------------------------------------------------------------------------------------------
/** What a turn's row says after its address and kind. */
export function itemText(r, ek) {
  switch (r.kind) {
    case 'prompt': return `${label(r.ch)}  ${plural(r.n, 'character', 'characters')}  ${r.command ? `${label(r.command.name)} ${label(r.command.args)}` : preview(r.text)}`;
    case 'call': {
      const status = r.ok === true ? 'ok' : r.ok === false ? `failed${ek ? ` ${label(ek)}` : ''}` : 'no result recorded';
      return `${status}  ${label(r.tool)}  ${r.inputKey ? `${label(r.inputKey)}: ` : ''}${preview(r.inputText)}`;
    }
    case 'result': return `${plural(r.n, 'character', 'characters')}  ${preview(r.text)}`;
    case 'compaction': return compactionText(r, false).trim();
    case 'note': return `${label(r.sub)}  ${r.command ? `${label(r.command.name)} ${label(r.command.args)}` : preview(r.text)}`;
    default: return preview(r.text);
  }
}
export function turn(state, cols, rows) {
  const v = top(state), doc = v.doc, t = v.turn;
  const title = `ltms-reader  Turn ${label(t.ta)}  ${v.project === null ? label(v.file) : `${label(v.project)}/${label(v.file)}`}`;
  const sub = `${label(t.ch)}  ${plural(t.calls, 'call', 'calls')}  ${num(t.failed)} failed${t.time ? `  ${when(t.time, state.timeZone)}` : ''}${doc.ekError ? '  (error classes: ltms skeleton failed)' : doc.ek ? '' : '  (error classes: reading)'}`;
  const aw = Math.min(26, Math.max(8, ...v.rows.map((r) => width(label(r.a)))));
  const h = bodyHeight(rows, true);
  const cellsOf = (r) => [[label(r.a), aw, 'left', 'addr'], [r.kind, 10], [itemText(r, doc.ek?.get(r.call ?? r.item)), 0, 'left', r.kind === 'call' && r.ok === false ? 'bad' : r.kind === 'result' || r.kind === 'note' ? 'dim' : null]];
  const body = listBody(v, v.rows, h, cellsOf, cols);
  const r = v.rows[v.sel];
  let detail = '';
  if (r?.kind === 'call') detail = `${label(r.a)}  call ${label(r.tool)}${r.r ? `  result ${label(r.r)}` : '  no result recorded'}${r.time ? `  ${when(r.time, state.timeZone)}` : ''}`;
  else if (r?.kind === 'result') detail = `${label(r.a)}  the result of the call at ${label(r.of)}`;
  else if (r) detail = `${label(r.a)}  ${r.kind}${r.time ? `  ${when(r.time, state.timeZone)}` : ''}`;
  return frame(state, cols, rows, { title, sub, headings: `  ${cell('address', aw)}  ${cell('kind', 10)}  what`, body, detail, address: r?.a ?? null });
}

// ---- A record ---------------------------------------------------------------------------------------------------------
const pages = new WeakMap();
/** The record's lines at `cols` columns: each part's label, then its text, wrapped; or its JSON. */
export function recordLines(rec, json, cols) {
  let byKey = pages.get(rec);
  if (!byKey) { byKey = new Map(); pages.set(rec, byKey); }
  const key = `${json ? 'j' : 't'}:${cols}`;
  if (byKey.has(key)) return byKey.get(key);
  const out = [];
  const text = (s, style = null) => { for (const p of visible(s).split('\n')) for (const l of wrap(expandTabs(p), cols)) out.push([seg(l, style)]); };
  if (json) {
    text(rec.raw.text);
    if (rec.raw.more) out.push([seg(fit(`... ${plural(rec.raw.more, 'more character', 'more characters')} not shown`, cols), 'dim')]);
  } else {
    if (!rec.reading.length) out.push([seg('(nothing to read in this record)', 'dim')]);
    rec.reading.forEach((p, i) => {
      if (i) out.push([]);
      out.push([seg(fit(`-- ${label(p.label)} --`, cols), 'head')]);
      if (p.text !== '') text(p.text);
      if (p.more) out.push([seg(fit(`... ${plural(p.more, 'more character', 'more characters')} not shown`, cols), 'dim')]);
    });
  }
  byKey.set(key, out);
  return out;
}
export function record(state, cols, rows) {
  const v = top(state), rec = v.rec;
  const title = `ltms-reader  Record ${label(rec.a)}  ${v.project === null ? label(v.file) : `${label(v.project)}/${label(v.file)}`}`;
  const lines = recordLines(rec, v.json, cols);
  const h = bodyHeight(rows, false);
  const t = Math.max(0, Math.min(v.top ?? 0, lines.length - h));
  const kind = [rec.type, rec.subtype].filter(Boolean).map(label).join('/') || '(no type)';
  const sub = `${kind}${rec.channel ? `  ${label(rec.channel)}` : ''}${rec.time ? `  ${when(rec.time, state.timeZone)}` : ''}  ${plural(rec.bytes, 'byte', 'bytes')} at offset ${num(rec.offset)}  ${v.json ? 'as JSON' : plural(rec.reading.length, 'part', 'parts')}  lines ${num(Math.min(lines.length, t + 1))} to ${num(Math.min(lines.length, t + h))} of ${num(lines.length)}`;
  return frame(state, cols, rows, { title, sub, body: lines.slice(t, t + h), detail: `${label(rec.a)}  line ${rec.line} of ${label(v.file)}${rec.uuid ? `  uuid ${label(rec.uuid)}` : ''}`, address: rec.a });
}

// ---- Search -----------------------------------------------------------------------------------------------------------
export function coverageText(c) {
  if (!c) return 'ltms search printed no coverage line';
  const f = c.files ?? {}, ns = c.notSearched ?? {};
  const skipped = Object.entries(ns).filter(([, n]) => n).map(([k, n]) => `${num(n)} ${k}`);
  return `${plural(c.hits?.turns ?? 0, 'matching turn', 'matching turns')} in ${num(c.hits?.files ?? 0)} of ${plural(f.found ?? 0, 'file', 'files')} (${num(f.read)} read, ${num(f.failed)} failed)  searched: ${(c.kinds ?? []).join(', ')}${c.kindsOff?.length ? `  not searched: ${c.kindsOff.join(', ')}` : ''}${skipped.length ? `; ${skipped.join(', ')}` : ''}${c.mode === 'substring' ? '  inside words' : ''}`;
}
export function search(state, cols, rows) {
  const v = top(state), d = v.result;
  const title = `ltms-reader  Search "${label(v.q)}"  ${v.scopeShown}`;
  if (v.error) return frame(state, cols, rows, { title, sub: 'ltms search could not run', body: errorBody(v.error, cols) });
  if (!d) return frame(state, cols, rows, { title, sub: 'ltms search reads every transcript in scope', body: loadingBody(v, state, 'searching with ltms search') });
  const c = d.coverage, shown = c?.shown?.turns ?? d.hits.length;
  const sub = `turns ${num(shown ? d.skip + 1 : 0)} to ${num(d.skip + shown)} of ${num(c?.hits?.turns ?? 0)}  ${((d.ms ?? 0) / 1000).toFixed(1)} s`;
  const tw = Math.min(26, Math.max(8, ...v.rows.filter((r) => r.kind === 'hit' || r.kind === 'file').map((r) => width(label(r.ta ?? r.p)))));
  const h = bodyHeight(rows, false);
  const cellsOf = (r) => {
    if (r.kind === 'info') return [[r.text, 0, 'left', 'dim']];
    if (r.kind === 'file') return [[label(r.p), tw, 'left', 'addr'], [when(r.last, state.timeZone), 16], [`${r.project === null ? '' : `${label(r.project)}/`}${label(r.file)}${r.copies ? `  +${plural(r.copies, 'identical copy', 'identical copies')}` : ''}`, 0]];
    if (r.kind === 'more') return [[`the next ${num(r.next)} of ${plural(r.left, 'more matching turn', 'more matching turns')}`, 0]];
    return [[label(r.ta), tw, 'left', 'addr'], [label(r.ch), 8], [r.at.map((e) => `${label(String(e.a).slice(String(e.a).lastIndexOf(':') + 1))} ${label(e.kind)}`).join('  '), 0]];
  };
  const body = listBody(v, v.rows, h, cellsOf, cols);
  const r = v.rows[v.sel];
  let detail = '';
  if (r?.kind === 'hit') detail = `${label(r.ta)}  ${plural(r.at.length, 'record', 'records')} with a match  first ${label(r.at[0]?.a ?? '')} ${label(r.at[0]?.kind ?? '')}`;
  else if (r?.kind === 'file') detail = `${r.project === null ? '' : `${label(r.project)}/`}${label(r.file)}  its latest record ${when(r.last, state.timeZone)}`;
  return frame(state, cols, rows, { title, sub, body, detail, address: r?.kind === 'hit' ? label(r.ta) : r?.kind === 'file' ? label(r.p) : null });
}

// ---- the keys ---------------------------------------------------------------------------------------------------------
export const KEYS = [
  ['Up Down', 'move one row (in a record, one line)'],
  ['PgUp PgDn', 'move one page'],
  ['Home End', 'the first row, the last'],
  ['Enter or Right', 'open the row: a project, a session, a turn, a record'],
  ['Esc or Left', 'go back'],
  ['/', 'search: the turns that hold every word, by ltms search, in this project (in every project from Projects)'],
  [':', 'open an address as ltms prints it: <prefix>:L<line> (a record) or <prefix>:T<turn> (a turn)'],
  ['j', 'in a record: its JSON, and back'],
  ['?', 'these keys'],
  ['q or Ctrl-C', 'quit'],
];
export function help(state, cols, rows) {
  const kw = 16;
  const body = [
    ...KEYS.flatMap(([k, what]) => wrapWords(what, Math.max(1, cols - kw - 4)).map((l, i) => [seg(`  ${cell(i ? '' : k, kw)}`, i ? null : 'addr'), seg(`  ${l}`)])),
    [],
    ...textBody('It shows your transcripts\' text, to you, on this terminal\'s alternate screen: nothing it shows is written to stdout, a pipe or a log. It writes no file and uses no network. Its lists are the lines ltms index and ltms search print; a session\'s turns and calls are those ltms skeleton prints.', cols),
  ];
  return frame({ ...state, input: null, note: null }, cols, rows, { title: 'ltms-reader  Keys', sub: 'any key goes back', body, detail: '', hint: 'any key goes back  Ctrl-C quits' });
}

/** A screen too small to use. */
export function small(state, cols, rows) {
  const out = [line(`ltms-reader needs ${MIN_COLS} x ${MIN_ROWS} at least; this is ${cols} x ${rows}`, cols - 1, 'bad')];
  while (out.length < rows) out.push([]);
  return out.slice(0, Math.max(0, rows));
}

export const RENDER = Object.freeze({ projects, sessions, session, turn, record, search });

/** The screen's lines for the state: the keys when asked for, else the view on top. */
export function render(state, cols, rows) {
  if (cols < MIN_COLS || rows < MIN_ROWS) return small(state, cols, rows);
  if (state.help) return help(state, cols, rows);
  return RENDER[top(state).kind](state, cols, rows);
}
