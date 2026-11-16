#!/usr/bin/env node
// scripts/width-table.mjs — writes src/width-table.mjs, the code points a terminal draws two columns wide, from Unicode's
// EastAsianWidth.txt: those whose East_Asian_Width is W (wide) or F (fullwidth), as merged ranges.
//
//   curl -sS --fail -o EastAsianWidth.txt https://www.unicode.org/Public/17.0.0/ucd/EastAsianWidth.txt
//   node scripts/width-table.mjs EastAsianWidth.txt            # writes src/width-table.mjs
//   node scripts/width-table.mjs EastAsianWidth.txt --check    # exit 1 when src/width-table.mjs is not what it writes
//
// The source is pinned: its version (VERSION) and its sha256 (SHA256). Another file is refused, so the table cannot change
// without these two lines changing in this script; to move to a later version, change both, and run it again.
//
// The file lists every code point whose value is not "N" (ranges for most), and says in its header what the rest get:
// "N", but for the unassigned code points of the CJK ideograph blocks and of planes 2 and 3, which get "W". Those
// defaults are applied here before the listed values, and the script refuses a file whose header does not state them as
// this script reads them. "A" (ambiguous: wide in East Asian contexts only) is not in the table: one column, as most
// terminals draw it by default.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '17.0.0';
export const SOURCE_URL = `https://www.unicode.org/Public/${VERSION}/ucd/EastAsianWidth.txt`;
export const SHA256 = 'ea7ce50f3444a050333448dffef1cadd9325af55cbb764b4a2280faf52170a33';
/** The defaults the header states, each as this script checks it there: [first, last, the header's own line]. */
const DEFAULT_W = [
  [0x3400, 0x4dbf, '#         CJK Unified Ideographs Extension A: U+3400..U+4DBF'],
  [0x4e00, 0x9fff, '#         CJK Unified Ideographs:             U+4E00..U+9FFF'],
  [0xf900, 0xfaff, '#         CJK Compatibility Ideographs:       U+F900..U+FAFF'],
  [0x20000, 0x2fffd, '#         Plane 2:                            U+20000..U+2FFFD'],
  [0x30000, 0x3fffd, '#         Plane 3:                            U+30000..U+3FFFD'],
];
const HEADER_RULES = [
  '#  - All code points, assigned or unassigned, that are not listed',
  '#      explicitly are given the value "N".',
  '#  - The unassigned code points in the following blocks default to "W":',
  '#  - All undesignated code points in Planes 2 and 3, whether inside or',
  '#      outside of allocated blocks, default to "W":',
  '# @missing: 0000..10FFFF; N',
];
const VALUES = new Map([['N', 0], ['Na', 1], ['H', 2], ['A', 3], ['W', 4], ['F', 5]]);

/** The table's source text, from the file's bytes: refused unless it is the pinned file. */
export function readSource(bytes) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== SHA256) throw new Error(`the file's sha256 is ${sha256}, not the pinned ${SHA256} (EastAsianWidth.txt ${VERSION}, ${SOURCE_URL})`);
  const text = bytes.toString('utf8');
  const lines = text.split('\n');
  if (lines[0] !== `# EastAsianWidth-${VERSION}.txt`) throw new Error(`the file's first line is ${JSON.stringify(lines[0])}, not "# EastAsianWidth-${VERSION}.txt"`);
  for (const rule of [...HEADER_RULES, ...DEFAULT_W.map((d) => d[2])]) {
    if (!lines.includes(rule)) throw new Error(`the file's header does not state ${JSON.stringify(rule)}, which this script applies`);
  }
  return { text, sha256, lines };
}

/** [first, last, value] for each data line of the file, in its order. */
export function entriesOf(lines) {
  const out = [];
  lines.forEach((raw, i) => {
    const l = raw.replace(/#.*$/, '').trim();
    if (l === '') return;
    const m = /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*(N|Na|H|A|W|F)$/.exec(l);
    if (!m) throw new Error(`line ${i + 1} is not "<code point>[..<code point>] ; <value>": ${JSON.stringify(raw)}`);
    const first = parseInt(m[1], 16), last = m[2] ? parseInt(m[2], 16) : first;
    if (last < first || last > 0x10ffff) throw new Error(`line ${i + 1}: the range ${m[1]}..${m[2]} is not one`);
    out.push([first, last, m[3]]);
  });
  return out;
}

/** The W and F code points as merged, sorted, inclusive ranges: [first, last, first, last, ...]. */
export function wideRanges(entries) {
  const v = new Uint8Array(0x110000);   // N everywhere, as the header's @missing line says
  for (const [first, last] of DEFAULT_W) v.fill(VALUES.get('W'), first, last + 1);
  for (const [first, last, value] of entries) v.fill(VALUES.get(value), first, last + 1);
  const out = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    const wide = v[cp] === VALUES.get('W') || v[cp] === VALUES.get('F');
    if (!wide) continue;
    if (out.length && out[out.length - 1] === cp - 1) out[out.length - 1] = cp;
    else out.push(cp, cp);
  }
  return out;
}

const hex = (n) => `0x${n.toString(16).padStart(4, '0')}`;

/** The module's text. */
export function tableModule({ lines, sha256 }, ranges) {
  const header = lines.slice(0, 3).map((l) => `//   ${l}`).join('\n');
  const body = [];
  for (let i = 0; i < ranges.length; i += 8) body.push(`  ${ranges.slice(i, i + 8).map(hex).join(', ')},`);
  return `// src/width-table.mjs — WRITTEN BY scripts/width-table.mjs; do not edit it by hand: change the script, and run it again.
//
// The code points a terminal draws two columns wide: East_Asian_Width W (wide) or F (fullwidth), with the defaults the
// file's header states (W for the unassigned code points of the CJK ideograph blocks and of planes 2 and 3), as merged,
// sorted, inclusive ranges [first, last, first, last, ...]. "A" (ambiguous) is not here: one column.
//
// From Unicode's EastAsianWidth.txt, version ${VERSION}:
//   ${SOURCE_URL}
//   sha256 ${sha256}
// whose first lines are
${header}
// For the Unicode terms of use and license, see https://www.unicode.org/terms_of_use.html and
// https://www.unicode.org/license.txt.
export const UNICODE_VERSION = '${VERSION}';
export const SOURCE_URL = '${SOURCE_URL}';
export const SOURCE_SHA256 = '${sha256}';
export const WIDE = Object.freeze([
${body.join('\n')}
]);
`;
}

function main(argv) {
  const args = argv.filter((a) => a !== '--check'), check = argv.includes('--check');
  if (args.length !== 1 || argv.length - args.length > 1) {
    process.stderr.write('usage: node scripts/width-table.mjs <EastAsianWidth.txt> [--check]\n');
    return 2;
  }
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'width-table.mjs');
  let src;
  try { src = readSource(readFileSync(args[0])); } catch (e) { process.stderr.write(`width-table: ${args[0]}: ${e.message}\n`); return 1; }
  const ranges = wideRanges(entriesOf(src.lines));
  const text = tableModule(src, ranges);
  if (check) {
    let now = null;
    try { now = readFileSync(out, 'utf8'); } catch {}
    if (now !== text) { process.stderr.write(`width-table: ${out} is not what ${args[0]} gives; run without --check to write it\n`); return 1; }
    process.stderr.write(`width-table: ${out} is what ${args[0]} gives (${ranges.length / 2} ranges)\n`);
    return 0;
  }
  writeFileSync(out, text);
  process.stderr.write(`width-table: wrote ${out} (${ranges.length / 2} ranges, Unicode ${VERSION})\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
