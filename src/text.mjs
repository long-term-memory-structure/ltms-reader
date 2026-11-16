// src/text.mjs — what of a transcript's text reaches the terminal, and how many columns it takes there.
//
// A transcript can hold escape sequences (tool output often does: colours, cursor moves, a title, OSC 52, which writes
// the clipboard). None reaches the terminal as such: every C0 and C1 control character and DEL, but the new line and the
// tab, is shown as a visible escape (ESC as ␛, the rest as \xNN), so a transcript cannot move the cursor, set the title,
// write the clipboard or leave the terminal in another mode. The new line ends a line and the tab becomes spaces (by
// the callers below); neither is written to the terminal as itself. What reorders or hides text is shown the same way
// (R.F5, decided S376), as \uXXXX or \u{XXXXX}: the bidirectional embeddings, overrides and isolates (U+202A to U+202E,
// U+2066 to U+2069), which on a terminal that lays bidirectional text out itself reorder the rest of their row, the
// reader's own words after them too; the byte order mark (U+FEFF); the line and paragraph separators (U+2028, U+2029);
// and the tag characters (U+E0000 to U+E007F). The light marks Hebrew and Arabic text use, LRM (U+200E), RLM (U+200F)
// and ALM (U+061C), are written as they are.
//
// Width, by grapheme cluster (Intl.Segmenter): a cluster takes two columns when it holds a wide or fullwidth character
// (East_Asian_Width W or F: src/width-table.mjs, generated from Unicode's EastAsianWidth.txt), when it is an emoji
// presentation sequence (an emoji and U+FE0F) or a flag (regional indicators); none when every character in it takes
// none (combining marks, niqqud and cantillation among them, and format characters); one otherwise. A line is cut by
// columns, between clusters, never inside one.
//
// Right to left (R1, decided by the measurement of S377 on three terminals): Konsole lays out a line's right-to-left runs
// itself, with a left-to-right base for the line; Alacritty and VS Code's terminal (xterm.js) draw the text in the order
// it is written. So there are two modes (displayOrder, below): "reader", in which the reader lays out each paragraph of
// a screen row itself, by the Unicode Bidirectional Algorithm (src/bidi.mjs), and writes it in visual order; and
// "terminal", in which the text is written as stored, with a right-to-left mark (RLM) at the end of each right-to-left
// paragraph, which on Konsole puts the paragraph's end punctuation where it belongs. rtlModeOf picks one by the
// terminal. A paragraph here is a segment of a row (a list's cell, the reader's own words, a line of a record, whose
// direction is its text line's); a path or a URL in it is laid out as one left-to-right unit (UAX #9 HL4).
import { AL, AN, ISO, L as LTR_CLASS, R, classOf, lineLevels, mirrorOf, paragraphLevel, resolveLevels, visualOrder } from './bidi.mjs';
import { WIDE } from './width-table.mjs';

/** C0 but the tab and the new line, DEL, C1; and what reorders or hides text: the bidirectional embeddings, overrides
 *  and isolates, the line and paragraph separators, the byte order mark, the tag characters. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/gu;

/** One such character as it is shown: ESC as ␛ (U+241B); the others of C0, DEL and C1 as \xNN; the rest as \uXXXX, or
 *  \u{XXXXX} past U+FFFF. */
function shown(c) {
  if (c === '\x1b') return '\u241b';
  const cp = c.codePointAt(0);
  if (cp <= 0xff) return `\\x${cp.toString(16).padStart(2, '0')}`;
  return cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, '0')}` : `\\u{${cp.toString(16)}}`;
}

/** s with every control character but \n and \t, and every character that reorders or hides text, as a visible
 *  escape: ESC as ␛ (U+241B), the others of C0, DEL and C1 as \xNN, the rest as \uXXXX (\u{XXXXX}). */
export function visible(s) {
  const t = typeof s === 'string' ? s : String(s);
  return t.replace(CONTROL, shown);
}

/** Whether a code point is East_Asian_Width W or F (a binary search of the generated ranges). */
export function isWide(cp) {
  if (cp < WIDE[0]) return false;
  let lo = 0, hi = WIDE.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < WIDE[2 * mid]) hi = mid - 1;
    else if (cp > WIDE[2 * mid + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}

// Characters that take no column of their own (Markus Kuhn's wcwidth rule): nonspacing and enclosing marks, format
// characters but the soft hyphen, and the Hangul medial vowels and final consonants, which join the syllable before them.
const ZERO = /^[\p{Mn}\p{Me}\p{Cf}\u1160-\u11ff\ud7b0-\ud7ff]$/u;
const EMOJI = /^\p{Emoji}$/u;
const isRegional = (cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const zeroWidth = (ch, cp) => cp !== 0x00ad && ZERO.test(ch);

/** The columns one grapheme cluster takes: 0, 1 or 2. */
export function clusterWidth(c) {
  const cp0 = c.codePointAt(0);
  if (c.length === 1 && cp0 >= 0x20 && cp0 < 0x7f) return 1;
  if (isRegional(cp0)) return 2;
  let any = false, base = null, vs16 = false;
  for (const ch of c) {
    const cp = ch.codePointAt(0);
    if (isWide(cp)) return 2;
    if (cp === 0xfe0f) { vs16 = true; continue; }
    if (!zeroWidth(ch, cp)) { any = true; base ??= ch; }
  }
  if (vs16 && base !== null && EMOJI.test(base)) return 2;
  return any ? 1 : 0;
}

const SEG = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const ASCII_AND_TABS = /^[\t\x20-\x7e]*$/;

/** The units of the slices a long text is segmented in (R4: on Node 20, each step of Intl.Segmenter's iteration costs
 *  in proportion to the length of the string it walks, so that walking one string is quadratic: 3.4 us a cluster at
 *  10,000 units, 115 at 80,000; R.F1's line of 4,000,000 Hebrew characters was not laid out in ten minutes). */
export const SLICE = 256;

/**
 * The grapheme clusters of s, in order: those Intl.Segmenter gives the whole text. A text longer than SLICE units is
 * segmented a slice at a time, from a boundary of the whole text: every cluster of a slice but its last is the whole
 * text's (a boundary depends only on the text before it, from a boundary on, and on the code point at it, and a slice
 * never ends inside a surrogate pair), and the next slice begins where that last cluster begins; a slice that holds one
 * cluster only is made twice as long until it holds two, or reaches the text's end. Without Intl.Segmenter, each code
 * point with the zero-width ones after it.
 */
export function* clusters(s) {
  if (SEG && s.length <= SLICE) { for (const { segment } of SEG.segment(s)) yield segment; return; }
  if (SEG) {
    for (let a = 0, n = SLICE; a < s.length;) {
      let e = Math.min(s.length, a + n);
      if (e < s.length && s.charCodeAt(e - 1) >= 0xd800 && s.charCodeAt(e - 1) <= 0xdbff) e++;
      if (e === s.length) { for (const { segment } of SEG.segment(a ? s.slice(a) : s)) yield segment; return; }
      let held = null, at = 0;
      for (const { segment, index } of SEG.segment(s.slice(a, e))) { if (held !== null) yield held; held = segment; at = index; }
      if (at > 0) { a += at; n = SLICE; } else n *= 2;
    }
    return;
  }
  let cur = '';
  for (const ch of s) {
    if (cur !== '' && (zeroWidth(ch, ch.codePointAt(0)) || ch === '\ufe0f')) { cur += ch; continue; }
    if (cur !== '') yield cur;
    cur = ch;
  }
  if (cur !== '') yield cur;
}

/** The columns s takes on one line (s holds no new line; its tabs are expanded). */
export function width(s) {
  if (PRINTABLE_ASCII.test(s)) return s.length;
  let w = 0;
  for (const c of clusters(s)) w += clusterWidth(c);
  return w;
}

/** The longest start of s made of whole clusters that fits in `cols` columns: { text, width, rest }. */
export function cut(s, cols) {
  if (PRINTABLE_ASCII.test(s)) { const n = Math.max(0, Math.min(s.length, cols)); return { text: s.slice(0, n), width: n, rest: s.slice(n) }; }
  let w = 0, at = 0;
  for (const c of clusters(s)) {
    const cw = clusterWidth(c);
    if (w + cw > cols) break;
    w += cw; at += c.length;
  }
  return { text: s.slice(0, at), width: w, rest: s.slice(at) };
}

/** s within `cols` columns: as it is when it fits, else cut with … at its end. */
export function fit(s, cols) {
  if (cols <= 0) return '';
  if (width(s) <= cols) return s;
  return `${cut(s, cols - 1).text}\u2026`;
}

/** s padded with spaces to `cols` columns (cut first when it is wider). */
export function pad(s, cols) {
  const r = cut(s, cols);
  return r.text + ' '.repeat(Math.max(0, cols - r.width));
}

/** Where the lines of one line of text s (no new line in it) begin and end, [start, end), when it is cut into lines of
 *  at most `cols` columns between clusters, a cluster wider than the columns on a line of its own; from offset `from`,
 *  where a cluster begins. One pair at a time, so that a long text can be laid out without its lines being made. An
 *  empty s is one empty line. */
export function* lineSpans(s, cols, from = 0) {
  const n = Math.max(1, cols);
  if (from >= s.length) { if (from === 0) yield [0, 0]; return; }
  if (PRINTABLE_ASCII.test(s)) { for (let i = from; i < s.length; i += n) yield [i, Math.min(s.length, i + n)]; return; }
  let start = from, at = from, w = 0;
  for (const c of clusters(from ? s.slice(from) : s)) {
    const cw = clusterWidth(c);
    if (w + cw > n && at > start) { yield [start, at]; start = at; w = 0; }
    at += c.length; w += cw;
  }
  yield [start, s.length];
}

/** One line (no new line in it) cut into lines of at most `cols` columns, between clusters; a cluster wider than the
 *  columns goes on a line of its own. The lines join back to s. Each line is a slice of s (a line built by adding
 *  cluster after cluster cost a string object per cluster: 28 MB for a million characters of Hebrew, R.F1). */
export function wrap(s, cols) {
  const out = [];
  for (const [a, b] of lineSpans(s, cols)) out.push(s.slice(a, b));
  return out;
}

/** The reader's own words (not a transcript's text) in lines of at most `cols` columns, broken at spaces where a
 *  line can be, else by columns. */
export function wrapWords(s, cols) {
  const out = [];
  let line = '';
  for (const word of s.split(' ')) {
    const next = line === '' ? word : `${line} ${word}`;
    if (width(next) <= cols) { line = next; continue; }
    if (line !== '') out.push(line);
    const pieces = wrap(word, cols);
    line = pieces.pop();
    for (const piece of pieces) out.push(piece);
  }
  out.push(line);
  return out;
}

/** s with each tab as spaces to the next multiple of `tab` columns, counted by width from the start of s. */
export function expandTabs(s, tab = 8) {
  if (!s.includes('\t')) return s;
  // the runs between tabs as slices of s, joined once (a tab is a cluster of its own); printable ASCII and tabs alone
  // are counted by their characters, without the segmenter
  if (ASCII_AND_TABS.test(s)) {
    const parts = [];
    let from = 0, col = 0;
    for (let i = s.indexOf('\t'); i >= 0; i = s.indexOf('\t', from)) { col += i - from; const n = tab - (col % tab); parts.push(s.slice(from, i), ' '.repeat(n)); col += n; from = i + 1; }
    parts.push(s.slice(from));
    return parts.join('');
  }
  const parts = [];
  let from = 0, at = 0, col = 0;
  for (const c of clusters(s)) {
    if (c === '\t') { const n = tab - (col % tab); parts.push(s.slice(from, at), ' '.repeat(n)); col += n; at += 1; from = at; continue; }
    at += c.length; col += clusterWidth(c);
  }
  parts.push(s.slice(from));
  return parts.join('');
}

/** The right-to-left modes there are: "reader" (the reader lays each paragraph out) and "terminal" (as stored). */
export const RTL_MODES = Object.freeze(['reader', 'terminal']);

/**
 * The right-to-left mode, by the terminal (R1): LTMS_READER_BIDI when it is set ("terminal" or "reader"); else
 * "terminal" in Konsole (KONSOLE_VERSION set), which lays bidirectional text out itself; else "reader". Measured on
 * Konsole 26.08.3, Alacritty 0.17.0 and VS Code 1.146.0's terminal (xterm.js), S377; no other terminal was. Returns
 * { mode, by } or { refused: why }.
 */
export function rtlModeOf(env) {
  const v = env.LTMS_READER_BIDI;
  if (typeof v === 'string' && v !== '') {
    if (!RTL_MODES.includes(v)) return { refused: `LTMS_READER_BIDI is ${JSON.stringify(v)}: it takes "reader" (the reader lays right-to-left text out) or "terminal" (the text as stored, for a terminal that lays it out itself, as Konsole does)` };
    return { mode: v, by: 'LTMS_READER_BIDI' };
  }
  if (typeof env.KONSOLE_VERSION === 'string' && env.KONSOLE_VERSION !== '') return { mode: 'terminal', by: 'KONSOLE_VERSION' };
  return { mode: 'reader', by: 'default' };
}

/** A text with no character that could be right to left (every R, AL and AN code point is at U+0590 or above). */
const NO_RTL = /^[\u0000-֏]*$/;
const RLM = '‏';

// A path or a URL (R1, UAX #9 HL4): a URL (a scheme and ://); a path from the root, the home folder or here (/, ~/, ./,
// ../) or a drive (C:\ or C:/); or a relative path whose first part is ASCII (src/, docs/: a first part that is not, as
// in the Hebrew ו/או, "and/or", is not taken for one). It begins at the text's start or after a space, an opening
// bracket or quote, = or a hyphen, and ends at the next space; the punctuation that ends a sentence, and a closing
// bracket or quote it does not open, are not part of it.
const UNIT = /(?<=^|[\s([{<"'=\-־])(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s]+|(?:~|\.{1,2})?\/[^\s]+|[A-Za-z]:[\\/][^\s]*|[\w.@+-]+\/[^\s]*)/gu;
const CLOSERS = { ')': '(', ']': '[', '}': '{', '>': '<' };

/** The paths and URLs in a text, as [start, end) pairs. */
export function pathUnits(text) {
  if (!text.includes('/') && !text.includes('\\')) return [];
  const out = [];
  for (const m of text.matchAll(UNIT)) {
    let a = m.index, b = a + m[0].length;
    for (;;) {
      const c = text[b - 1];
      if ('.,;:!?…"\''.includes(c)) { b--; continue; }
      const o = CLOSERS[c];
      if (o) { const u = text.slice(a, b); if (u.split(c).length > u.split(o).length) { b--; continue; } }
      break;
    }
    if (b - a > 1) out.push([a, b]);
  }
  return out;
}

/** A path or a URL laid out on its own, left to right, its separators strong (HL2), so that its parts keep their order
 *  and a right-to-left name in it reads right. */
function unitVisual(text) {
  const cs = [...clusters(text)];
  const cps = [], classes = [], first = [];
  for (const c of cs) {
    first.push(cps.length);
    for (const ch of c) { const cp = ch.codePointAt(0); cps.push(cp); classes.push(cp === 0x2f || cp === 0x5c ? LTR_CLASS : classOf(cp)); }
  }
  return arrange(cs, null, cps, classes, first, 0);
}

/** The clusters (and units) of a line in visual order, from their code points' levels: a cluster takes the level of its
 *  first character X9 kept (one X9 removed whole takes the level of the cluster before it); one at an odd level is
 *  drawn with its first character's mirrored glyph (L4). */
function arrange(cs, units, cps, classes, first, level) {
  const levels = resolveLevels(cps, classes, level);
  lineLevels(classes, levels, level);
  const n = cs.length, at = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const end = i + 1 < n ? first[i + 1] : cps.length;
    let v = -1;
    for (let k = first[i]; k < end && v < 0; k++) v = levels[k];
    at[i] = v >= 0 ? v : i ? at[i - 1] : level;
  }
  let out = '';
  for (const i of visualOrder(at)) {
    if (units?.[i] !== undefined) { out += units[i]; continue; }
    const c = cs[i];
    if (at[i] & 1) { const cp = c.codePointAt(0), m = mirrorOf(cp); out += m === cp ? c : String.fromCodePoint(m) + c.slice(cp > 0xffff ? 2 : 1); }
    else out += c;
  }
  return out;
}

/** The paragraph's level of a text (P2, P3: 1 when its first strong character, a path or a URL passed over, is right to
 *  left; else 0). */
export function directionOf(text) {
  if (NO_RTL.test(text)) return 0;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i), c = classOf(cp);
    if (c === LTR_CLASS || c === R || c === AL) {
      const end = unitEndAt(text, i);
      if (end < 0) return c === LTR_CLASS ? 0 : 1;
      i = end;
      continue;
    }
    i += cp > 0xffff ? 2 : 1;
  }
  return 0;
}

/** Where the path or URL that holds offset i ends, or -1 when none does: looked for in the run of characters that are
 *  not spaces around i (a unit begins at such a run's start or inside it, and ends at its end or before). */
function unitEndAt(text, i) {
  let a = i, b = i;
  while (a > 0 && !/\s/.test(text[a - 1])) a--;
  while (b < text.length && !/\s/.test(text[b])) b++;
  const run = text.slice(a, b);
  if (!run.includes('/') && !run.includes('\\')) return -1;
  for (const [x, y] of pathUnits(run)) if (a + x <= i && i < a + y) return a + y;
  return -1;
}

/**
 * One line of a paragraph (logical order, cut to its columns, visible, its tabs as spaces) in visual order, as a
 * terminal that draws text in the order it is written must get it: UAX #9 over its code points, at the paragraph's
 * level (`level`, or the line's own by P2 and P3 when null), then L1 and L2 over its grapheme clusters, each kept whole
 * and in its own order (a mark after its letter, as a terminal draws it: L3), each at an odd level mirrored (L4). With
 * `units`, each path or URL is laid out on its own, left to right, and stands in the line as one isolate (HL4).
 */
export function visualLine(text, level = null, { units = true } = {}) {
  if (text === '' || (level !== 1 && NO_RTL.test(text))) return text;
  const spans = units ? pathUnits(text) : [];
  const cs = [], cps = [], classes = [], first = [], laid = [];
  let u = 0, any = false;
  for (let i = 0; i < text.length;) {
    if (u < spans.length && i === spans[u][0]) {
      const [a, b] = spans[u++];
      laid[cs.length] = unitVisual(text.slice(a, b));
      first.push(cps.length); cs.push(text.slice(a, b)); cps.push(0xfffc); classes.push(ISO);
      i = b; continue;
    }
    const end = u < spans.length ? spans[u][0] : text.length;
    for (const c of clusters(text.slice(i, end))) {
      first.push(cps.length); cs.push(c);
      for (const ch of c) { const cp = ch.codePointAt(0), k = classOf(cp); cps.push(cp); classes.push(k); if (k === R || k === AL || k === AN) any = true; }
    }
    i = end;
  }
  const p = level ?? paragraphLevel(classes);
  if (!any && p === 0) return spans.length ? cs.map((c, i) => laid[i] ?? c).join('') : text;
  return arrange(cs, laid, cps, classes, first, p);
}

/**
 * One screen row's segments ([{ text, style, dir }], already cut to the row's width) as they are written, in `mode`.
 * Each segment is a paragraph: its direction is `dir` when given (0 or 1: a line of a record, whose paragraph is its
 * text line), else its own (P2, P3). Its spaces at either end stay where they are (the columns stay; the text is
 * aligned left). "reader": the rest laid out by visualLine. "terminal": as stored, with an RLM after a right-to-left
 * paragraph's text, so that a terminal that lays the line out with a left-to-right base (Konsole) puts the paragraph's
 * end punctuation at its left (measured on Konsole 26.08.3; a mark at the row's first column it drops).
 */
export function displayOrder(row, mode = 'reader') {
  if (mode !== 'reader' && mode !== 'terminal') throw new RangeError(`no right-to-left mode ${JSON.stringify(mode)}: the modes are "reader" and "terminal"`);
  let out = null;
  for (let i = 0; i < row.length; i++) {
    const s = row[i], text = s.text;
    if (s.dir !== 1 && NO_RTL.test(text)) continue;
    const a = text.length - text.trimStart().length, b = text.trimEnd().length;
    if (a >= b) continue;
    const core = text.slice(a, b), dir = s.dir ?? directionOf(core);
    const shown = mode === 'reader' ? visualLine(core, dir) : dir === 1 ? `${core}${RLM}` : core;
    if (shown === core) continue;
    out ??= row.slice();
    out[i] = { ...s, text: text.slice(0, a) + shown + text.slice(b) };
  }
  return out ?? row;
}

/** Parts of one paragraph each (a cell's own words, then a transcript's text) within `cols` columns: as they are when
 *  they fit, else cut in logical order, between clusters of the whole, with … at the end of the last part shown. */
export function fitParts(parts, cols) {
  if (cols <= 0) return [];
  const whole = parts.join('');
  if (width(whole) <= cols) return parts;
  const kept = cut(whole, cols - 1).text.length, out = [];
  let at = 0;
  for (const p of parts) {
    if (at + p.length <= kept) { out.push(p); at += p.length; continue; }
    out.push(`${p.slice(0, kept - at)}…`);
    break;
  }
  return out;
}
