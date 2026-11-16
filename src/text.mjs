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
// Right to left: the text is written in the order it is stored, and the terminal lays it out (mode "terminal"). The one
// place a "reader" mode would go, laying out each screen line by the Unicode Bidirectional Algorithm (UAX #9) for
// terminals that do not, is displayOrder() below; whether it is needed is decided by a measurement on the screen.
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

/** The right-to-left modes there are. */
export const RTL_MODES = Object.freeze(['terminal']);

/**
 * The order in which one screen row's segments ([{ text, style }], already cut to the row's width) are written.
 * "terminal": as stored; the terminal lays the text out (Konsole lays out bidirectional text itself; Alacritty, kitty
 * and VS Code's terminal show the stored order). A "reader" mode would reorder the row here, by UAX #9, for terminals
 * that do not; it is not built, because a measurement on the screens decides whether it is needed.
 */
export function displayOrder(row, mode = 'terminal') {
  if (mode === 'terminal') return row;
  throw new RangeError(`no right-to-left mode ${JSON.stringify(mode)}: the one mode is "terminal" (the text as written)`);
}
