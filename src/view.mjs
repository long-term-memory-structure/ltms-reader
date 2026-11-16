// src/view.mjs — what the page shows of one transcript, built on ltms's library (long-term-memory-structure, written
// against 0.2.0; #ltms, which the host package maps: ltms-reader to its dependency, the extension to its vendor/ltms): its
// turns with their tool calls, replies and compactions, the record at any line, and the text around a search match.
// Pure functions over a transcript's text or its parse: no I/O, no Node imports.
//
// The turns and calls are the ones `ltms skeleton` prints, by the same recipe (cli.ts skeletonOf): turnsOf over the
// repaired live path, addresses <prefix>:L<line>, turn ids <prefix>:T<nnn>. What ltms never prints, the text, is shown
// here, because the person reading is the one whose transcripts these are, on their own machine.
import { blocksOf, indexTranscript, inputChannel, parseTranscript, repairedLivePath, turnsOf } from '#ltms';

/** How much text each item carries to the page before the reader asks for the whole record. */
export const LIMITS = Object.freeze({ prompt: 1200, reply: 600, input: 400, result: 400, note: 300 });
/** At most this many items of one turn, and of a whole session, go to the page at once (a session of 20,000 tool calls
 *  was a 12.4 MB reply and 220,000 elements); the rest of a turn comes when the reader asks for it (turnItems). */
export const CAPS = Object.freeze({ turnItems: 200, sessionItems: 5000, oneTurn: 2000 });

/** ltms's address prefix (cli.ts prefixOf): the file name's first 8 characters; agent-<id>.jsonl gives agent- and the
 *  id's first 8, since those names all start alike. */
export const prefixOf = (name) => (name.startsWith('agent-') ? `agent-${name.slice(6, 14)}` : name.slice(0, 8));

/** Content as one string, as ltms reads it (cli.ts flat): a string as it is; an array as its text blocks and bare
 *  strings, joined by new lines; anything else as ''. */
export const flat = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : '')).join('\n') : '');

const GRAPHEMES = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** Whether the code point that ends at p, and the printable ASCII character at p, are two grapheme clusters: they are
 *  unless the first is a Prepend character (UAX #29, GB9b, the one rule that joins anything to a printable ASCII
 *  character after it), and ICU, asked of the two alone, knows which are; there is none below U+0600. */
function splitsBefore(s, p) {
  const b = s.charCodeAt(p - 1);
  if (b < 0x0600) return true;
  const from = b >= 0xdc00 && b <= 0xdfff && p >= 2 && s.charCodeAt(p - 2) >= 0xd800 && s.charCodeAt(p - 2) <= 0xdbff ? p - 2 : p - 1;
  let n = 0;
  for (const _ of GRAPHEMES.segment(s.slice(from, p + 1))) n++;
  return n === 2;
}

/** A grapheme cluster boundary at or before k, found by the characters around it: after a line feed (GB4), or before a
 *  printable ASCII character that does not join what is before it (splitsBefore); else the text's start. The rules that
 *  look back over characters (GB9c, GB11, GB12, GB13) stop at a printable ASCII character and at a line feed, so that
 *  the text segmented from such a place has the boundaries after it that the whole text has (N4; both places measured
 *  with ICU 78 over every code point). */
function boundaryAtOrBefore(s, k) {
  for (let p = k; p > 0; p--) {
    if (s.charCodeAt(p - 1) === 0x0a) return p;
    const c = s.charCodeAt(p);
    if (c >= 0x20 && c <= 0x7e && splitsBefore(s, p)) return p;
  }
  return 0;
}

/** At most n UTF-16 units of s, cut at the last grapheme cluster boundary at or before n (R.F4: a cut by units alone
 *  left a pointed letter without some of its marks, and the page and the screen drew it so), and how many units were
 *  left out. The boundaries are those of the whole text: it is segmented from a boundary found at or before n by the
 *  characters around it (boundaryAtOrBefore), the start of a line or a word as a rule, else from its start (N4: the 512
 *  units before n, segmented as if they began a text, cut inside any cluster longer than that, and inside an emoji
 *  sequence, an Indic conjunct or a run of regional indicators that began before them; segmenting every text from its
 *  start made opening R's 14 MB record 1.6 s, from 60 ms). Without Intl.Segmenter, never inside a surrogate pair. */
export function clip(s, n) {
  if (typeof s !== 'string') return { text: '', more: 0 };
  if (s.length <= n) return { text: s, more: 0 };
  let k = Math.max(0, n);
  if (GRAPHEMES) {
    const from = boundaryAtOrBefore(s, k);
    let last = from;
    for (const { index } of GRAPHEMES.segment(s.slice(from, k + 16))) { if (from + index > k) break; last = from + index; }
    k = last;
  } else {
    const c = s.charCodeAt(k - 1);
    if (c >= 0xd800 && c <= 0xdbff) k--;
  }
  return { text: s.slice(0, k), more: s.length - k };
}

const str = (v) => (typeof v === 'string' ? v : undefined);
/** The least and the most of a list of numbers, by a loop: a turn's lines can be more than a call takes arguments. */
const least = (xs) => xs.reduce((m, x) => (x < m ? x : m), Infinity);
const most = (xs) => xs.reduce((m, x) => (x > m ? x : m), -Infinity);

/** A command typed in Claude Code (A.F18): the harness writes it into the prompt's text as markup,
 *  <command-name>/compact</command-name> with <command-args>; its name and arguments, or null for any other text. */
export function commandOf(text) {
  const m = /<command-name>([^<]{1,200})<\/command-name>/.exec(typeof text === 'string' ? text : '');
  if (!m) return null;
  const a = /<command-args>([^<]*)<\/command-args>/.exec(text);
  return { name: m[1].trim(), args: clip((a?.[1] ?? '').trim(), 400).text };
}
/** v as JSON ('' for undefined), indented by `space`; "(too large to write out)" when it cannot be written. A value whose
 *  indented JSON would pass JavaScript's limit on a string's length is measured first (jsonSize) and never handed to
 *  JSON.stringify, which on Node 20 held some 800 MB before the heap ran out (N3; Node 26 threw at once). Without an
 *  indent, JSON is no longer than the line the value was read from. */
const json = (v, space) => {
  if (space && jsonSize(v, space).units > STRING_MAX_UNITS) return '(too large to write out)';
  try { return JSON.stringify(v, null, space) ?? ''; } catch { return '(too large to write out)'; }
};

/** The input field a person looks at first, by tool: the command, the file, the pattern, the address, the task. */
const INPUT_KEYS = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'skill', 'description', 'prompt', 'subagent_type'];
export function inputShown(input) {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    for (const k of INPUT_KEYS) if (typeof input[k] === 'string' && input[k] !== '') return { key: k, ...clip(input[k], LIMITS.input) };
  }
  return { key: null, ...clip(input === undefined ? '' : json(input), LIMITS.input) };
}

const isBoundary = (r) => r?.type === 'system' && r.subtype === 'compact_boundary';
/** A record's text blocks, joined: what a person reads as the assistant's reply. */
const replyText = (r) => blocksOf(r?.message).filter((b) => b.type === 'text' && typeof b.text === 'string' && b.text !== '').map((b) => b.text).join('\n');

// One map per parse: a line number → the index of the first record written on it.
const lineMaps = new WeakMap();
export function recordIndexAt(t, line) {
  let m = lineMaps.get(t);
  if (!m) { m = new Map(); t.positions.forEach((p, i) => { if (!m.has(p.line)) m.set(p.line, i); }); lineMaps.set(t, m); }
  return m.get(line);
}

/**
 * One session as the page shows it. `name` is the file's name (its prefix is ltms's).
 * Each turn: its id and address, its channel, its time, its prompt (clipped), and its items in the order they were
 * written in the file (by line): the tool calls (each with its input, whether it succeeded, its result's address and
 * the start of its result), the replies, the compactions with their summaries, and the harness's own records (notes).
 */
export function sessionView(input, { name, caps = true }) {
  const t = typeof input === 'string' ? parseTranscript(input) : input;
  const pre = prefixOf(name);
  const lineOf = (n) => t.positions[n.index].line;
  const at = (n) => `${pre}:L${lineOf(n)}`;
  const rp = repairedLivePath(t);
  const turns = turnsOf(t, rp.path);
  const index = indexTranscript(t, { prefix: pre });
  // A path record as the page shows it: a compaction (with what its record says of it), its summary, a reply, an API
  // error, or one of the harness's own notes; null for the records shown with their calls (tool results) and the rest.
  const itemOf = (node) => {
    const r = node.record;
    if (isBoundary(r)) {
      const m = r.compactMetadata ?? {}, kept = Array.isArray(m.preservedMessages?.uuids) ? m.preservedMessages.uuids : [];
      return { kind: 'compaction', a: at(node), line: lineOf(node), time: str(r.timestamp) ?? null, trigger: str(m.trigger) ?? null,
        pre: Number.isFinite(m.preTokens) ? m.preTokens : null, post: Number.isFinite(m.postTokens) ? m.postTokens : null,
        kept: kept.map((u) => (typeof u === 'string' ? t.nodes.get(u) : undefined)).filter(Boolean).map((n) => ({ a: at(n), line: lineOf(n) })) };
    }
    if (r?.type === 'assistant') {
      if (r.isApiErrorMessage === true) return { kind: 'note', sub: 'api-error', a: at(node), line: lineOf(node), ...clip(replyText(r), LIMITS.note), time: str(r.timestamp) ?? null };
      const rt = replyText(r);
      return rt !== '' ? { kind: 'reply', a: at(node), line: lineOf(node), ...clip(rt, LIMITS.reply), time: str(r.timestamp) ?? null } : null;
    }
    if (r?.type === 'user') {
      const ch = inputChannel(r);
      if (ch === 'harness:compact-summary') return { kind: 'summary', a: at(node), line: lineOf(node), ...clip(flat(r.message?.content), LIMITS.note), time: str(r.timestamp) ?? null };
      if (ch !== undefined && ch.startsWith('harness:')) { const nt = flat(r.message?.content); return { kind: 'note', sub: ch.slice(8), a: at(node), line: lineOf(node), ...clip(nt, LIMITS.note), command: commandOf(nt), time: str(r.timestamp) ?? null }; }
    }
    return null;
  };
  // the path's records before the first prompt (a session that begins with a compaction, say): shown as a lead-in, as
  // ltms search gives them to the first turn
  const first = turns.length ? rp.path.indexOf(turns[0].prompt) : -1;
  const lead = first > 0 ? rp.path.slice(0, first).map(itemOf).filter(Boolean).slice(0, CAPS.turnItems) : [];
  const out = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i], p = turn.prompt, pr = p.record;
    const ta = `${pre}:T${String(i + 1).padStart(3, '0')}`;
    const text = flat(pr?.message?.content);
    const items = [];
    for (const c of turn.toolCalls) {
      const answered = c.resultBlock !== undefined, rt = answered ? flat(c.resultBlock?.content) : null;
      items.push({
        kind: 'call', a: at(c.callNode), line: lineOf(c.callNode), tool: str(c.name) ?? '(no name)', input: inputShown(c.input),
        ok: answered ? !c.isError : null, r: c.resultNode ? at(c.resultNode) : null, rline: c.resultNode ? lineOf(c.resultNode) : null,
        n: answered ? rt.length : null, result: answered ? clip(rt, LIMITS.result) : null, time: str(c.callNode.record?.timestamp) ?? null,
      });
    }
    for (const node of turn.records) { const x = itemOf(node); if (x) items.push(x); }
    items.sort((x, y) => x.line - y.line);
    // counted before any cap, so the page's counts and its failed-only filter see every call; and the turn's lines, so an
    // address can be found in a turn whose items were cut, or which is not drawn yet
    const calls = items.filter((x) => x.kind === 'call'), lines = [lineOf(p), ...items.flatMap((x) => (x.rline ? [x.line, x.rline] : [x.line])), ...turn.records.map(lineOf)];
    out.push({ ta, a: at(p), line: lineOf(p), ch: inputChannel(pr) || 'none', time: str(pr?.timestamp) ?? null, n: text.length, prompt: clip(text, LIMITS.prompt), command: commandOf(text), records: 1 + turn.records.length,
      calls: calls.length, failed: calls.filter((x) => x.ok === false).length, from: least(lines), to: most(lines), items });
  }
  // A compaction made by /compact (S365, A.F5): Claude Code writes the boundary and its summary first, then the
  // command's own records with the command's earlier time, so the /compact opens the turn after the one that holds its
  // compaction (measured: the demo's dc532898, L128 at 00:57:02, its /compact at L131, 00:56:23). Where ltms's turns put
  // the compaction inside the /compact's own turn (its fixtures library-detached*.jsonl), no note is made. Nothing is
  // moved; each says which made which. An automatic compaction has no command.
  const COMPACT = /<command-name>\/compact<\/command-name>/;
  const held = [...lead.map((x) => [x, -1]), ...out.flatMap((tu, i) => tu.items.filter((x) => x.kind === 'compaction').map((x) => [x, i]))];
  for (const [x, i] of held) {
    const next = out[i + 1];
    if (x.trigger === 'auto' || !next || !COMPACT.test(next.prompt?.text ?? '')) continue;
    if (x.time && next.time && next.time > x.time) continue;   // a /compact typed after the compaction did not make it
    x.by = { ta: next.ta, a: next.a, line: next.line, time: next.time };
    (next.made ??= []).push({ a: x.a, line: x.line, time: x.time, lead: i === -1 });
  }
  const s = t.stats;
  return {
    name, prefix: pre, fileKind: t.fileKind,
    stats: { lines: s.lines, parsed: s.parsed, unparseable: s.unparseable, first: s.firstTimestamp, last: s.lastTimestamp, versions: Object.keys(s.versions).slice(-3), outputTokens: s.totalOutputTokens },
    problems: { count: t.problems.length, first: t.problems.slice(0, 20).map((q) => ({ line: q.line, reason: q.reason })) },
    path: { from: rp.from, nodes: rp.path.length, bridges: rp.bridges.length, splices: rp.splices.length, compactions: rp.compactions.length },
    index: { turns: index.turns, calls: index.calls, failures: index.failures, compactions: index.compactions, firstPrompt: index.firstPrompt, lastPrompt: index.lastPrompt, lastReply: index.lastReply },
    lead, turns: caps ? capped(out) : out,
  };
}

/** The turns with their items cut to CAPS: each turn keeps its first items, and says how many it left out. */
function capped(turns) {
  let budget = CAPS.sessionItems;
  for (const t of turns) {
    const keep = Math.max(0, Math.min(t.items.length, CAPS.turnItems, budget));
    t.itemsMore = t.items.length - keep;
    if (t.itemsMore) t.items = t.items.slice(0, keep);
    budget -= keep;
  }
  return turns;
}

/** Every item of one turn (up to CAPS.oneTurn), for a turn whose items the session view cut; null when there is no
 *  such turn. */
export function turnItems(input, { name, ta }) {
  const turn = sessionView(input, { name, caps: false }).turns.find((t) => t.ta === ta);
  return turn ? { items: turn.items.slice(0, CAPS.oneTurn), total: turn.items.length } : null;
}

/** The parts of a record a person reads, before any is written out: its text blocks, thinking, tool calls (their input
 *  as JSON), tool results, a system record's content, an attachment. Each is { kind, label, text }, or, for a part shown
 *  as JSON, { kind, label, json: the value, indent }: readingOf writes it, recordViewBytes measures it. */
export function partsOf(r) {
  const parts = [];
  const add = (kind, label, text) => parts.push({ kind, label, text });
  const asJson = (kind, label, value) => parts.push({ kind, label, json: value, indent: 2 });
  if (r?.type === 'user' || r?.type === 'assistant') {
    for (const b of blocksOf(r.message)) {
      if (b.type === 'text') add('text', 'text', str(b.text) ?? '');
      else if (b.type === 'thinking') add('thinking', 'thinking', str(b.thinking) ?? '');
      else if (b.type === 'redacted_thinking') add('thinking', 'thinking (redacted)', '');
      else if (b.type === 'tool_use') asJson('tool_use', `tool call: ${str(b.name) ?? '(no name)'}`, b.input ?? {});
      else if (b.type === 'tool_result') add('tool_result', b.is_error === true ? 'tool result (error)' : 'tool result', Array.isArray(b.content) ? b.content.map((x) => (typeof x?.text === 'string' ? x.text : x?.type === 'image' ? '[image]' : '')).join('\n') : flat(b.content));
      else if (b.type === 'image') add('image', `image (${str(b.source?.media_type) ?? 'unknown type'})`, '');
      else asJson('other', `block: ${str(b.type) ?? '(no type)'}`, b);
    }
    if (r.type === 'user' && r.toolUseResult !== undefined) {
      if (typeof r.toolUseResult === 'string') add('structured', 'tool result, structured', r.toolUseResult);
      else asJson('structured', 'tool result, structured', r.toolUseResult);
    }
  } else if (r?.type === 'system') {
    if (typeof r.content === 'string') add('system', `system: ${str(r.subtype) ?? '(no subtype)'}`, r.content);
    else asJson('system', `system: ${str(r.subtype) ?? '(no subtype)'}`, r);
  } else if (r?.type === 'attachment') {
    asJson('attachment', `attachment: ${str(r.attachment?.type) ?? '(no type)'}`, r.attachment);
  } else {
    asJson('other', `record: ${str(r?.type) ?? '(no type)'}`, r);
  }
  return parts;
}

/** The parts of a record a person reads (partsOf), each written out and clipped at `perPart` units. */
export function readingOf(r, perPart) {
  return partsOf(r).map((p) => ({ kind: p.kind, label: p.label, ...clip(p.json !== undefined ? json(p.json, p.indent) : p.text, perPart) }));
}

/** JavaScript's limit on a string's length (V8 on 64 bits, Node 20 to 26: 2^29 - 24 units): JSON.stringify of a value
 *  longer than that throws, and view.mjs's json() writes "(too large to write out)" in its place. */
export const STRING_MAX_UNITS = 2 ** 29 - 24;

/**
 * The length of JSON.stringify(v, null, indent), in UTF-16 units, and whether it holds a character past U+00FF (V8 then
 * keeps the string at two bytes a unit), found by walking v: no string is built. For values JSON.parse gives (undefined
 * as json() writes it, ''). A string is measured as JSON.stringify escapes it: " and \ and the controls \b \f \n \r
 * \t as two units, the other controls and a lone surrogate as six. Checked against JSON.stringify over every record of
 * the fixtures (test/record-view.test.mjs).
 */
export function jsonSize(v, indent) {
  let units = 0, wide = false;
  const text = (s) => {
    let n = 2;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0x22 || c === 0x5c) n += 2;
      else if (c < 0x20) n += c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6;
      else if (c >= 0xd800 && c <= 0xdfff) {
        const next = s.charCodeAt(i + 1);
        if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) { n += 2; i++; wide = true; } else n += 6;
      } else { n += 1; if (c > 0xff) wide = true; }
    }
    return n;
  };
  const leaf = (x) => (x === null ? 4 : typeof x === 'string' ? text(x) : typeof x === 'number' ? (Number.isFinite(x) ? String(x).length : 4) : typeof x === 'boolean' ? (x ? 4 : 5) : -1);
  // the arrays and objects still to measure, and their depths: a stack, not recursion, and only containers on it
  const values = [v], depths = [0];
  if (v === undefined) return { units: 0, wide: false };
  while (values.length) {
    const x = values.pop(), d = depths.pop();
    const l = leaf(x);
    if (l >= 0) { units += l; continue; }
    const keys = Array.isArray(x) ? null : Object.keys(x), n = keys ? keys.length : x.length;
    if (n === 0) { units += 2; continue; }
    // the brackets; each member after a new line and indent * (d + 1) spaces, an object's after its key and ": "; commas
    // between; a new line and indent * d spaces before the closing bracket
    units += n * (1 + indent * (d + 1) + (keys ? 2 : 0)) + (n - 1) + 3 + indent * d;
    for (let i = 0; i < n; i++) {
      const y = keys ? x[keys[i]] : x[i];
      if (keys) units += text(keys[i]);
      const m = leaf(y);
      if (m >= 0) units += m;
      else { values.push(y); depths.push(d + 1); }
    }
  }
  return { units, wide };
}

/**
 * What recordView writes of the record on `line` (null when no record was parsed on it), in bytes, measured by walking
 * it (jsonSize): the record as JSON (indent 1) and each part shown as JSON (indent 2), whole, before they are clipped;
 * each at one byte a unit, two when it holds a character past U+00FF, as V8 keeps a string; one longer than
 * STRING_MAX_UNITS is never written (json() measures it first, and does not hand it to JSON.stringify) and counts
 * nothing. N3: JSON is
 * indented once more at each level a value is nested in, so that a list nested 990 deep, on a line of 0.8 MB, is written
 * as 399,389,570 units.
 */
export function recordViewBytes(t, line) {
  const i = recordIndexAt(t, line);
  if (i === undefined) return null;
  const r = t.records[i];
  const bytes = (v, indent) => { const s = jsonSize(v, indent); return s.units > STRING_MAX_UNITS ? 0 : s.units * (s.wide ? 2 : 1); };
  let n = bytes(r, 1);
  for (const p of partsOf(r)) if (p.json !== undefined) n += bytes(p.json, p.indent);
  return n;
}

/** The record written on `line`: its address, where it sits in the file, what kind of record it is, its reading, and the
 *  record itself as JSON. `whole` lifts the clipping (still bounded). null when no record was parsed on that line. */
export function recordView(t, line, { name, whole = false }) {
  const i = recordIndexAt(t, line);
  if (i === undefined) return null;
  const r = t.records[i], pos = t.positions[i];
  const perPart = whole ? 4_000_000 : 20_000, rawMax = whole ? 8_000_000 : 200_000;
  return {
    a: `${prefixOf(name)}:L${line}`, line, offset: pos.offset, bytes: pos.bytes,
    type: str(r?.type) ?? null, subtype: str(r?.subtype) ?? null, time: str(r?.timestamp) ?? null, uuid: str(r?.uuid) ?? null,
    channel: r?.type === 'user' ? inputChannel(r) ?? null : null, whole,
    reading: readingOf(r, perPart), raw: clip(json(r, 1), rawMax),
  };
}

/** The text around a search match, by ltms's recipe (README, "Reading a hit"): follow `field` from the record, and take
 *  `width` units around offset `at`. Where `field` holds "(withheld)", the keys at that place whose value leads, along
 *  the rest of `field`, to a string longer than `at`. */
export function fieldWindow(r, field, at, width = 600) {
  if (!Array.isArray(field) || !Number.isSafeInteger(at) || at < 0) return { error: 'not a hit field' };
  const keys = (v) => (v !== null && typeof v === 'object' ? Object.keys(v) : []);
  const leads = (v, i) => (i < field.length ? (field[i] === '(withheld)' ? keys(v).some((x) => leads(v[x], i + 1)) : leads(v?.[field[i]], i + 1)) : typeof v === 'string' && v.length > at);
  let v = r;
  for (let i = 0; i < field.length; i++) {
    if (field[i] === '(withheld)') return { keys: keys(v).filter((x) => leads(v[x], i + 1)) };
    v = v?.[field[i]];
  }
  if (typeof v !== 'string') return { error: 'not a string here' };
  if (at >= v.length) return { error: 'at is past the end of this field' };
  const half = Math.floor(width / 2), start = Math.max(0, at - half), end = Math.min(v.length, at + half);
  return { text: v.slice(start, end), start, at, length: v.length };
}
