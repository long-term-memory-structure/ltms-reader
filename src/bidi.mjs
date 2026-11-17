// src/bidi.mjs — the Unicode Bidirectional Algorithm (UAX #9), version 17.0.0, as the reader lays out a line of text for
// a terminal that draws text in the order it is written (R1, S377: Alacritty and VS Code's terminal do), and, since
// round 6 (Y1), for every terminal: one that lays bidirectional text out itself, as Konsole does, gets the line inside a
// left-to-right override (src/screen.mjs). Pure functions over code points; the data is
// src/bidi-table.mjs, generated from the Unicode Character Database (scripts/bidi-table.mjs).
//
// What is implemented: the paragraph's level by P2 and P3 (its first strong character, skipping an isolate; none: left
// to right), or given (HL1); X9, which removes BN (and the embeddings and overrides); the implicit algorithm, W1 to W7,
// N0 with the paired brackets (BD16, a stack of 63, the brackets matched by their canonical equivalents), N1, N2, I1 and
// I2, over one isolating run sequence: the paragraph's levels, resolved once for the whole paragraph; then, for each line
// the paragraph is wrapped into, L1 and L2 (section 3.4: a line's levels are the paragraph's, never resolved again for
// the line alone); L4's mirrored glyphs are given by mirrorOf. The explicit formatting characters never act: the reader
// shows them as visible escapes (R.F5), so that none reaches this layout raw; if one does, an embedding, override or pop
// is removed as X9 removes it, and an isolate's initiator or PDI is a neutral. Checked against Unicode's
// BidiCharacterTest.txt (every case without an explicit formatting character) and against GNU FriBidi, its CLI for
// single lines and its library for wrapped paragraphs (test/bidi.test.mjs).
//
// One higher-level protocol (HL4, with HL2 inside it) is the caller's: a stretch of a paragraph laid out on its own, as an
// isolate would be, stands in it as one character of the class ISO (src/text.mjs: a path or a URL).
import { BRACKETS, BRACKET_EQUIVALENTS, CLASSES, CLASS_RANGES, MIRRORS } from './bidi-table.mjs';

export const L = 0, R = 1, AL = 2, EN = 3, ES = 4, ET = 5, AN = 6, CS = 7, NSM = 8, BN = 9, B = 10, S = 11, WS = 12, ON = 13;
export const LRE = 14, LRO = 15, RLE = 16, RLO = 17, PDF = 18, LRI = 19, RLI = 20, FSI = 21, PDI = 22;
/** Not a Unicode class: a stretch laid out on its own (HL4), standing in the line as an isolate stands there. */
export const ISO = 23;
const NAMES = ['L', 'R', 'AL', 'EN', 'ES', 'ET', 'AN', 'CS', 'NSM', 'BN', 'B', 'S', 'WS', 'ON', 'LRE', 'LRO', 'RLE', 'RLO', 'PDF', 'LRI', 'RLI', 'FSI', 'PDI'];
if (NAMES.join() !== CLASSES.join()) throw new Error('src/bidi-table.mjs numbers the classes otherwise than src/bidi.mjs');

// the classes of the Basic Multilingual Plane, at hand; the rest by a binary search of the ranges
const BMP = new Uint8Array(0x10000);
for (let i = 0; i < CLASS_RANGES.length && CLASS_RANGES[i] <= 0xffff; i += 3) BMP.fill(CLASS_RANGES[i + 2], CLASS_RANGES[i], Math.min(CLASS_RANGES[i + 1], 0xffff) + 1);

/** A code point's Bidi_Class, as a number (L, R, AL, ...). */
export function classOf(cp) {
  if (cp <= 0xffff) return BMP[cp];
  let lo = 0, hi = CLASS_RANGES.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, a = CLASS_RANGES[3 * mid], b = CLASS_RANGES[3 * mid + 1];
    if (cp < a) hi = mid - 1; else if (cp > b) lo = mid + 1; else return CLASS_RANGES[3 * mid + 2];
  }
  return L;
}

/** Each character's class, by code unit (W1, round 4: a paragraph's characters, classed at once): at the first unit of a
 *  surrogate pair its code point's, at the second BN, which X9 passes over as it passes BN over; a lone surrogate's own. */
export function classesOf(s) {
  const n = s.length, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { out[i] = classOf(((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000); out[++i] = BN; continue; }
    }
    out[i] = BMP[c];
  }
  return out;
}

const OPENS = new Map(), CLOSES = new Map(), EQUIV = new Map(), MIRROR = new Map();
for (let i = 0; i < BRACKETS.length; i += 2) { OPENS.set(BRACKETS[i], BRACKETS[i + 1]); CLOSES.set(BRACKETS[i + 1], BRACKETS[i]); }
for (let i = 0; i < BRACKET_EQUIVALENTS.length; i += 2) EQUIV.set(BRACKET_EQUIVALENTS[i], BRACKET_EQUIVALENTS[i + 1]);
for (let i = 0; i < MIRRORS.length; i += 2) MIRROR.set(MIRRORS[i], MIRRORS[i + 1]);
const canonical = (cp) => EQUIV.get(cp) ?? cp;

/** The glyph a code point is drawn with at an odd (right-to-left) level (L4), by Bidi_Mirroring_Glyph: itself when it
 *  has none. */
export const mirrorOf = (cp) => MIRROR.get(cp) ?? cp;

const isStrong = (c) => c === L || c === R || c === AL;
/** The classes X9 removes, and the neutral and isolate types N1 and N2 resolve (NI), as tables by class: a paragraph's
 *  levels are resolved over all its characters at once (W1, round 4: R's record is a paragraph of 4,000,000), each looked up. */
const REMOVED = new Uint8Array(24), NI = new Uint8Array(24);
for (const c of [BN, LRE, LRO, RLE, RLO, PDF]) REMOVED[c] = 1;

/**
 * The paragraph's level by P2 and P3: 0 when its first strong character (L) is left to right, or it has none; 1 when it
 * is R or AL. An isolate's content is skipped (an initiator to its PDI, or the paragraph's end), and so is a stretch the
 * caller lays out on its own (ISO). `classes`: each code point's class.
 */
export function paragraphLevel(classes, from = 0, to = classes.length) {
  let depth = 0;
  for (let i = from; i < to; i++) {
    const c = classes[i];
    if (c === LRI || c === RLI || c === FSI) depth++;
    else if (c === PDI) { if (depth > 0) depth--; }
    else if (depth === 0 && isStrong(c)) return c === L ? 0 : 1;
  }
  return 0;
}

/** The type a resolved class gives N0, N1 and N2: L, or R for R, EN and AN; -1 for a neutral. */
const strongOf = (c) => (c === L ? L : c === R || c === EN || c === AN ? R : -1);
for (const c of [B, S, WS, ON, LRI, RLI, FSI, PDI, ISO]) NI[c] = 1;

/**
 * The resolved levels of one paragraph without explicit embeddings: X9, W1 to W7, N0 to N2, I1 and I2. `classes`: each
 * character's class (classOf, or ISO where the caller lays a stretch out on its own; a place the caller marks BN is
 * passed over as X9 passes BN over); `cps`: the code points, an array beside `classes`, or a string whose code unit i
 * begins the character of classes[i] (its code point is read there: the caller marks the second unit of a surrogate
 * pair BN); `level`: the paragraph's level (paragraphLevel, or given). Returns an Int8Array of levels, -1 where X9
 * removed the character.
 */
export function resolveLevels(cps, classes, level) {
  const n = classes.length, levels = new Int8Array(n);
  const cpAt = typeof cps === 'string' ? (i) => cps.codePointAt(i) : (i) => cps[i];
  // the isolating run sequence: every character X9 keeps, all at the paragraph's level; idx, where each is (null when X9
  // removes none: each is where it is)
  let m = 0;
  for (let i = 0; i < n; i++) if (!REMOVED[classes[i]]) m++;
  let idx = null, t;
  if (m === n) t = new Uint8Array(classes);
  else {
    levels.fill(-1);
    idx = new Int32Array(m); t = new Uint8Array(m);
    for (let i = 0, k = 0; i < n; i++) if (!REMOVED[classes[i]]) { idx[k] = i; t[k++] = classes[i]; }
  }
  const e = level & 1 ? R : L, sos = e, eos = e;
  // W1: a nonspacing mark takes the type before it (ON after an isolate's initiator or PDI); sos at the start
  for (let k = 0; k < m; k++) {
    if (t[k] !== NSM) continue;
    const p = k ? t[k - 1] : sos;
    t[k] = p === LRI || p === RLI || p === FSI || p === PDI || p === ISO ? ON : p;
  }
  // W2: a European number after Arabic letters (the last strong type before it) is an Arabic number; W3: AL is R (once
  // passed, as W2 has read it)
  for (let k = 0, last = sos; k < m; k++) {
    const c = t[k];
    if (c === L || c === R) last = c;
    else if (c === AL) { last = AL; t[k] = R; }
    else if (c === EN && last === AL) t[k] = AN;
  }
  // W4: one separator between two numbers of a kind it joins
  for (let k = 1; k < m - 1; k++) {
    if (t[k] === ES && t[k - 1] === EN && t[k + 1] === EN) t[k] = EN;
    else if (t[k] === CS && t[k - 1] === EN && t[k + 1] === EN) t[k] = EN;
    else if (t[k] === CS && t[k - 1] === AN && t[k + 1] === AN) t[k] = AN;
  }
  // W5: terminators next to a European number are European numbers
  for (let k = 0; k < m;) {
    if (t[k] !== ET) { k++; continue; }
    let j = k;
    while (j < m && t[j] === ET) j++;
    if ((k > 0 && t[k - 1] === EN) || (j < m && t[j] === EN)) for (let x = k; x < j; x++) t[x] = EN;
    k = j;
  }
  // W6: the separators and terminators left are neutrals; W7: a European number after L (or sos L) is L (W6 makes no
  // strong type, so one pass does both)
  for (let k = 0, last = sos; k < m; k++) {
    const c = t[k];
    if (c === ES || c === ET || c === CS) t[k] = ON;
    else if (c === L || c === R) last = c;
    else if (c === EN && last === L) t[k] = L;
  }
  // N0: paired brackets (BD16), in the order of their openings
  const pairs = [], stack = [];   // the stack: two numbers an entry, a closing bracket and where its opening is
  for (let k = 0; k < m; k++) {
    if (t[k] !== ON) continue;
    const cp = cpAt(idx ? idx[k] : k);
    const closing = OPENS.get(cp);
    if (closing !== undefined) {
      if (stack.length === 2 * 63) break;   // no room for a 64th: BD16 stops for the rest of the sequence
      stack.push(canonical(closing), k);
      continue;
    }
    if (!CLOSES.has(cp)) continue;
    const c = canonical(cp);
    for (let j = stack.length - 2; j >= 0; j -= 2) {
      if (stack[j] === c) { pairs.push(stack[j + 1], k); stack.length = j; break; }
    }
  }
  const order = [];
  for (let i = 0; i < pairs.length; i += 2) order.push(i);
  order.sort((x, y) => pairs[x] - pairs[y]);
  const opp = e === L ? R : L;
  for (const i of order) {
    const o = pairs[i], c = pairs[i + 1];
    let found = -1;
    for (let k = o + 1; k < c; k++) {
      const d = strongOf(t[k]);
      if (d === e) { found = e; break; }
      if (d === opp) found = opp;
    }
    if (found < 0) continue;   // no strong type inside: the brackets stay neutral
    let to = e;
    if (found === opp) {
      let before = sos;
      for (let k = o - 1; k >= 0; k--) { const d = strongOf(t[k]); if (d >= 0) { before = d; break; } }
      to = before === opp ? opp : e;
    }
    t[o] = to; t[c] = to;
    // the nonspacing marks after each bracket (W1 made them ON) take its new type
    for (const b of [o, c]) for (let k = b + 1; k < m && classes[idx ? idx[k] : k] === NSM; k++) t[k] = to;
  }
  // N1, N2: a run of neutrals between two strong types of one direction takes it; else the embedding direction
  for (let k = 0; k < m;) {
    if (!NI[t[k]]) { k++; continue; }
    let j = k;
    while (j < m && NI[t[j]]) j++;
    const before = k ? strongOf(t[k - 1]) : sos, after = j < m ? strongOf(t[j]) : eos;
    for (let x = k, v = before === after ? before : e; x < j; x++) t[x] = v;
    k = j;
  }
  // I1, I2
  for (let k = 0; k < m; k++) {
    const c = t[k];
    levels[idx ? idx[k] : k] = level & 1 ? (c === L || c === EN || c === AN ? level + 1 : level) : c === R ? level + 1 : c === AN || c === EN ? level + 2 : level;
  }
  return levels;
}

/**
 * L1 for one line [from, to) of a paragraph: a segment or paragraph separator, the whitespace and isolate formatting
 * characters before it, and those at the line's end, take the paragraph's level (characters X9 removed are passed
 * over, and keep -1). A stretch laid out on its own (ISO) is not one of them: it stands for an isolate's initiator, its
 * content and its PDI, and only the PDI, which is never drawn, would take the paragraph's level; where the content is
 * drawn follows the initiator's level, which L1 leaves as it was (GNU FriBidi's library, the content between LRI and PDI
 * at a line's end: S378). Changes `levels` in place.
 */
export function lineLevels(classes, levels, level, from = 0, to = classes.length) {
  const ws = (c) => c === WS || c === LRI || c === RLI || c === FSI || c === PDI;
  let trailing = true;
  for (let i = to - 1; i >= from; i--) {
    const c = classes[i];
    if (levels[i] < 0) continue;
    if (c === S || c === B) { levels[i] = level; trailing = true; continue; }
    if (trailing && ws(c)) { levels[i] = level; continue; }
    trailing = false;
  }
  return levels;
}

/**
 * L2: the indices of [from, to) in visual order, left to right: from the highest level to the lowest odd one, every run
 * at that level or higher reversed. Characters at level -1 (X9) are left out.
 */
export function visualOrder(levels, from = 0, to = levels.length) {
  const out = [];
  let hi = -1, lo = 127;
  for (let i = from; i < to; i++) { const v = levels[i]; if (v < 0) continue; out.push(i); if (v > hi) hi = v; if (v < lo) lo = v; }
  if (lo % 2 === 0) lo++;
  for (let v = hi; v >= lo; v--) {
    for (let k = 0; k < out.length;) {
      if (levels[out[k]] < v) { k++; continue; }
      let j = k;
      while (j < out.length && levels[out[j]] >= v) j++;
      for (let a = k, b = j - 1; a < b; a++, b--) { const x = out[a]; out[a] = out[b]; out[b] = x; }
      k = j;
    }
  }
  return out;
}
