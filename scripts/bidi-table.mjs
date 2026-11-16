#!/usr/bin/env node
// scripts/bidi-table.mjs — writes src/bidi-table.mjs, what the reader's Unicode Bidirectional Algorithm (src/bidi.mjs)
// needs to know of each code point, from the Unicode Character Database, version 17.0.0: its Bidi_Class
// (DerivedBidiClass.txt, checked against UnicodeData.txt), the paired brackets (BidiBrackets.txt, with the canonical
// equivalents UnicodeData.txt gives two of them) and the mirrored glyphs (BidiMirroring.txt).
//
//   for f in extracted/DerivedBidiClass.txt UnicodeData.txt BidiBrackets.txt BidiMirroring.txt BidiCharacterTest.txt; do
//     curl -sS --fail -o "ucd/${f##*/}" "https://www.unicode.org/Public/17.0.0/ucd/$f"; done
//   node scripts/bidi-table.mjs ucd            # writes src/bidi-table.mjs from the files in the folder ucd
//   node scripts/bidi-table.mjs ucd --check    # exit 1 when src/bidi-table.mjs is not what it writes
//
// Each source is pinned: its version (VERSION) and its sha256 (SOURCES). Another file is refused, so the table cannot
// change without these lines changing in this script; to move to a later version, change them, and run it again.
// BidiCharacterTest.txt, the conformance test, is pinned here too, for the test that reads it (test/bidi.test.mjs).
//
// DerivedBidiClass.txt lists a code point when its value is not what its header's @missing lines give it (L, but R, AL
// or ET in the blocks they name); the defaults are applied first, in the file's order, then the listed values, and the
// count of each class is checked against the "Total code points" the file states for it. Every code point UnicodeData.txt
// lists (its ranges too) must have the class it gives there.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '17.0.0';
const BASE = `https://www.unicode.org/Public/${VERSION}/ucd/`;
/** Each source: where it is published, and its sha256. */
export const SOURCES = Object.freeze({
  'DerivedBidiClass.txt': { url: `${BASE}extracted/DerivedBidiClass.txt`, sha256: '4867b4b7f0731ed1bfcd34cc6251211ff1542541fce0734b6fbda139ee80b3a4' },
  'UnicodeData.txt': { url: `${BASE}UnicodeData.txt`, sha256: '2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c' },
  'BidiBrackets.txt': { url: `${BASE}BidiBrackets.txt`, sha256: 'dadbaf38a0d0246e5b805bf8725cb81b7c621f93d030595635f5ba2c2f179428' },
  'BidiMirroring.txt': { url: `${BASE}BidiMirroring.txt`, sha256: 'a2f16fb873ab4fcdf3221cb1a8a85a134ddd6ed03603181823ff5206af3741ce' },
});
/** The conformance test, read by test/bidi.test.mjs (not by this script). */
export const TEST_SOURCE = Object.freeze({ name: 'BidiCharacterTest.txt', url: `${BASE}BidiCharacterTest.txt`, sha256: 'a3e6e905ab5afbe318a96df5401d0372a04cd73ef139ab5e3cf0ae241c255488' });

/** The classes, in the order of their numbers in the table (src/bidi.mjs names them the same way). */
export const CLASSES = Object.freeze(['L', 'R', 'AL', 'EN', 'ES', 'ET', 'AN', 'CS', 'NSM', 'BN', 'B', 'S', 'WS', 'ON', 'LRE', 'LRO', 'RLE', 'RLO', 'PDF', 'LRI', 'RLI', 'FSI', 'PDI']);
const LONG = new Map(Object.entries({
  Left_To_Right: 'L', Right_To_Left: 'R', Arabic_Letter: 'AL', European_Number: 'EN', European_Separator: 'ES', European_Terminator: 'ET',
  Arabic_Number: 'AN', Common_Separator: 'CS', Nonspacing_Mark: 'NSM', Boundary_Neutral: 'BN', Paragraph_Separator: 'B', Segment_Separator: 'S',
  White_Space: 'WS', Other_Neutral: 'ON', Left_To_Right_Embedding: 'LRE', Left_To_Right_Override: 'LRO', Right_To_Left_Embedding: 'RLE',
  Right_To_Left_Override: 'RLO', Pop_Directional_Format: 'PDF', Left_To_Right_Isolate: 'LRI', Right_To_Left_Isolate: 'RLI',
  First_Strong_Isolate: 'FSI', Pop_Directional_Isolate: 'PDI',
}));

/** A source's bytes, from the folder: refused unless they are the pinned file. */
export function readPinned(dir, name, pin = SOURCES[name] ?? (name === TEST_SOURCE.name ? TEST_SOURCE : null)) {
  if (!pin) throw new Error(`${name} is not a source this script knows`);
  const file = path.join(dir, name);
  let bytes;
  try { bytes = readFileSync(file); } catch (e) { throw new Error(`${file}: cannot be read (${e.code ?? e.message}); fetch it from ${pin.url}`); }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== pin.sha256) throw new Error(`${file}: its sha256 is ${sha256}, not the pinned ${pin.sha256} (${name} ${VERSION}, ${pin.url})`);
  const text = bytes.toString('utf8');
  const first = text.slice(0, text.indexOf('\n'));
  const want = name === 'UnicodeData.txt' ? null : `# ${name.replace('.txt', '')}-${VERSION}.txt`;
  if (want && first !== want) throw new Error(`${file}: its first line is ${JSON.stringify(first)}, not ${JSON.stringify(want)}`);
  return { text, sha256, lines: text.split('\n') };
}

const range = (s, where) => {
  const m = /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?$/.exec(s.trim());
  if (!m) throw new Error(`${where}: ${JSON.stringify(s)} is not a code point or a range`);
  const a = parseInt(m[1], 16), b = m[2] ? parseInt(m[2], 16) : a;
  if (b < a || b > 0x10ffff) throw new Error(`${where}: ${s} is not a range of code points`);
  return [a, b];
};

/** Each code point's class (an index into CLASSES), from DerivedBidiClass.txt: the @missing defaults in the file's
 *  order, then the listed values; checked against the totals the file states. */
export function classesOf(lines) {
  const v = new Uint8Array(0x110000).fill(255);
  const totals = new Map();
  let section = null;
  lines.forEach((raw, i) => {
    const where = `DerivedBidiClass.txt line ${i + 1}`;
    const missing = /^# @missing: ([0-9A-F.]+); (\w+)$/.exec(raw);
    if (missing) {
      const [a, b] = range(missing[1], where), c = LONG.get(missing[2]);
      if (!c) throw new Error(`${where}: no class ${missing[2]}`);
      v.fill(CLASSES.indexOf(c), a, b + 1);
      return;
    }
    const head = /^# Bidi_Class=(\w+)$/.exec(raw);
    if (head) { section = LONG.get(head[1]); if (!section) throw new Error(`${where}: no class ${head[1]}`); return; }
    const total = /^# Total code points: (\d+)$/.exec(raw);
    if (total) { if (!section) throw new Error(`${where}: a total before any class`); totals.set(section, Number(total[1])); section = null; return; }
    const l = raw.replace(/#.*$/, '').trim();
    if (l === '') return;
    const m = /^([0-9A-F.]+)\s*;\s*(\w+)$/.exec(l);
    if (!m || !CLASSES.includes(m[2])) throw new Error(`${where}: not "<code point>[..<code point>] ; <class>": ${JSON.stringify(raw)}`);
    if (section !== m[2]) throw new Error(`${where}: ${m[2]} listed under ${section}`);
    const [a, b] = range(m[1], where);
    v.fill(CLASSES.indexOf(m[2]), a, b + 1);
  });
  if (v.includes(255)) throw new Error(`DerivedBidiClass.txt: U+${v.indexOf(255).toString(16)} has no class (no @missing line covers it)`);
  const counts = new Map(CLASSES.map((c) => [c, 0]));
  for (const c of v) counts.set(CLASSES[c], counts.get(CLASSES[c]) + 1);
  for (const c of CLASSES) {
    if (totals.get(c) !== counts.get(c)) throw new Error(`DerivedBidiClass.txt: ${counts.get(c)} code points have the class ${c}, the file says ${totals.get(c)}`);
  }
  return v;
}

/** UnicodeData.txt's code points (ranges given by <..., First> and <..., Last>): [first, last, class, decomposition]. */
export function unicodeData(lines) {
  const out = [];
  let first = null;
  lines.forEach((raw, i) => {
    if (raw === '') return;
    const f = raw.split(';');
    if (f.length !== 15) throw new Error(`UnicodeData.txt line ${i + 1}: ${f.length} fields, not 15`);
    const cp = parseInt(f[0], 16);
    if (f[1].endsWith(', First>')) { first = cp; return; }
    out.push([f[1].endsWith(', Last>') ? first : cp, cp, f[4], f[5]]);
    first = null;
  });
  return out;
}

/** The paired brackets: [opening, closing] each, from BidiBrackets.txt; each of class ON. */
export function bracketsOf(lines, classes) {
  const open = new Map(), close = new Map();
  lines.forEach((raw, i) => {
    const l = raw.replace(/#.*$/, '').trim();
    if (l === '') return;
    const m = /^([0-9A-F]{4,6}); ([0-9A-F]{4,6}); ([oc])$/.exec(l);
    if (!m) throw new Error(`BidiBrackets.txt line ${i + 1}: not "<code point>; <code point>; o|c": ${JSON.stringify(raw)}`);
    const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
    if (CLASSES[classes[a]] !== 'ON') throw new Error(`BidiBrackets.txt line ${i + 1}: U+${m[1]} is ${CLASSES[classes[a]]}, not ON`);
    (m[3] === 'o' ? open : close).set(a, b);
  });
  const pairs = [];
  for (const [a, b] of open) {
    if (close.get(b) !== a) throw new Error(`BidiBrackets.txt: U+${a.toString(16)} opens U+${b.toString(16)}, which does not close it`);
    pairs.push(a, b);
  }
  if (pairs.length !== 2 * close.size) throw new Error('BidiBrackets.txt: the closing brackets are not the opening ones\' pairs');
  return pairs;
}

/** [code point, mirrored glyph] each, from BidiMirroring.txt. */
export function mirrorsOf(lines) {
  const out = [];
  lines.forEach((raw, i) => {
    const l = raw.replace(/#.*$/, '').trim();
    if (l === '') return;
    const m = /^([0-9A-F]{4,6}); ([0-9A-F]{4,6})$/.exec(l);
    if (!m) throw new Error(`BidiMirroring.txt line ${i + 1}: not "<code point>; <code point>": ${JSON.stringify(raw)}`);
    out.push(parseInt(m[1], 16), parseInt(m[2], 16));
  });
  return out;
}

/** The classes as ranges [first, last, class, ...] of the code points that are not L, merged where the class goes on. */
export function classRanges(classes) {
  const out = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    const c = classes[cp];
    if (c === 0) continue;
    if (out.length && out[out.length - 2] === cp - 1 && out[out.length - 1] === c) out[out.length - 2] = cp;
    else out.push(cp, cp, c);
  }
  return out;
}

/** Everything the table holds, from the sources in `dir`. */
export function build(dir) {
  const derived = readPinned(dir, 'DerivedBidiClass.txt'), data = readPinned(dir, 'UnicodeData.txt');
  const brackets = readPinned(dir, 'BidiBrackets.txt'), mirroring = readPinned(dir, 'BidiMirroring.txt');
  const classes = classesOf(derived.lines);
  const ud = unicodeData(data.lines);
  for (const [a, b, c] of ud) for (let cp = a; cp <= b; cp++) if (CLASSES[classes[cp]] !== c) throw new Error(`U+${cp.toString(16)}: DerivedBidiClass.txt gives ${CLASSES[classes[cp]]}, UnicodeData.txt ${c}`);
  const pairs = bracketsOf(brackets.lines, classes);
  // a bracket's canonical equivalent (BD16 matches brackets by it): its decomposition, when that is one code point alone
  const isBracket = new Set(pairs);
  const equivalents = [];
  for (const [a, b, , d] of ud) if (a === b && isBracket.has(a) && /^[0-9A-F]{4,6}$/.test(d)) equivalents.push(a, parseInt(d, 16));
  return { derived, data, brackets, mirroring, classes, ranges: classRanges(classes), pairs, equivalents, mirrors: mirrorsOf(mirroring.lines) };
}

const hex = (n) => `0x${n.toString(16).padStart(4, '0')}`;
const rows = (xs, per) => { const out = []; for (let i = 0; i < xs.length; i += per) out.push(`  ${xs.slice(i, i + per).map(hex).join(', ')},`); return out.join('\n'); };
/** LICENSE-UNICODE, which the package ships beside the tables: the Unicode License v3 asks that its notice go with
 *  every copy of the data, so the table carries it too. */
export const NOTICE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'LICENSE-UNICODE');

/** The module's text; `notice` is LICENSE-UNICODE's text. */
export function tableModule(t, notice = readFileSync(NOTICE_FILE, 'utf8')) {
  const licence = notice.trimEnd().split('\n').map((l) => (l === '' ? '//' : `// ${l}`)).join('\n');
  const sources = Object.entries(SOURCES).map(([name, s]) => `//   ${name}  ${s.url}\n//     sha256 ${t[{ 'DerivedBidiClass.txt': 'derived', 'UnicodeData.txt': 'data', 'BidiBrackets.txt': 'brackets', 'BidiMirroring.txt': 'mirroring' }[name]].sha256}`).join('\n');
  return `// src/bidi-table.mjs — WRITTEN BY scripts/bidi-table.mjs; do not edit it by hand: change the script, and run it again.
//
// What src/bidi.mjs, the Unicode Bidirectional Algorithm, needs to know of each code point: its Bidi_Class, as ranges
// [first, last, class, ...] of the code points whose class is not L (the class is an index into CLASSES); the paired
// brackets [opening, closing, ...]; the two brackets' canonical equivalents [code point, equivalent, ...]; and the
// mirrored glyphs [code point, mirror, ...].
//
// From the Unicode Character Database, version ${VERSION}:
${sources}
//
// Their licence (LICENSE-UNICODE, which the package ships beside this table):
//
${licence}
export const UNICODE_VERSION = '${VERSION}';
export const SOURCE_SHA256 = Object.freeze(${JSON.stringify(Object.fromEntries(Object.keys(SOURCES).map((n) => [n, SOURCES[n].sha256])))});
export const CLASSES = Object.freeze(${JSON.stringify(CLASSES)});
export const CLASS_RANGES = Object.freeze([
${rows(t.ranges, 12)}
]);
export const BRACKETS = Object.freeze([
${rows(t.pairs, 12)}
]);
export const BRACKET_EQUIVALENTS = Object.freeze([
${rows(t.equivalents, 12)}
]);
export const MIRRORS = Object.freeze([
${rows(t.mirrors, 12)}
]);
`;
}

function main(argv) {
  const args = argv.filter((a) => a !== '--check'), check = argv.includes('--check');
  if (args.length !== 1 || argv.length - args.length > 1) {
    process.stderr.write(`usage: node scripts/bidi-table.mjs <folder holding ${Object.keys(SOURCES).join(', ')}> [--check] (given: ${JSON.stringify(argv)})\n`);
    return 2;
  }
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'bidi-table.mjs');
  let t;
  try { t = build(args[0]); } catch (e) { process.stderr.write(`bidi-table: ${e.message}\n`); return 1; }
  const text = tableModule(t);
  const said = `${t.ranges.length / 3} ranges of classes, ${t.pairs.length / 2} bracket pairs, ${t.equivalents.length / 2} equivalents, ${t.mirrors.length / 2} mirrors`;
  if (check) {
    let now = null;
    try { now = readFileSync(out, 'utf8'); } catch {}
    if (now !== text) { process.stderr.write(`bidi-table: ${out} is not what ${args[0]} gives; run without --check to write it\n`); return 1; }
    process.stderr.write(`bidi-table: ${out} is what ${args[0]} gives (${said})\n`);
    return 0;
  }
  writeFileSync(out, text);
  process.stderr.write(`bidi-table: wrote ${out} (${said}, Unicode ${VERSION})\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
