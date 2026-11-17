// test/uba-reference.mjs — the tests' own reference of the Unicode Bidirectional Algorithm (UAX #9, version 17.0.0), not
// a test file (node --test runs only *.test.mjs here): round 4's check's probes/uba.py (written for that check from UAX
// #9's text, sections 3.3 and 3.4, independently of src/bidi.mjs and of GNU FriBidi), ported to JavaScript in round 6
// (Y3 (g)). Its data is src/bidi-table.mjs's (each class, bracket pair, canonical equivalent and mirror, which
// test/bidi.test.mjs checks against the pinned sources), looked up by its own code.
//
// What it implements, over one paragraph: P2, P3 (isolates skipped, FSI by its own text); X1 to X8 (the directional
// status stack, depth 125, the overflow counters); X9 (RLE, LRE, RLO, LRO, PDF and BN removed: level null); X10 (level
// runs, isolating run sequences, sos and eos); W1 to W7; N0 with BD16 (a stack of 63, canonical equivalents, the marks
// after a bracket); N1, N2; I1, I2; then for a line, L1 (by the original classes, removed characters passed over) and
// L2. test/bidi.test.mjs checks it on BidiCharacterTest.txt (every case, those with explicit formatting characters too)
// and, where the folder holds it, BidiTest.txt.
//
// What it is for: the tests compare the reader's lines with GNU FriBidi's library's, and FriBidi 1.0.18 differs from
// UAX #9 on some paragraphs (round 5's check: brackets around a nonspacing mark, brackets paired by canonical
// equivalence). A line on which the two differ is laid out by this reference too (lineAsFribidi: in FriBidi's own
// form), and the reader is right there when it gives what this reference gives.
import { BRACKETS, BRACKET_EQUIVALENTS, CLASSES, CLASS_RANGES, MIRRORS } from '../src/bidi-table.mjs';

const T = Object.fromEntries(CLASSES.map((name, i) => [name, i]));
export const { L, R, AL, EN, ES, ET, AN, CS, NSM, BN, B, S, WS, ON, LRE, LRO, RLE, RLO, PDF, LRI, RLI, FSI, PDI } = T;
const MAX_DEPTH = 125;
const ISOLATE_INIT = new Set([LRI, RLI, FSI]);
const REMOVED = new Set([RLE, LRE, RLO, LRO, PDF, BN]);
const NI = new Set([B, S, WS, ON, LRI, RLI, FSI, PDI]);

/** A code point's Bidi_Class (an index into CLASSES): a binary search of the table's ranges, L where none holds it. */
export function classOf(cp) {
  let lo = 0, hi = CLASS_RANGES.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < CLASS_RANGES[3 * mid]) hi = mid - 1;
    else if (cp > CLASS_RANGES[3 * mid + 1]) lo = mid + 1;
    else return CLASS_RANGES[3 * mid + 2];
  }
  return L;
}

const KIND = new Map(), PAIR = new Map(), CANON = new Map(), MIRROR = new Map();
for (let i = 0; i < BRACKETS.length; i += 2) {
  KIND.set(BRACKETS[i], 'o'); KIND.set(BRACKETS[i + 1], 'c');
  PAIR.set(BRACKETS[i], BRACKETS[i + 1]); PAIR.set(BRACKETS[i + 1], BRACKETS[i]);
}
for (let i = 0; i < BRACKET_EQUIVALENTS.length; i += 2) CANON.set(BRACKET_EQUIVALENTS[i], BRACKET_EQUIVALENTS[i + 1]);
for (let i = 0; i < MIRRORS.length; i += 2) MIRROR.set(MIRRORS[i], MIRRORS[i + 1]);
const canon = (cp) => CANON.get(cp) ?? cp;
/** Bidi_Mirroring_Glyph, or the code point itself. */
export const mirrorOf = (cp) => MIRROR.get(cp) ?? cp;

/** BD9: the index of the PDI that matches the isolate initiator at i (types: the original classes), or -1. */
function matchingPdi(types, i, end) {
  let depth = 1;
  for (let k = i + 1; k < end; k++) {
    const t = types[k];
    if (ISOLATE_INIT.has(t)) depth++;
    else if (t === PDI) { if (--depth === 0) return k; }
    else if (t === B) return -1;
  }
  return -1;
}

/** P2, P3 over [start, end): 0 or 1 by the first L, R or AL outside an isolate; -1 when there is none. */
function firstStrongLevel(types, start, end) {
  for (let k = start; k < end;) {
    const t = types[k];
    if (t === L) return 0;
    if (t === R || t === AL) return 1;
    if (ISOLATE_INIT.has(t)) {
      const m = matchingPdi(types, k, end);
      if (m < 0) return -1;
      k = m + 1;
      continue;
    }
    if (t === B) return -1;
    k++;
  }
  return -1;
}

/** A paragraph's level by P2 and P3 (0 when it has no strong character outside an isolate). */
export function paragraphLevel(types) { const v = firstStrongLevel(types, 0, types.length); return v < 0 ? 0 : v; }

const greaterOdd = (v) => (v % 2 === 0 ? v + 1 : v + 2), greaterEven = (v) => (v % 2 === 0 ? v + 2 : v + 1);

/** The resolved levels of one paragraph (code points `cps`, original classes `types`, level `para`): an array of
 *  numbers, null where X9 removed the character. */
export function resolve(cps, types, para) {
  const n = cps.length, t = [...types], orig = types, levels = new Array(n).fill(null);
  // X1 to X8
  const stack = [{ level: para, override: 'N', isolate: false }];
  let overIso = 0, overEmb = 0, validIso = 0;
  const overridden = (i, top) => { if (top.override !== 'N') t[i] = top.override === 'L' ? L : R; };
  for (let i = 0; i < n; i++) {
    const c = orig[i], top = stack[stack.length - 1];
    if (c === RLE || c === LRE || c === RLO || c === LRO) {
      const level = c === RLE || c === RLO ? greaterOdd(top.level) : greaterEven(top.level);
      if (level <= MAX_DEPTH && overIso === 0 && overEmb === 0) stack.push({ level, override: c === RLO ? 'R' : c === LRO ? 'L' : 'N', isolate: false });
      else if (overIso === 0) overEmb++;
    } else if (ISOLATE_INIT.has(c)) {
      let kind = c;
      if (c === FSI) { const m = matchingPdi(orig, i, n); kind = firstStrongLevel(orig, i + 1, m >= 0 ? m : n) === 1 ? RLI : LRI; }
      levels[i] = top.level;
      overridden(i, top);
      const level = kind === RLI ? greaterOdd(top.level) : greaterEven(top.level);
      if (level <= MAX_DEPTH && overIso === 0 && overEmb === 0) { validIso++; stack.push({ level, override: 'N', isolate: true }); }
      else overIso++;
    } else if (c === PDI) {
      if (overIso > 0) overIso--;
      else if (validIso > 0) {
        overEmb = 0;
        while (!stack[stack.length - 1].isolate) stack.pop();
        stack.pop();
        validIso--;
      }
      const now = stack[stack.length - 1];
      levels[i] = now.level;
      overridden(i, now);
    } else if (c === PDF) {
      if (overIso > 0) { /* nothing */ } else if (overEmb > 0) overEmb--;
      else if (!top.isolate && stack.length >= 2) stack.pop();
    } else if (c === B) levels[i] = para;
    else if (c !== BN) { levels[i] = top.level; overridden(i, top); }
  }
  // X9: what is removed keeps level null; X10: the level runs of what is kept, then the isolating run sequences
  const kept = [];
  for (let i = 0; i < n; i++) if (!REMOVED.has(orig[i])) kept.push(i);
  const runs = [];
  for (const i of kept) {
    const r = runs[runs.length - 1];
    if (r && levels[r[r.length - 1]] === levels[i]) r.push(i); else runs.push([i]);
  }
  const match = new Map();
  for (const i of kept) if (ISOLATE_INIT.has(orig[i])) { const m = matchingPdi(orig, i, n); if (m >= 0) match.set(i, m); }
  const matchedPdis = new Set(match.values()), runOfStart = new Map(runs.map((r, k) => [r[0], k]));
  const seqs = [];
  for (const r of runs) {
    if (matchedPdis.has(r[0])) continue;
    const seq = [...r];
    while (ISOLATE_INIT.has(orig[seq[seq.length - 1]]) && match.has(seq[seq.length - 1])) {
      const k = runOfStart.get(match.get(seq[seq.length - 1]));
      if (k === undefined) break;
      seq.push(...runs[k]);
    }
    seqs.push(seq);
  }
  const posInKept = new Map(kept.map((i, k) => [i, k]));
  for (const seq of seqs) {
    const lev = levels[seq[0]], k0 = posInKept.get(seq[0]), k1 = posInKept.get(seq[seq.length - 1]);
    const prev = k0 > 0 ? levels[kept[k0 - 1]] : para;
    const next = ISOLATE_INIT.has(orig[seq[seq.length - 1]]) || k1 + 1 >= kept.length ? para : levels[kept[k1 + 1]];
    resolveSequence(cps, orig, t, seq, lev, Math.max(lev, prev) % 2 ? R : L, Math.max(lev, next) % 2 ? R : L);
  }
  // I1, I2
  for (const i of kept) {
    const lv = levels[i], c = t[i];
    if (lv % 2 === 0) { if (c === R) levels[i] = lv + 1; else if (c === AN || c === EN) levels[i] = lv + 2; }
    else if (c === L || c === EN || c === AN) levels[i] = lv + 1;
  }
  return levels;
}

/** W1 to W7, N0 to N2 over one isolating run sequence (its indices `seq`, at level `lev`), in `t`. */
function resolveSequence(cps, orig, t, seq, lev, sos, eos) {
  const m = seq.length, at = (k) => t[seq[k]], set = (k, v) => { t[seq[k]] = v; };
  // W1
  for (let k = 0; k < m; k++) {
    if (at(k) !== NSM) continue;
    if (k === 0) set(k, sos);
    else set(k, ISOLATE_INIT.has(orig[seq[k - 1]]) || orig[seq[k - 1]] === PDI ? ON : at(k - 1));
  }
  // W2
  for (let k = 0, last = sos; k < m; k++) {
    const c = at(k);
    if (c === L || c === R || c === AL) last = c;
    else if (c === EN && last === AL) set(k, AN);
  }
  // W3
  for (let k = 0; k < m; k++) if (at(k) === AL) set(k, R);
  // W4
  for (let k = 1; k < m - 1; k++) {
    const c = at(k), a = at(k - 1), b = at(k + 1);
    if (c === ES && a === EN && b === EN) set(k, EN);
    else if (c === CS && a === EN && b === EN) set(k, EN);
    else if (c === CS && a === AN && b === AN) set(k, AN);
  }
  // W5
  for (let k = 0; k < m;) {
    if (at(k) !== ET) { k++; continue; }
    let j = k;
    while (j < m && at(j) === ET) j++;
    if ((k > 0 && at(k - 1) === EN) || (j < m && at(j) === EN)) for (let x = k; x < j; x++) set(x, EN);
    k = j;
  }
  // W6
  for (let k = 0; k < m; k++) if (at(k) === ES || at(k) === ET || at(k) === CS) set(k, ON);
  // W7
  for (let k = 0, last = sos; k < m; k++) {
    const c = at(k);
    if (c === L || c === R) last = c;
    else if (c === EN && last === L) set(k, L);
  }
  // N0: BD16, then each pair in the order of its opening bracket
  const e = lev % 2 ? R : L, pairs = [], stack = [];
  for (let k = 0; k < m; k++) {
    if (at(k) !== ON) continue;
    const cp = cps[seq[k]], kind = KIND.get(cp);
    if (kind === 'o') {
      if (stack.length === 63) break;
      stack.push([canon(PAIR.get(cp)), k]);
    } else if (kind === 'c') {
      const c = canon(cp);
      for (let j = stack.length - 1; j >= 0; j--) if (stack[j][0] === c) { pairs.push([stack[j][1], k]); stack.length = j; break; }
    }
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const strong = (x) => (x === L ? L : x === R || x === EN || x === AN ? R : -1);
  for (const [o, c] of pairs) {
    let found = -1;
    for (let k = o + 1; k < c; k++) { const d = strong(at(k)); if (d === e) { found = e; break; } if (d >= 0) found = d; }
    if (found < 0) continue;
    let to = e;
    if (found !== e) {
      let before = sos;
      for (let k = o - 1; k >= 0; k--) { const d = strong(at(k)); if (d >= 0) { before = d; break; } }
      to = before === found ? found : e;
    }
    for (const b of [o, c]) {
      set(b, to);
      for (let k = b + 1; k < m && orig[seq[k]] === NSM; k++) set(k, to);
    }
  }
  // N1, N2
  for (let k = 0; k < m;) {
    if (!NI.has(at(k))) { k++; continue; }
    let j = k;
    while (j < m && NI.has(at(j))) j++;
    const before = k > 0 ? strong(at(k - 1)) : sos, after = j < m ? strong(at(j)) : eos;
    for (let x = k; x < j; x++) set(x, before === after ? before : e);
    k = j;
  }
}

/** L1 over line [a, b) of a paragraph: a copy of levels[a..b) with S, B, the whitespace and isolate formatting
 *  characters before them, and those at the line's end, at the paragraph's level (what X9 removed passed over). */
export function lineLevels(types, levels, para, a, b) {
  const lv = levels.slice(a, b);
  let trailing = true;
  for (let k = b - a - 1; k >= 0; k--) {
    const c = types[a + k];
    if (lv[k] === null) continue;
    if (c === S || c === B) { lv[k] = para; trailing = true; continue; }
    if (trailing && (c === WS || ISOLATE_INIT.has(c) || c === PDI)) { lv[k] = para; continue; }
    trailing = false;
  }
  return lv;
}

/** L2: the indices of lv (a line's levels, null where removed) in visual order, left to right, the removed left out. */
export function visual(lv) {
  const idx = [];
  for (let k = 0; k < lv.length; k++) if (lv[k] !== null) idx.push(k);
  if (!idx.length) return idx;
  let hi = -1, lo = Infinity;
  for (const k of idx) { hi = Math.max(hi, lv[k]); lo = Math.min(lo, lv[k]); }
  if (lo % 2 === 0) lo++;
  for (let v = hi; v >= lo; v--) {
    for (let k = 0; k < idx.length;) {
      if (lv[idx[k]] < v) { k++; continue; }
      let j = k;
      while (j < idx.length && lv[idx[j]] >= v) j++;
      for (let x = k, y = j - 1; x < y; x++, y--) { const z = idx[x]; idx[x] = idx[y]; idx[y] = z; }
      k = j;
    }
  }
  return idx;
}

/**
 * Lines of one paragraph, each in visual order as test/fribidi-lines.py has GNU FriBidi's library write them, by this
 * reference's levels: { cps, level, lines: [[a, b], ...], drop: [index, ...] } as fribidi-lines.py takes it (code
 * point indices), each line's code points in visual order: L1; a nonspacing mark and those before it at its odd level
 * with the character they follow, kept after it (FriBidi's FRIBIDI_FLAG_REORDER_NSM); L2; a character at an odd level
 * mirrored (L4). The characters X9 removes, and those `drop` names (put in for FriBidi), are left out.
 */
export function linesAsFribidi({ cps, level, lines, drop = [] }) {
  const types = cps.map(classOf), levels = resolve(cps, types, level), gone = new Set(drop);
  return lines.map(([a, b]) => {
    const lv = lineLevels(types, levels, level, a, b);
    // the kept characters of the line, logical order, with their levels
    const items = [];
    for (let k = 0; k < lv.length; k++) if (lv[k] !== null) items.push(k);
    const lev = items.map((k) => lv[k]);
    // each run of nonspacing marks at an odd level, with the character before it at that level, reversed here so that L2
    // leaves the marks after it
    for (let p = items.length - 1; p >= 0; p--) {
      if (!(lev[p] % 2) || types[a + items[p]] !== NSM) continue;
      const end = p, v = lev[p];
      for (p--; p >= 0 && types[a + items[p]] === NSM && lev[p] === v; p--);
      if (p < 0 || lev[p] !== v) p++;
      for (let x = p, y = end; x < y; x++, y--) { const z = items[x]; items[x] = items[y]; items[y] = z; }
    }
    const out = [];
    for (const p of visual(lev)) {
      const i = a + items[p];
      if (!gone.has(i)) out.push(lev[p] % 2 ? mirrorOf(cps[i]) : cps[i]);
    }
    return out;
  });
}
