// src/views.mjs — what the screen shows: one render function per view, (state, columns, rows) → the screen's lines,
// exactly `rows` of them. A line is a list of segments { text, style, dir }: the text already made visible
// (src/text.mjs), one line, cut to its columns (the last line one column short, so nothing is ever written to the
// screen's last cell); the style one of null, 'head', 'dim', 'sel', 'bad', 'addr'. src/screen.mjs writes them, each
// segment a paragraph for the right-to-left layout (text.mjs displayOrder: its direction its own, or `dir`, a record
// line's text line's), so that a transcript's text is a segment of its own, apart from the reader's words before it
// (a cell given as parts: R1). plain() gives their text, in logical order.
//
// Every list row begins with its address as ltms prints it (a session's prefix, a turn's id, a record's <prefix>:L<line>),
// so the address of what is on screen can be given to an agent as it is; the selected row's is also on the last line.
import { clusters, directionOf, expandTabs, fit, fitParts, lineSpans, visible, width, wrapWords } from './text.mjs';
import { prefixOf } from './view.mjs';

export const MIN_COLS = 20, MIN_ROWS = 5;
export const top = (state) => state.stack[state.stack.length - 1];
export const plain = (lines) => lines.map((l) => l.map((s) => s.text).join(''));

// ---- text into cells ------------------------------------------------------------------------------------------------
/** A label on one line: every control character, the new line and the tab included, visible. */
export const label = (s) => visible(s ?? '').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
/** The first line of a text that holds anything but blanks, made visible, its tabs as spaces; with … at its end when
 *  the view layer's clip cut the text inside that line (`more` units left out: R.F4), so that the row shows it goes on. */
export function preview(s, more = 0) {
  const pieces = visible(typeof s === 'string' ? s : '').split('\n');
  const i = pieces.findIndex((l) => l.trim() !== '');
  if (i < 0) return more > 0 ? '\u2026' : '';
  const first = expandTabs(pieces[i]).trimEnd();
  return more > 0 && i === pieces.length - 1 ? `${first}\u2026` : first;
}
const num = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '-');
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
/** text in exactly w columns: cut with … when longer, padded with spaces (at the left when align is 'right'). */
export function cell(text, w, align = 'left') {
  if (w <= 0) return '';
  const t = fit(text, w), gap = ' '.repeat(Math.max(0, w - width(t)));
  return align === 'right' ? gap + t : t + gap;
}
const seg = (text, style = null, dir = undefined) => (dir === undefined ? { text, style } : { text, style, dir });
/** One line of plain text in `cols` columns, in one style; given as parts (each a paragraph of its own), a segment each. */
const line = (text, cols, style = null) => (Array.isArray(text) ? fitParts(text, cols).map((t) => seg(t, style)) : [seg(fit(text, cols), style)]);

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
/** Each view's keys on its last line, the first to keep first; "? keys" and "q quits" are always kept (R.F10). */
const HINTS = {
  projects: ['Enter opens', '/ search', ': address', '? keys', 'q quits'],
  sessions: ['Enter opens', 'Esc back', '/ search', ': address', '? keys', 'q quits'],
  session: ['Enter opens', 'Esc back', '/ search', ': address', '? keys', 'q quits'],
  turn: ['Enter opens the record', 'Esc back', '/ search', ': address', '? keys', 'q quits'],
  record: ['j JSON', 'Esc back', 'PgUp PgDn pages', '/ search', ': address', '? keys', 'q quits'],
  search: ['Enter opens', 'Esc back', '/ search', ': address', '? keys', 'q quits'],
};

/** The keys of a hint that fit in `cols` columns: its last two always (cut only when they alone do not fit), and before
 *  them as many of the others as fit, from the first (R.F10: at 80 columns, after a long address, the hint was cut and
 *  "q quits" with it). A hint that is a string is fit as it is. */
export function hintIn(hint, cols) {
  if (typeof hint === 'string') return fit(hint, cols);
  const kept = hint.slice(-2), rest = hint.slice(0, -2), out = [];
  for (const h of rest) { if (width([...out, h, ...kept].join('  ')) > cols) break; out.push(h); }
  return fit([...out, ...kept].join('  '), cols);
}

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
  if (!address) return [seg(hintIn(hint, w), 'dim')];
  const a = fit(label(address), w);
  const room = w - width(a) - 2;
  return room > 0 ? [seg(a, 'addr'), seg(`  ${hintIn(hint, room)}`, 'dim')] : [seg(a, 'addr')];
}

/** The body's height for a frame with (or without) a line of column headings, and `head` lines between the title and
 *  them (one, the view's second line, but in a Sessions view: sessionsHead). */
export const bodyHeight = (rows, headings, head = 1) => Math.max(1, rows - 3 - head - (headings ? 1 : 0));

/** `head`: the lines under the title, when they are more than the one line `sub`. */
function frame(state, cols, rows, { title, sub = '', head = null, headings = null, body, detail = '', address = null, hint }) {
  const heads = head ?? [line(sub, cols, 'dim')];
  const out = [line(title, cols, 'head'), ...heads];
  if (headings) out.push([seg(fit(headings, cols), 'dim')]);
  const h = bodyHeight(rows, !!headings, heads.length);
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

const widths = new WeakMap();
/** The widest of f(row) over a list's rows, at least `min` and at most `max`, by a loop (a list can hold more rows than a
 *  call can take arguments), counted once per list and kind of column. */
function widest(rows, tag, f, min, max) {
  let byTag = widths.get(rows);
  if (!byTag) { byTag = new Map(); widths.set(rows, byTag); }
  if (!byTag.has(tag)) { let w = min; for (const r of rows) { const x = f(r); if (x !== null) w = Math.max(w, x); if (w >= max) break; } byTag.set(tag, Math.min(max, w)); }
  return byTag.get(tag);
}

/** A count column's width: its widest count as shown (f(row), or null for a row without one), its heading's at least. */
const countWidth = (rows, tag, f, heading) => widest(rows, `count:${tag}`, (r) => { const t = f(r); return t === null ? null : width(t); }, width(heading), 15);

/** The first list row in sight: the view's own, moved so that its selected row is in sight. */
export function topOf(view, n, h) {
  let t = Math.max(0, Math.min(view.top ?? 0, n - h));
  const sel = view.sel ?? 0;
  if (sel < t) t = sel;
  if (sel >= t + h) t = sel - h + 1;
  return Math.max(0, t);
}

/** A list row from its cells ([text, columns, align, style]), the last cell taking what is left (its text may be parts,
 *  each a segment: the reader's words, then a transcript's text); the selected row marked with > and drawn in reverse
 *  across the whole width. */
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
    if (flex && Array.isArray(text)) { for (const t of fitParts(text, cw)) { out.push(seg(t, style)); used += width(t); } return; }
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
/** From this width on, a Sessions view's counts and its notice are shown whole (N2). */
export const WHOLE_FROM = 80;

/**
 * The lines between a Sessions view's title and its column headings: the counts and the coverage of `ltms index`'s
 * reading, then, for a list kept from an earlier reading (src/engine.mjs: one that took AUTO_MS or more is not read
 * again by itself when a file changes), when it was read and how many files changed since (R.F2). At WHOLE_FROM columns
 * and wider each is whole, on as many lines as it takes (N2: the notice, put first on the counts' line, hid them at 80
 * and 100 columns and was cut itself); narrower, or on a screen too low to keep a row of the list (under 8 rows at 80
 * columns), each takes one line, cut with …. The App reads its length for its pages (headOf).
 */
export function sessionsHead(state, v, cols, rows) {
  const d = v.data, c = d.coverage?.files ?? {};
  const counts = `${plural(d.sessions.length, 'session', 'sessions')}  ${num(c.found)} files found, ${num(c.read)} read, ${num(c.failed)} failed${c.notConversation ? `, ${num(c.notConversation)} with no conversation` : ''}${d.copies?.files ? `; ${plural(d.copies.files, 'identical copy', 'identical copies')} folded` : ''}  ${((d.ms ?? 0) / 1000).toFixed(1)} s`;
  const notice = d.changed ? `this list was read at ${when(new Date(d.changed.since).toISOString(), state.timeZone)}, and ${plural(d.changed.count, 'file', 'files')} changed since: it is read again when ltms-reader starts again` : null;
  const lines = (text, style, whole) => (whole ? wrapWords(text, cols) : [text]).map((l) => line(l, cols, style));
  const of = (whole) => [...lines(counts, 'dim', whole), ...(notice ? lines(notice, null, whole) : [])];
  const whole = cols >= WHOLE_FROM ? of(true) : null;
  return whole && rows - 4 - whole.length >= 1 ? whole : of(false);
}

/** How many lines a view has between its title and its column headings (frame's head): one, but in a Sessions view. */
export const headOf = (state, v) => (v.kind === 'sessions' && v.data && !v.error ? sessionsHead(state, v, state.cols, state.rows).length : 1);

export function sessions(state, cols, rows) {
  const v = top(state), d = v.data;
  const title = `ltms-reader  Sessions  ${label(v.project)}`;
  if (v.error) return frame(state, cols, rows, { title, sub: 'ltms index could not list them', body: errorBody(v.error, cols) });
  if (!d) return frame(state, cols, rows, { title, sub: 'ltms index reads every transcript of the project', body: loadingBody(v, state, 'reading the sessions with ltms index') });
  const head = sessionsHead(state, v, cols, rows);
  const pw = widest(v.rows, 'p', (r) => width(label(r.p)), 8, 26);
  const wide = cols >= 120;
  // each count as wide as its widest, its heading's width at least (R.F9: 12,000 turns read "12,0…" in 5 columns)
  const agents = (r) => (r.agents === null || r.agents === undefined ? '?' : num(r.agents));
  const tw = countWidth(v.rows, 'turns', (r) => num(r.turns), 'turns'), cw = countWidth(v.rows, 'calls', (r) => num(r.calls), 'calls');
  const fw = countWidth(v.rows, 'failures', (r) => num(r.failures), 'failed'), kw = countWidth(v.rows, 'compactions', (r) => num(r.compactions), 'compact');
  const gw = countWidth(v.rows, 'agents', agents, 'agents');
  const cellsOf = (r) => [
    [label(r.p), pw, 'left', 'addr'], [when(r.first, state.timeZone), 16], [num(r.turns), tw, 'right'], [num(r.calls), cw, 'right'],
    [num(r.failures), fw, 'right', r.failures ? 'bad' : null], [num(r.compactions), kw, 'right'], [agents(r), gw, 'right'],
    ...(wide ? [[when(r.last, state.timeZone), 16], [`${label(r.file)}${r.copies ? `  +${plural(r.copies, 'identical copy', 'identical copies')}` : ''}`, 0]] : []),
  ];
  const headings = `  ${cell('session', pw)}  ${cell('started', 16)}  ${cell('turns', tw, 'right')}  ${cell('calls', cw, 'right')}  ${cell('failed', fw, 'right')}  ${cell('compact', kw, 'right')}  ${cell('agents', gw, 'right')}${wide ? `  ${cell('last', 16)}  file` : ''}`;
  const h = bodyHeight(rows, true, head.length);
  const body = v.rows.length ? listBody(v, v.rows, h, cellsOf, cols) : textBody('ltms index lists no session here: no transcript in this folder holds a turn.', cols);
  const r = v.rows[v.sel];
  const detail = r ? `${label(r.file)}  first prompt ${label(r.firstPrompt ?? '-')}  last reply ${label(r.lastReply ?? '-')}${r.copies ? `  +${plural(r.copies, 'identical copy', 'identical copies')}` : ''}` : '';
  return frame(state, cols, rows, { title, head, headings, body, detail, address: r ? label(r.p) : null });
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
  const aw = widest(v.rows, 'ta', (r) => width(label(r.ta ?? r.a)), 8, 26);
  const h = bodyHeight(rows, true);
  const turnsOnly = (f) => (r) => (r.kind === 'turn' ? f(r) : null);
  const cw = countWidth(v.rows, 'calls', turnsOnly((r) => num(r.calls)), 'calls'), fw = countWidth(v.rows, 'failed', turnsOnly((r) => num(r.failed)), 'failed');
  const cellsOf = (r) => (r.kind === 'turn'
    ? [[label(r.ta), aw, 'left', 'addr'], [label(r.ch), 8], [num(r.calls), cw, 'right'], [num(r.failed), fw, 'right', r.failed ? 'bad' : null], [r.command ? `${label(r.command.name)} ${label(r.command.args)}` : preview(r.prompt, r.promptMore), 0]]
    : r.kind === 'compaction' ? [[label(r.a), aw, 'left', 'addr'], [compactionText(r), 0, 'left', 'dim']]
      : [[label(r.a), aw, 'left', 'addr'], [[`${r.kind}  `, preview(r.text, r.more)], 0, 'left', 'dim']]);
  const empty = `No turns: ltms reads this file as ${label(sv.fileKind)}, ${plural(sv.stats.lines, 'line', 'lines')}, ${plural(sv.stats.parsed, 'record', 'records')} parsed${sv.problems.count ? `, ${plural(sv.problems.count, 'line', 'lines')} not read` : ''}. A session's turns start at its prompts.`;
  const body = v.rows.length ? listBody(v, v.rows, h, cellsOf, cols) : textBody(empty, cols);
  const r = v.rows[v.sel];
  let detail = '';
  if (r?.kind === 'turn') detail = `${label(r.ta)}  prompt ${label(r.a)}  lines ${r.from} to ${r.to}  ${plural(r.records, 'record', 'records')}${r.time ? `  ${when(r.time, state.timeZone)}` : ''}`;
  else if (r?.kind === 'compaction') detail = `boundary ${label(r.a)}${r.summary ? `  summary ${label(r.summary)}` : ''}${r.time ? `  ${when(r.time, state.timeZone)}` : ''}${r.lead ? '  before the first prompt' : ''}`;
  else if (r) detail = `${label(r.a)}  ${r.kind}`;
  return frame(state, cols, rows, { title, sub, headings: `  ${cell('turn', aw)}  ${cell('channel', 8)}  ${cell('calls', cw, 'right')}  ${cell('failed', fw, 'right')}  prompt`, body, detail, address: r ? (r.ta ?? r.a) : null });
}

// ---- A turn -----------------------------------------------------------------------------------------------------------
/** What a turn's row says after its address and kind, as parts: the reader's words, then the transcript's text, each a
 *  paragraph of its own (R1). */
export function itemParts(r, ek) {
  const text = (t, more) => [preview(t, more)];
  switch (r.kind) {
    case 'prompt': return [`${label(r.ch)}  ${plural(r.n, 'character', 'characters')}  `, ...(r.command ? [`${label(r.command.name)} ${label(r.command.args)}`] : text(r.text, r.more))];
    case 'call': {
      const status = r.ok === true ? 'ok' : r.ok === false ? `failed${ek ? ` ${label(ek)}` : ''}` : 'no result recorded';
      return [`${status}  ${label(r.tool)}  ${r.inputKey ? `${label(r.inputKey)}: ` : ''}`, ...text(r.inputText, r.inputMore)];
    }
    case 'result': return [`${plural(r.n, 'character', 'characters')}  `, ...text(r.text, r.more)];
    case 'compaction': return [compactionText(r, false).trim()];
    case 'note': return [`${label(r.sub)}  `, ...(r.command ? [`${label(r.command.name)} ${label(r.command.args)}`] : text(r.text, r.more))];
    default: return text(r.text, r.more);
  }
}
/** What a turn's row says after its address and kind, as one string. */
export const itemText = (r, ek) => itemParts(r, ek).join('');
export function turn(state, cols, rows) {
  const v = top(state), doc = v.doc, t = v.turn;
  const title = `ltms-reader  Turn ${label(t.ta)}  ${v.project === null ? label(v.file) : `${label(v.project)}/${label(v.file)}`}`;
  const sub = `${label(t.ch)}  ${plural(t.calls, 'call', 'calls')}  ${num(t.failed)} failed${t.time ? `  ${when(t.time, state.timeZone)}` : ''}${doc.ekError ? '  (error classes: ltms skeleton failed)' : doc.ek ? '' : '  (error classes: reading)'}`;
  const aw = widest(v.rows, 'a', (r) => width(label(r.a)), 8, 26);
  const h = bodyHeight(rows, true);
  const cellsOf = (r) => [[label(r.a), aw, 'left', 'addr'], [r.kind, 10], [itemParts(r, doc.ek?.get(r.call ?? r.item)), 0, 'left', r.kind === 'call' && r.ok === false ? 'bad' : r.kind === 'result' || r.kind === 'note' ? 'dim' : null]];
  const body = listBody(v, v.rows, h, cellsOf, cols);
  const r = v.rows[v.sel];
  let detail = '';
  if (r?.kind === 'call') detail = `${label(r.a)}  call ${label(r.tool)}  ${itemText(r, doc.ek?.get(r.item)).split('  ')[0]}${r.r ? `  result ${label(r.r)}` : ''}${r.time ? `  ${when(r.time, state.timeZone)}` : ''}`;
  else if (r?.kind === 'result') detail = `${label(r.a)}  the result of the call at ${label(r.of)}`;
  else if (r) detail = `${label(r.a)}  ${r.kind}${r.time ? `  ${when(r.time, state.timeZone)}` : ''}`;
  return frame(state, cols, rows, { title, sub, headings: `  ${cell('address', aw)}  ${cell('kind', 10)}  what`, body, detail, address: r?.a ?? null });
}

// ---- A record ---------------------------------------------------------------------------------------------------------
/** Every STEP-th line's start is kept when a record's lines are counted; a page is laid out from the nearest before it. */
const STEP = 256;

/**
 * A record's lines at one width, laid out a page at a time (R.F1: a record's lines, made whole and kept at every width
 * a window passed through, ran Node's heap out). The record is a list of pieces: a line of its own (a blank line
 * between parts, a "more characters" line, the empty record's note), or a text laid out by its new lines, each line's
 * tabs as spaces, then by columns between clusters (src/text.mjs lineSpans, as wrap cuts). One pass counts the lines and
 * keeps where every STEP-th begins (its piece, the start of its text line, the offset in that line once its tabs are
 * spaces); slice(a, b) lays out lines a to b from the nearest. What it keeps is the pieces (the record's own strings)
 * and those marks, whatever the lines are.
 */
export class RecordLines {
  constructor(pieces, cols) {
    this.pieces = pieces;
    this.cols = cols;
    this.marks = [];
    this.last = null;   // the text line laid out last, its tabs as spaces: { p, at, text, dir }
    let n = 0;
    for (const l of this.walk(0, 0, 0)) { if (n % STEP === 0) this.marks.push([l.p, l.at, l.k]); n++; }
    this.length = n;
  }

  /** A text line of piece p, from `at` to the next new line, with its tabs as spaces (the one laid out last is kept). */
  textLine(p, at, end) {
    if (this.last?.p !== p || this.last.at !== at) this.last = { p, at, text: expandTabs(this.pieces[p].text.slice(at, end)) };
    return this.last.text;
  }

  /** The direction of the text line a line of it is in (the one laid out last, as walk() lays them out). */
  directionOf(l) {
    if (this.last?.text === l.text) return (this.last.dir ??= directionOf(l.text));
    return directionOf(l.text);
  }

  /** The lines from a mark (piece p, its text line at `at`, offset k in it): { p, at, k, text, a, b, style } each, where
   *  text.slice(a, b) is the line; a piece's own line has no text line ({ line }). */
  *walk(p, at, k) {
    for (; p < this.pieces.length; p++, at = 0, k = 0) {
      const piece = this.pieces[p];
      if (piece.line !== undefined) { yield { p, at: 0, k: 0, line: piece.line, style: piece.style }; continue; }
      const t = piece.text;
      for (;;) {
        let end = t.indexOf('\n', at);
        if (end < 0) end = t.length;
        const text = this.textLine(p, at, end);
        for (const [a, b] of lineSpans(text, this.cols, k)) yield { p, at, k: a, text, a, b, style: piece.style };
        if (end === t.length) break;
        at = end + 1; k = 0;
      }
    }
  }

  /** Lines a to b (all, when not given), as the views' lines: [{ text, style, dir }] each, [] for a blank line; a line of
   *  a text has its text line's direction (directionOf: the paragraph's, for the right-to-left layout), found once. */
  slice(a = 0, b = this.length) {
    a = Math.max(0, a); b = Math.min(b, this.length);
    if (a >= b) return [];
    const m = Math.min(this.marks.length - 1, Math.floor(a / STEP));
    const out = [];
    let i = m * STEP;
    for (const l of this.walk(...this.marks[m])) {
      if (i >= a) out.push(l.line !== undefined ? (l.line === '' ? [] : [seg(l.line, l.style)]) : [seg(l.text.slice(l.a, l.b), l.style, this.directionOf(l))]);
      if (++i >= b) break;
    }
    return out;
  }
}

/** A record's pieces at `cols` columns: each part's label (wrapped: a tool's name can be long), its text, and how much
 *  of it is not shown; or its JSON. */
function recordPieces(rec, json, cols) {
  const more = (n) => ({ line: fit(`... ${plural(n, 'more character', 'more characters')} not shown`, cols), style: 'dim' });
  if (json) return [{ text: visible(rec.raw.text), style: null }, ...(rec.raw.more ? [more(rec.raw.more)] : [])];
  if (!rec.reading.length) return [{ line: fit('(nothing to read in this record)', cols), style: 'dim' }];
  return rec.reading.flatMap((p, i) => [
    ...(i ? [{ line: '', style: null }] : []),
    { text: `-- ${label(p.label)} --`, style: 'head' },
    ...(p.text !== '' ? [{ text: visible(p.text), style: null }] : []),
    ...(p.more ? [more(p.more)] : []),
  ]);
}

const pages = new WeakMap();
/** The record's lines at `cols` columns (a RecordLines: its length, and slice(a, b)), its text's or its JSON's. Kept for
 *  the width drawn last only: the lines at every width a window was resized through, kept, ran Node's heap out (R.F1). */
export function recordLines(rec, json, cols) {
  let kept = pages.get(rec);
  if (!kept) { kept = { t: null, j: null }; pages.set(rec, kept); }
  const kind = json ? 'j' : 't';
  if (kept[kind]?.cols !== cols) { kept[kind] = null; kept[kind] = new RecordLines(recordPieces(rec, json, cols), cols); }
  return kept[kind];
}
export function record(state, cols, rows) {
  const v = top(state), rec = v.rec;
  const title = `ltms-reader  Record ${label(v.a ?? rec.a)}  ${v.project === null ? label(v.file) : `${label(v.project)}/${label(v.file)}`}`;
  if (v.error) return frame(state, cols, rows, { title, sub: 'this record is not shown', body: errorBody(v.error, cols), detail: `${label(v.a)}  line ${v.line} of ${label(v.file)}`, address: v.a });
  const lines = recordLines(rec, v.json, cols);
  const h = bodyHeight(rows, false);
  const t = Math.max(0, Math.min(v.top ?? 0, lines.length - h));
  const kind = [rec.type, rec.subtype].filter(Boolean).map(label).join('/') || '(no type)';
  // the place first, then whether it is the JSON: at 80 columns the end of the line can be cut, these never (R.F10)
  const sub = `lines ${num(Math.min(lines.length, t + 1))} to ${num(Math.min(lines.length, t + h))} of ${num(lines.length)}  ${v.json ? 'as JSON' : plural(rec.reading.length, 'part', 'parts')}  ${kind}${rec.channel ? `  ${label(rec.channel)}` : ''}${rec.time ? `  ${when(rec.time, state.timeZone)}` : ''}  ${plural(rec.bytes, 'byte', 'bytes')} at offset ${num(rec.offset)}`;
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
  const tw = widest(v.rows, 'tap', (r) => (r.kind === 'hit' || r.kind === 'file' ? width(label(r.ta ?? r.p)) : null), 8, 26);
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
  return frame({ ...state, input: null, note: null }, cols, rows, { title: 'ltms-reader  Keys', sub: 'q quits; any other key goes back', body, detail: '', hint: 'q or Ctrl-C quits  any other key goes back' });
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
