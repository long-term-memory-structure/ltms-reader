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
// columns, between clusters, never inside one; a space where it is cut stays at the end of the line before (lineSpans:
// V7, round 5, as UAX #14 has it).
//
// Right to left (R1, decided by the measurement of S377 on three terminals; Y1, round 6, by that of S378 on four): there
// are two modes (displayOrder, below): "reader", the default in every terminal, in which the reader lays the text out
// itself, by the Unicode Bidirectional Algorithm (src/bidi.mjs), and writes it in visual order (src/screen.mjs writes a
// row of it that holds right-to-left text inside a left-to-right override, so that a terminal that lays text out itself,
// as Konsole does, keeps that order); and "terminal", LTMS_READER_BIDI's choice, in which the text is written as stored,
// with a right-to-left mark (RLM) at the end of each right-to-left paragraph, which on Konsole puts the paragraph's end
// punctuation where it belongs. rtlModeOf reads the choice; no terminal is detected. A paragraph here is a
// segment of a row (a list's cell, the reader's own words before it, a line cut to the row's width), or a text a view
// wraps into lines (a record's text line, a message, an error, the reader's own words), each line of which names it: its
// levels are resolved once, and each line is reordered from them, whole (W1, round 4; V7, round 5; UAX #9 section 3.4:
// paragraphLine). A path or a URL in a paragraph is laid out as one left-to-right unit (UAX #9 HL4).
import { AL, AN, BN, ISO, L as LTR_CLASS, NSM, R, classOf, classesOf, lineLevels, mirrorOf, paragraphLevel, resolveLevels, visualOrder } from './bidi.mjs';
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

/** Whitespace that hangs at the end of a line (V7, round 5): a cluster made only of the spaces of UAX #9's class WS that
 *  take a column (U+0020, U+1680, U+2000 to U+200A, U+205F, U+3000: DerivedBidiClass.txt 17.0.0; the form feed and
 *  U+2028, of the class too, are shown as escapes), but U+2007 FIGURE SPACE, a no-break space (isGlue: Z2, round 7).
 *  UAX #14 keeps a space on the line it follows (LB7, LB18) and does not break before the others but after a space
 *  (LB12a, LB21); L1 gives those that end a line the paragraph's level. */
const HANGS = /^[\u0020\u1680\u2000-\u2006\u2008-\u200a\u205f\u3000]+$/;

/** Whether the code unit g begins a cluster that UAX #14 gives no break before but after a space, a character of class
 *  BA or a hyphen (LB12a, class GL: LineBreak.txt; ICU 78.3, Unicode 17.0, measured): a no-break space (U+00A0, U+2007
 *  FIGURE SPACE, U+202F) or the non-breaking hyphen (U+2011). Z2, round 7: U+2007, UAX #9 whitespace, hung at a break
 *  as a space does, so that a line began with the GL character after it, or with U+2007 itself. */
const isGlue = (g) => g === 0xa0 || g === 0x2007 || g === 0x202f || g === 0x2011;
/** Whether UAX #14 breaks before a GL character after the code unit g (LB12a): a space (SP), a hyphen-minus (HY), a
 *  space of class BA (U+1680, U+2000 to U+2006, U+2008 to U+200A, U+205F, U+3000); a hyphen-minus but after a Hebrew
 *  letter (breaksBeforeGlueAt). */
const breaksBeforeGlue = (g) => g === 0x20 || g === 0x2d || g === 0x1680 || (g >= 0x2000 && g <= 0x200a && g !== 0x2007) || g === 0x205f || g === 0x3000;

/** Whether a code point is a Hebrew letter, UAX #14's class HL: the letters (General_Category Lo) of the Hebrew blocks,
 *  U+05D0 to U+05EA, U+05EF to U+05F2 and those of U+FB1D to U+FB4F (UnicodeData.txt 17.0.0, test/text.test.mjs; ICU
 *  78.3 gives the same 75 code points the class). */
export const isHebrewLetter = (cp) => (cp >= 0x5d0 && cp <= 0x5ea) || (cp >= 0x5ef && cp <= 0x5f2) || (cp >= 0xfb1d && cp <= 0xfb4f && cp !== 0xfb1e && cp !== 0xfb29 && cp !== 0xfb37 && cp !== 0xfb3d && cp !== 0xfb3f && cp !== 0xfb42 && cp !== 0xfb45);
const MARK = /^\p{M}$/u;
/** The marks (General_Category M) that are not of UAX #14's class CM, which LB9 does not fold into the character before
 *  them: 21 of class GL (combining double marks), U+0F7F of class BA, 2 of VF and 7 of VI (viramas). LineBreak.txt 17.0.0;
 *  ICU 78.3 gives the same (round 8's probe cmsets.py). */
const MARK_NOT_CM = new Set([0x35c, 0x35d, 0x35e, 0x35f, 0x360, 0x361, 0x362, 0xf7f, 0x1aeb, 0x1b44, 0x1bf2, 0x1bf3, 0x1dcd, 0x1dfc, 0xa9c0, 0xfe20, 0xfe22, 0xfe24, 0xfe26, 0xfe27, 0xfe29, 0xfe2b, 0xfe2d, 0xfe2e, 0x11046, 0x1107f, 0x1134d, 0x113d0, 0x1193e, 0x11f42, 0x16fe4]);
/** The code points of class CM that are not marks, ZWJ aside (the same sources): the C0 and C1 controls, ALM, ZWNJ, LRM,
 *  RLM, the bidirectional embeddings, overrides and isolates, U+206A to U+206F, U+3035, U+FFF9 to U+FFFB, U+1BCA0 to
 *  U+1BCA3, U+1D173 to U+1D17A, the tags. visible() shows most of them as escapes; ALM, ZWNJ, LRM, RLM and 22 others
 *  reach the wrapper as they are. */
const CM_NOT_MARK = [[0x0, 0x8], [0xe, 0x1f], [0x7f, 0x84], [0x86, 0x9f], [0x61c, 0x61c], [0x200c, 0x200c], [0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x206f], [0x3035, 0x3035], [0xfff9, 0xfffb], [0x1bca0, 0x1bca3], [0x1d173, 0x1d17a], [0xe0001, 0xe0001], [0xe0020, 0xe007f]];
/** Whether UAX #14's LB9 folds a code point into the character before it, which it then takes the class of (R8e, round
 *  8): ZWJ, and class CM (class SA's marks too, which LB1 makes CM): the marks but MARK_NOT_CM, and CM_NOT_MARK. */
export const isLineBreakCombining = (cp) => cp === 0x200d || (MARK.test(String.fromCodePoint(cp)) ? !MARK_NOT_CM.has(cp) : CM_NOT_MARK.some(([a, b]) => cp >= a && cp <= b));
/** The code point that ends at offset j of s (a surrogate pair read whole), and the offset it begins at. */
function codePointBefore(s, j) {
  const lo = s.charCodeAt(j - 1), hi = j >= 2 ? s.charCodeAt(j - 2) : 0;
  return lo >= 0xdc00 && lo <= 0xdfff && hi >= 0xd800 && hi <= 0xdbff ? [((hi - 0xd800) << 10) + (lo - 0xdc00) + 0x10000, j - 2] : [lo, j - 1];
}
/** The character whose class LB9 gives to what ends at offset j of s, the run of what it folds before j passed over:
 *  [its code point, the offset it begins at], or [-1, 0] where only such a run is there. */
function baseBefore(s, j) {
  while (j > 0) { const [cp, at] = codePointBefore(s, j); if (!isLineBreakCombining(cp)) return [cp, at]; j = at; }
  return [-1, 0];
}
/** Whether UAX #14 breaks before a GL character after the code unit at offset i of s (LB12a, breaksBeforeGlue), but where
 *  the character there is a hyphen-minus after a Hebrew letter (LB21a: HL HY x, unless a Hebrew letter follows). What
 *  LB9 folds into a character (a mark, ZWJ, and the characters of class CM that are not marks: ALM, ZWNJ, LRM, RLM...)
 *  takes its class: between the letter and the hyphen, and after the hyphen or the space; but no break after ZWJ
 *  (LB8a), and none after such a run where it follows a space (SP) or nothing, as LB9 folds nothing into a space and LB10
 *  then takes the run as a letter (AL). Z2, round 7: the reader broke after a Hebrew letter's hyphen as after a Latin
 *  letter's (ICU 78.3 breaks before U+00A0 after 'abcd-', and gives no break in a Hebrew word, '-', U+00A0 and a Hebrew
 *  word); R8e, round 8: and did where ALM, ZWNJ, LRM or RLM stood between the letter and the hyphen (round 7's check). What
 *  is before i is read from s, so that a line laid out from its start is the same as from the text's. */
function breaksBeforeGlueAt(s, i) {
  let [g, at] = codePointBefore(s, i + 1);
  if (g === 0x200d) return false;
  if (isLineBreakCombining(g)) {
    [g, at] = baseBefore(s, at);
    if (g < 0 || g === 0x20) return false;
  }
  if (!breaksBeforeGlue(g)) return false;
  if (g !== 0x2d) return true;
  return !isHebrewLetter(baseBefore(s, at)[0]);
}
/** Whether a grapheme cluster is made only of what LB9 folds into the character before it (LRM after a letter, say, or
 *  a mark after LRM, which a cluster boundary follows): it goes to a line with that character. */
function foldsWhole(c) {
  for (const ch of c) if (!isLineBreakCombining(ch.codePointAt(0))) return false;
  return c !== '';
}

/** Where to end a line that a cluster of class GL (isGlue) does not fit at the end of (Y3 (e), round 6): the index, in
 *  the line's clusters (`starts`: where each begins in s; `widths`: its columns), of the first cluster of the next line,
 *  which takes the rest of them and the GL cluster (of `cw` columns), at most `n` columns: after the clusters of class GL
 *  the line ends in and the character before them, where that is a space, BA or a hyphen (LB12a; a hyphen-minus not
 *  after a Hebrew letter, LB21a: breaksBeforeGlueAt), else before that character too, so that the next line does not
 *  begin with a GL character UAX #14 gives no break before; -1 where the line ends before the GL cluster all the same:
 *  UAX #14 breaks there, or the line would be left empty, or the next would not fit in the columns (a column is the
 *  limit, as a cluster wider than the columns is). */
function glueBreak(s, starts, widths, at, cw, n) {
  let k = starts.length;
  while (k > 0 && isGlue(s.charCodeAt(starts[k - 1]))) k--;
  const run = k < starts.length ? starts[k] : at;
  let cut = run > 0 && breaksBeforeGlueAt(s, run - 1) ? k : k - 1;
  // LB9 (R8e, round 8): a cluster made only of what it folds goes with the cluster it follows, but a space (SP)
  if (cut < k) while (cut > 0 && foldsWhole(s.slice(starts[cut], cut + 1 < starts.length ? starts[cut + 1] : at)) && s.charCodeAt(starts[cut - 1]) !== 0x20) cut--;
  if (cut < 1 || cut === starts.length) return -1;
  let w = cw;
  for (let i = cut; i < widths.length; i++) w += widths[i];
  return w <= n ? cut : -1;
}

/** Where the lines of one line of text s (no new line in it) begin and end, [start, end), when it is cut into lines of
 *  at most `cols` columns between clusters, a cluster wider than the columns on a line of its own; from offset `from`,
 *  where a line begins. Whitespace (HANGS) that does not fit at the end of a line stays at the end of that line, with
 *  the whitespace after it, as UAX #14 has a space: it hangs there, past the line's columns, and is in no line (nothing
 *  past the screen is drawn); the next line begins after it, so that no line but the first begins with whitespace (V7,
 *  round 5: the space that did not fit began the next line). Whitespace that fits ends its line. A no-break space or
 *  a non-breaking hyphen (class GL) that does not fit begins the next line with the character before it (glueBreak:
 *  UAX #14 gives no break before it but after a space, BA or a hyphen, a hyphen-minus not after a Hebrew letter; Y3 (e),
 *  round 6: it began the line by itself; Z2, round 7: after a Hebrew letter's hyphen, and U+2007, it still did).
 *  One pair at a time, so that a long text can be laid out without its lines being made; from a line's start, the lines
 *  are those from the text's start (what a line holds depends only on the text from its start). An empty s is one empty
 *  line. */
export function* lineSpans(s, cols, from = 0) {
  const n = Math.max(1, cols);
  if (from >= s.length) { if (from === 0) yield [0, 0]; return; }
  if (PRINTABLE_ASCII.test(s)) {
    for (let i = from; i < s.length;) {
      const e = Math.min(s.length, i + n);
      yield [i, e];
      for (i = e; i < s.length && s.charCodeAt(i) === 0x20;) i++;
    }
    return;
  }
  // the line being made: where it begins, its columns, where each of its clusters begins and the columns each takes
  let start = from, at = from, w = 0, hanging = false, starts = [], widths = [];
  for (const c of clusters(from ? s.slice(from) : s)) {
    if (hanging) {
      if (HANGS.test(c)) { at += c.length; continue; }
      hanging = false; start = at; w = 0; starts = []; widths = [];
    }
    const cw = clusterWidth(c);
    if (w + cw > n && at > start) {
      const k = isGlue(c.charCodeAt(0)) ? glueBreak(s, starts, widths, at, cw, n) : -1;
      if (k > 0) {
        // the line ends before its k-th cluster, which begins the next with the rest and c
        yield [start, starts[k]];
        start = starts[k]; starts = starts.slice(k); widths = widths.slice(k); w = 0;
        for (const x of widths) w += x;
      } else {
        yield [start, at];
        if (HANGS.test(c)) { hanging = true; at += c.length; continue; }
        start = at; w = 0; starts = []; widths = [];
      }
    }
    starts.push(at); widths.push(cw);
    at += c.length; w += cw;
  }
  if (!hanging) yield [start, s.length];
}

/** One line (no new line in it) cut into lines of at most `cols` columns, between clusters; a cluster wider than the
 *  columns goes on a line of its own; whitespace that does not fit at a line's end hangs there, in no line (lineSpans).
 *  The lines are slices of s, in order, and only that whitespace is between them. Each line is a slice of s (a line
 *  built by adding cluster after cluster cost a string object per cluster: 28 MB for a million characters of Hebrew,
 *  R.F1). */
export function wrap(s, cols) {
  const out = [];
  for (const [a, b] of lineSpans(s, cols)) out.push(s.slice(a, b));
  return out;
}

/** Where the lines of wrapWords(s, cols) begin and end in s, [start, end) each: a paragraph in lines of at most `cols`
 *  columns, broken at spaces where a line can be, else by columns (lineSpans). A space a line is broken at is in no line
 *  (it hangs at the end of the line before, as UAX #14 has the whitespace at a break, and is not drawn, though the line
 *  has room for it: Y3 (c), round 6), and so is the whitespace (HANGS) after it, at the start of the word that begins
 *  the next line, and whitespace that hangs inside a word cut by columns, which ends its line: no line but the first
 *  begins with whitespace (V7, round 5). Each line is s.slice(start, end), so that its place in its paragraph is known
 *  (W1: a line is laid out from its paragraph's levels). */
export function wordSpans(s, cols) {
  const out = [];
  // the line being made, where it begins in s, where the next word begins, and whether the line can take it (not when
  // whitespace that hangs ends it)
  let line = '', from = 0, pos = 0, open = true;
  for (const whole of s.split(' ')) {
    let at = pos, word = whole;
    pos += whole.length + 1;
    if (line === '' && out.length) { const k = blankPrefix(word); at += k; word = word.slice(k); }
    const next = line === '' ? word : `${line} ${word}`;
    if (open && width(next) <= cols) { if (line === '') from = at; line = next; continue; }
    if (line !== '') out.push([from, from + line.length]);
    if (out.length) { const k = blankPrefix(word); at += k; word = word.slice(k); }
    const pieces = [...lineSpans(word, cols)], [x, y] = pieces.pop();
    for (const [c, d] of pieces) out.push([at + c, at + d]);
    line = word.slice(x, y); from = at + x; open = y === word.length;
  }
  // a paragraph that ends in whitespace at a break ends with its last word: what is left after the break hangs, and
  // makes no empty line (Y3 (d), round 6: it made one, drawn as a blank row); an empty s, or one of spaces only, is one
  // empty line
  if (line !== '' || !out.length) out.push([from, from + line.length]);
  return out;
}

/** How many code units at the start of s are whitespace that hangs (HANGS), in whole clusters. */
function blankPrefix(s) {
  if (s === '' || !HANGS.test(s[0])) return 0;
  let k = 0;
  for (const c of clusters(s)) { if (!HANGS.test(c)) break; k += c.length; }
  return k;
}

/** The reader's own words (not a transcript's text) in lines of at most `cols` columns, broken at spaces where a
 *  line can be, else by columns (wordSpans: each line a slice of s). */
export function wrapWords(s, cols) {
  return wordSpans(s, cols).map(([a, b]) => s.slice(a, b));
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
 * The right-to-left mode: LTMS_READER_BIDI when it is set ("terminal" or "reader"); else "reader", in every terminal
 * (Y1, round 6: one layout for every terminal, decided S378 on a measurement of Alacritty 0.17.0, Konsole 26.08.3, tmux
 * 3.6 and VS Code 1.146.0's terminal; round 3 gave Konsole, detected by KONSOLE_VERSION, "terminal", which a reader run
 * over ssh from Konsole did not see). Returns { mode, by } or { refused: why }.
 */
export function rtlModeOf(env) {
  const v = env.LTMS_READER_BIDI;
  if (typeof v === 'string' && v !== '') {
    if (!RTL_MODES.includes(v)) return { refused: `LTMS_READER_BIDI is ${JSON.stringify(v)}: it takes "reader" (the reader lays right-to-left text out, the default) or "terminal" (the text as stored, for a terminal that lays it out itself)` };
    return { mode: v, by: 'LTMS_READER_BIDI' };
  }
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

/** A cluster as it is drawn at `level`: at an odd one, its first character's mirrored glyph (L4). */
const drawn = (c, level) => {
  if (!(level & 1)) return c;
  const cp = c.codePointAt(0), m = mirrorOf(cp);
  return m === cp ? c : String.fromCodePoint(m) + c.slice(cp > 0xffff ? 2 : 1);
};

/** Whether a grapheme cluster is nonspacing marks alone (each of class NSM). */
const marksAlone = (c) => { for (const ch of c) if (classOf(ch.codePointAt(0)) !== NSM) return false; return true; };

/**
 * The items of a stretch of text s, in order, each laid out whole (Z5, round 7), added to the end of the caller's
 * `items`, and each one's level to `at`: the level of its first character X9 kept (`levelOf(c)`, asked of each cluster
 * c of s in order, -1 where X9 removed them all). Each item is a grapheme cluster, but where a cluster of nonspacing
 * marks alone follows clusters X9 removed whole (a soft hyphen, ZWSP, WJ: the segmenter breaks after each, a control,
 * so that a mark after one is a cluster of its own) that follow a cluster of the stretch: the mark goes with that
 * cluster, and so do the removed characters between, in their order. UAX #9 gives the mark the class of the character
 * before it, the removed ones passed over (W1), and the reader keeps a letter's marks after it, as a terminal draws
 * them; as an item of its own, at an odd level, the mark was reversed with its run, before its letter, on the cell
 * before it (round 6's check: final nun, WJ, WJ, patah was written patah, WJ, WJ, nun). Only after a cluster with a
 * character X9 keeps: a mark after removed characters that begin the stretch, or follow only removed ones, has no
 * letter there, and is an item of its own, at its own level. A cluster X9 removed whole is at the level of the item
 * before it, or at `fallback` when it is the first.
 */
function addItems(s, levelOf, items, at, fallback) {
  const held = [];
  // whether the last item is a cluster of this stretch with a character X9 keeps (removed ones after it are held)
  let kept = false;
  const flush = () => { for (const x of held) { at[items.length] = at[items.length - 1]; items.push(x); } held.length = 0; kept = false; };
  for (const c of clusters(s)) {
    const v = levelOf(c);
    if (v < 0 && kept) { held.push(c); continue; }
    if (held.length && marksAlone(c)) { items[items.length - 1] += held.join('') + c; held.length = 0; continue; }
    flush();
    at[items.length] = v >= 0 ? v : items.length ? at[items.length - 1] : fallback;
    items.push(c);
    kept = v >= 0;
  }
  flush();
}

/** The clusters of s in visual order by `levels`, the levels of the code units of a text s begins at offset `base` of:
 *  a cluster at the level of its first character X9 kept (one X9 removed whole at the level of the cluster before it,
 *  the first at `level`; a mark after such ones, with the cluster before them: addItems); L2; L4. */
function ordered(s, levels, base, level) {
  const cs = [], at = new Int8Array(s.length);
  let k = base;
  addItems(s, (c) => { let v = -1; for (let j = k, e = k + c.length; j < e && v < 0; j++) v = levels[j]; k += c.length; return v; }, cs, at, level);
  let out = '';
  for (const i of visualOrder(at, 0, cs.length)) out += drawn(cs[i], at[i]);
  return out;
}

/** The levels of a path's or a URL's own content, s, laid out on its own, left to right, its separators strong (HL2),
 *  per code unit; null when nothing in it is right to left (it reads as stored). */
function unitLevels(s) {
  if (NO_RTL.test(s)) return null;
  const classes = classesOf(s);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 0x2f || c === 0x5c) classes[i] = LTR_CLASS; }
  return resolveLevels(s, classes, 0);
}

/**
 * A paragraph's levels, resolved once (W1, round 4; UAX #9 section 3.4: X9, W1 to W7, N0 to N2, I1 and I2 over the whole
 * paragraph; then each line it is wrapped into is reordered from them, by lineOf, never resolved by itself). `level` is
 * the paragraph's (0 or 1; null: by P2 and P3). With `units`, each path or URL in it stands as one isolate (ISO, HL4),
 * and its content is resolved once too, on its own. Returns { text, level, levels, units }: `levels` per code unit
 * (bidi.mjs resolveLevels: -1 where X9 removed a character, at the second unit of a surrogate pair, and inside a unit
 * but at its first unit, which holds the unit's level), or null when nothing outside the units reorders; `units`
 * [{ a, b, inner }], inner the content's levels (unitLevels), or null.
 */
function layOut(text, level, units) {
  if (level !== 1 && NO_RTL.test(text)) return { text, level: 0, levels: null, units: [] };
  const spans = units ? pathUnits(text) : [], classes = classesOf(text);
  for (const [a, b] of spans) { classes[a] = ISO; classes.fill(BN, a + 1, b); }
  let rtl = false;
  for (let i = 0; i < classes.length && !rtl; i++) { const k = classes[i]; rtl = k === R || k === AL || k === AN; }
  const p = level ?? paragraphLevel(classes);
  return { text, level: p, levels: rtl || p === 1 ? resolveLevels(text, classes, p) : null, units: spans.map(([a, b]) => ({ a, b, inner: unitLevels(text.slice(a, b)) })) };
}

/**
 * Line [a, b) of a paragraph laid out by layOut (a and b begin clusters), in visual order: L1 over the line (its own
 * characters' classes, the paragraph's levels), each cluster at the level of its first character X9 kept (a mark after
 * characters X9 removed, with the cluster before them: addItems), L2, L4. A
 * path's or a URL's part in the line stands in it as one isolate, at the level the unit has in the paragraph, its own
 * characters in the order of its own levels (a unit the line breaks inside of is drawn in pieces, as an isolate across
 * a line break is: GNU FriBidi's library agrees, test/bidi.test.mjs).
 */
function lineOf(P, a, b) {
  const { text, level: p, levels, units } = P;
  // the first unit that ends after a, by a binary search (the units are in order and apart, so their ends are in order
  // too): a line late in a paragraph of many paths is laid out without passing over the units before it (V1, round 5:
  // passed over one by one, a page at the end of 200,000 paths cost seven to fifteen times a page at the start)
  let u = 0;
  for (let hi = units.length; u < hi;) { const mid = (u + hi) >> 1; if (units[mid].b <= a) u = mid + 1; else hi = mid; }
  const piece = (U, s, e) => (U.inner ? ordered(text.slice(s, e), U.inner, s - U.a, 0) : text.slice(s, e));
  if (!levels) {
    // nothing outside the units is reordered: the line as stored, each unit's part in its own order
    let out = '', at = a;
    for (; u < units.length && units[u].a < b; u++) { const U = units[u], s = Math.max(a, U.a), e = Math.min(b, U.b); out += text.slice(at, s) + piece(U, s, e); at = e; }
    return at === a ? text.slice(a, b) : out + text.slice(at, b);
  }
  // L1: the line's own characters' classes (a unit's first unit ISO, the rest of it passed over), the paragraph's levels
  const lv = levels.slice(a, b), cl = classesOf(text.slice(a, b));
  for (let k = u; k < units.length && units[k].a < b; k++) { const s = Math.max(a, units[k].a), e = Math.min(b, units[k].b); cl.fill(BN, s - a, e - a); if (s === units[k].a) cl[s - a] = ISO; }
  lineLevels(cl, lv, p);
  // the stretches between units by their clusters, each unit's part as one item at the unit's level; L2
  const items = [], at = new Int8Array(b - a);
  for (let i = a; i < b;) {
    if (u < units.length && i >= units[u].a) {
      const U = units[u], e = Math.min(b, U.b);
      at[items.length] = levels[U.a]; items.push({ unit: piece(U, i, e) });
      i = e; u++; continue;
    }
    const end = u < units.length && units[u].a < b ? units[u].a : b;
    addItems(text.slice(i, end), (c) => { let v = -1; for (let k = i - a, e = k + c.length; k < e && v < 0; k++) v = lv[k]; i += c.length; return v; }, items, at, p);
  }
  let out = '';
  for (const i of visualOrder(at, 0, items.length)) out += typeof items[i] === 'string' ? drawn(items[i], at[i]) : items[i].unit;
  return out;
}

// The paragraphs laid out last: the one before (the lines of a paragraph are laid out one after another), and the last
// KEEP of at least LONG units (a long paragraph is read a page at a time, page after page: R.F1's record is one line of
// 4,000,000 characters). What is kept is bounded: KEEP + 1 paragraphs, their levels a byte a code unit.
const LONG = 4096, KEEP = 2, KEPT = [];
let LAST = null;
const same = (e, text, level, units) => e.level === level && e.units === units && e.P.text === text;

/** layOut(text, level, units), from those kept when it is one of them. */
function paragraphOf(text, level, units) {
  let e = LAST && same(LAST, text, level, units) ? LAST : KEPT.find((k) => same(k, text, level, units));
  // found: its text the same characters, perhaps another string, which is kept from now on, so that the next look at
  // it compares two strings that are one (a string compared with another of its characters is read whole)
  if (e) e.P.text = text;
  else e = { level, units, P: layOut(text, level, units) };
  if (text.length >= LONG && KEPT[0] !== e) {
    const i = KEPT.indexOf(e);
    if (i >= 0) KEPT.splice(i, 1);
    KEPT.unshift(e);
    if (KEPT.length > KEEP) KEPT.pop();
  }
  LAST = e;
  return e.P;
}

/** Line [a, b) of the paragraph `text` (its level `level`, 0 or 1; null: by P2 and P3), in visual order, laid out from
 *  the paragraph's levels (W1): what the screen writes for a line of a wrapped paragraph, in "reader" mode. a and b
 *  begin clusters. With `units`, each path or URL is one isolate (HL4). */
export function paragraphLine(text, level, a, b, { units = true } = {}) {
  a = Math.max(0, a); b = Math.min(b, text.length);
  if (a >= b) return '';
  return lineOf(paragraphOf(text, level, units), a, b);
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
 * One line that is a paragraph of its own (logical order, cut to its columns, visible, its tabs as spaces) in visual
 * order, as a terminal that draws text in the order it is written must get it: UAX #9 over its code points, at the
 * paragraph's level (`level`, or the line's own by P2 and P3 when null), then L1 and L2 over its grapheme clusters, each
 * kept whole and in its own order (a mark after its letter, as a terminal draws it: L3), each at an odd level mirrored
 * (L4). With `units`, each path or URL is laid out on its own, left to right, and stands in the line as one isolate
 * (HL4). A line of a paragraph wrapped into several is laid out by paragraphLine instead, from the paragraph's levels.
 */
export function visualLine(text, level = null, { units = true } = {}) {
  if (text === '' || (level !== 1 && NO_RTL.test(text))) return text;
  return lineOf(layOut(text, level, units), 0, text.length);
}

/** Whether a grapheme cluster boundary is at offset i of s (0 < i < s.length), read from the code point before i and the
 *  one at i only: exact where either is whitespace, as at a segment's edges below (the rules that read further back, the
 *  Indic conjuncts', the emoji sequences' and the flags', join a character to a linker, a ZWJ or a regional indicator
 *  before it, never to whitespace, and never join whitespace to what is before it). */
function boundaryAt(s, i) {
  const lo = s.charCodeAt(i - 1), pair = lo >= 0xdc00 && lo <= 0xdfff && i >= 2 && s.charCodeAt(i - 2) >= 0xd800 && s.charCodeAt(i - 2) <= 0xdbff;
  const from = pair ? i - 2 : i - 1;
  const hi = s.charCodeAt(i), to = Math.min(s.length, i + (hi >= 0xd800 && hi <= 0xdbff ? 2 : 1));
  return clusters(s.slice(from, to)).next().value.length === i - from;
}

/**
 * The whitespace at either end of a segment's text, ECMAScript's as trimStart and trimEnd take it, in whole grapheme
 * clusters made of whitespace only: [a, b), the core between them (V3, round 5: by trimStart, a space carrying a mark at
 * a segment's start was cut from its mark, which was laid out with the rest, on the letter beside it). A character that
 * joins the cluster of a space before it is at U+0300 or above (a mark, ZWJ, a spacing mark); one that joins a space
 * after it, at U+0600 or above (a Prepend character): below those the boundary is not looked up (test/text.test.mjs
 * checks both, by Intl.Segmenter).
 */
function blankEdges(text) {
  let a = text.length - text.trimStart().length, b = text.trimEnd().length;
  if (a >= b) return [a, a];
  while (a > 0 && (!SEG || text.charCodeAt(a) >= 0x300) && !boundaryAt(text, a)) a--;
  while (b < text.length && (!SEG || text.charCodeAt(b - 1) >= 0x600) && !boundaryAt(text, b)) b++;
  return [a, b];
}

/**
 * One screen row's segments ([{ text, style, dir, par, at }], already cut to the row's width) as they are written, in
 * `mode`. A segment is a paragraph of its own, or a line of one: `par` names the paragraph (its text, of which the
 * segment's text is the slice at `at`: a line of a record, of a message, of the reader's own words wrapped into lines,
 * W1). Its direction is `dir` when given (0 or 1: a line's, its paragraph's), else its own (P2, P3).
 * "reader": a line of a paragraph laid out whole from the paragraph's levels (paragraphLine), its whitespace at either
 * end with the rest, as UAX #9's L1 and L2 lay out a line (V7, round 5: they stayed where they were, and the line's
 * text differed from UAX #9's); a paragraph of its own (a cell, a line cut to its columns: R1 (c)) laid out by
 * visualLine but its spaces at either end, in whole clusters (blankEdges), which stay where they are: a cell's are the
 * cell's padding. Either way the columns stay, and the text is aligned left. "terminal": as stored, with an RLM after a
 * right-to-left paragraph's text (before the spaces at its end), so that a terminal that lays the line out with a
 * left-to-right base (Konsole) puts the paragraph's end punctuation at its left (measured on Konsole 26.08.3; a mark at
 * the row's first column it drops); never after a left-to-right one's.
 */
export function displayOrder(row, mode = 'reader') {
  if (mode !== 'reader' && mode !== 'terminal') throw new RangeError(`no right-to-left mode ${JSON.stringify(mode)}: the modes are "reader" and "terminal"`);
  let out = null;
  for (let i = 0; i < row.length; i++) {
    const s = row[i], text = s.text;
    // a line of a paragraph: one whose paragraph holds what the segment's text is, at its place
    const line = typeof s.par === 'string' && Number.isInteger(s.at) && s.par.startsWith(text, s.at);
    if (!line && s.dir !== 1 && NO_RTL.test(text)) continue;
    if (line && mode === 'reader') {
      if (text === '') continue;
      const shown = paragraphLine(s.par, s.dir ?? directionOf(s.par), s.at, s.at + text.length);
      if (shown === text) continue;
      out ??= row.slice();
      out[i] = { ...s, text: shown };
      continue;
    }
    const [a, b] = blankEdges(text);
    if (a >= b) continue;
    const core = text.slice(a, b), dir = s.dir ?? (line ? directionOf(s.par) : directionOf(core));
    const shown = mode === 'terminal' ? (dir === 1 ? `${core}${RLM}` : core) : visualLine(core, dir);
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
