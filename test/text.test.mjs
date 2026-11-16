// test/text.test.mjs — what of a transcript's text reaches the terminal (src/text.mjs): every control character but the
// new line and the tab made visible; widths by grapheme cluster, with the wide table generated from Unicode's
// EastAsianWidth.txt (src/width-table.mjs); lines cut and wrapped by columns, never inside a cluster; the two right-to-
// left modes (R1), by the terminal. Cluster boundaries are checked against Intl.Segmenter itself, which defines them.
//
// The table's regeneration from its source runs when LTMS_READER_EAW names the pinned EastAsianWidth.txt; without it,
// that one test is skipped and says so.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RTL_MODES, clusterWidth, cut, directionOf, displayOrder, expandTabs, fit, fitParts, isWide, pathUnits, rtlModeOf, visible, visualLine, width, wrap } from '../src/text.mjs';
import { SOURCE_SHA256, SOURCE_URL, UNICODE_VERSION, WIDE } from '../src/width-table.mjs';
import { SHA256, VERSION } from '../scripts/width-table.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEG = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const boundaries = (s) => { const b = new Set([0, s.length]); for (const { index } of SEG.segment(s)) b.add(index); return b; };
const isControl = (cp) => (cp <= 0x1f && cp !== 0x09 && cp !== 0x0a) || (cp >= 0x7f && cp <= 0x9f);
const CC = /[\u0000-\u001f\u007f-\u009f]/;

test('visible: each C0 control but the tab and the new line, DEL and each C1 control, as a visible escape; ESC as ␛', () => {
  for (let cp = 0; cp <= 0xa0; cp++) {
    const c = String.fromCodePoint(cp), v = visible(c);
    if (cp === 0x1b) assert.equal(v, '\u241b', 'ESC');
    else if (isControl(cp)) assert.equal(v, `\\x${cp.toString(16).padStart(2, '0')}`, `U+${cp.toString(16)}`);
    else assert.equal(v, c, `U+${cp.toString(16)} is not a control: unchanged`);
  }
});

test('visible: no code point at all comes out as a control (but the tab and the new line), and a second pass changes nothing', () => {
  let checked = 0;
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const v = visible(String.fromCodePoint(cp));
    if (cp !== 0x09 && cp !== 0x0a) assert.ok(!CC.test(v), `U+${cp.toString(16)} -> ${JSON.stringify(v)}`);
    checked++;
  }
  assert.equal(checked, 0x110000 - 0x800);
  const mixed = 'a\x1b[31mred\x1b[0m\x07\u009b2J\u0085\x1b]52;c;SGVsbG8=\x07\x1b]0;title\x1b\\\r\n\tend\u202e';
  assert.equal(visible(mixed), 'a\u241b[31mred\u241b[0m\\x07\\x9b2J\\x85\u241b]52;c;SGVsbG8=\\x07\u241b]0;title\u241b\\\\x0d\n\tend\\u202e', 'the override at its end shown too (R.F5)');
  assert.equal(visible(visible(mixed)), visible(mixed));
  assert.equal(visible(42), '42', 'a value that is not a string is written as one');
});

test('width: by grapheme cluster; marks, niqqud and cantillation take none; wide characters and emoji take two', () => {
  const known = [
    ['', 0], ['abc', 3], [' ', 1],
    ['\u05d1\u05b0\u05bc\u05e8\u05b5\u05d0\u05e9\u05c1\u05b4\u05d9\u05ea', 6],   // בְּרֵאשִׁית: 6 clusters (the design's measurement)
    ['\u05d5\u05b7\u05bd\u05d9\u05b0\u05d4\u05b4\u05d9\u05be\u05e2\u05b6\u05a5\u05e8\u05b6\u05d1', 8],   // וַֽיְהִי־עֶ֥רֶב: 7 letters and a maqaf, with a meteg and a merkha
    ['e\u0301', 1], ['\u05b0', 0], ['\u200b', 0], ['\u00ad', 1], ['a\u200db', 2],
    ['\u4e2d\u6587', 4], ['\uff21', 2], ['\u3000', 2], ['\ud55c\uad6d\uc5b4', 6], ['\u1100\u1161', 2],
    ['\u{1f600}', 2], ['\u{1f44d}\u{1f3fd}', 2], ['\u{1f468}\u200d\u{1f469}\u200d\u{1f467}', 2], ['\u{1f1ee}\u{1f1f1}', 2],
    ['\u2764\ufe0f', 2], ['\u2764', 1], ['1\ufe0f\u20e3', 2], ['a\ufe0f', 1], ['\u2026', 1], ['\u{20000}', 2], ['\u{2fffd}', 2],
  ];
  for (const [s, w] of known) assert.equal(width(s), w, `${JSON.stringify(s)} (${[...s].map((c) => c.codePointAt(0).toString(16)).join(' ')})`);
  assert.equal([...SEG.segment('\u05d1\u05b0\u05bc\u05e8\u05b5\u05d0\u05e9\u05c1\u05b4\u05d9\u05ea')].length, 6);
});

const SAMPLES = [
  'plain ascii text, nothing else',
  '\u05d1\u05b0\u05bc\u05e8\u05b5\u05d0\u05e9\u05c1\u05b4\u05d9\u05ea \u05d1\u05b8\u05bc\u05e8\u05b8\u05d0 (12) [src/\u05de\u05d5\u05d3\u05d5\u05dc.ts] path/to/file 3.14',
  '\u4e2d\u6587\u6df7\u5408 mixed \u{1f600} emoji \u{1f468}\u200d\u{1f469}\u200d\u{1f467} and flags \u{1f1ee}\u{1f1f1}\u{1f1fa}\u{1f1f8}',
  'e\u0301e\u0301e\u0301 \u2764\ufe0f 1\ufe0f\u20e3 \uff21\uff22\uff23 \ud55c\uad6d\uc5b4',
  '\u0915\u094d\u0937 \u0645\u064e\u0631\u0652\u062d\u064e\u0628\u064b\u0627 \u0643\u0650\u062a\u064e\u0627\u0628 abc',
];

test('cut: the longest run of whole clusters within the columns; never inside a cluster; the rest follows', () => {
  for (const s of SAMPLES) {
    const b = boundaries(s), total = width(s);
    for (let n = 0; n <= total + 2; n++) {
      const r = cut(s, n);
      assert.equal(r.text + r.rest, s);
      assert.ok(b.has(r.text.length), `${JSON.stringify(s)} cut at ${n} columns ends inside a cluster (at ${r.text.length})`);
      assert.equal(r.width, width(r.text));
      assert.ok(r.width <= n, `${r.width} > ${n}`);
      if (r.rest !== '') {
        const next = [...SEG.segment(r.rest)][0].segment;
        assert.ok(r.width + width(next) > n, `${JSON.stringify(s)} at ${n}: the next cluster would have fit`);
      }
    }
  }
});

test('fit: within the columns, with … where it was cut', () => {
  for (const s of SAMPLES) {
    const total = width(s);
    for (let n = 1; n <= total + 2; n++) {
      const f = fit(s, n);
      assert.ok(width(f) <= n, `${JSON.stringify(f)} is ${width(f)} wide, over ${n}`);
      if (total <= n) assert.equal(f, s);
      else { assert.ok(f.endsWith('\u2026')); assert.ok(s.startsWith(f.slice(0, -1))); assert.ok(boundaries(s).has(f.length - 1)); }
    }
  }
  assert.equal(fit('abc', 0), '');
});

test('wrap: lines of at most the columns, cut between clusters, that join back to the text', () => {
  for (const s of SAMPLES) {
    const b = boundaries(s);
    for (const n of [1, 2, 3, 5, 8, 13, 40, 200]) {
      const lines = wrap(s, n);
      assert.equal(lines.join(''), s);
      let at = 0;
      for (const l of lines) {
        assert.ok(width(l) <= n || [...SEG.segment(l)].length === 1, `${JSON.stringify(l)} is ${width(l)} wide, over ${n}`);
        assert.ok(l.length > 0);
        at += l.length;
        assert.ok(b.has(at), `a line ends inside a cluster (at ${at})`);
      }
    }
  }
  assert.deepEqual(wrap('', 10), ['']);
});

test('expandTabs: a tab is spaces to the next multiple of 8 columns, counted by width', () => {
  assert.equal(expandTabs('a\tb'), `a${' '.repeat(7)}b`);
  assert.equal(expandTabs('\t'), ' '.repeat(8));
  assert.equal(expandTabs('abcdefgh\tx'), `abcdefgh${' '.repeat(8)}x`);
  assert.equal(expandTabs('\u4e2d\tx'), `\u4e2d${' '.repeat(6)}x`);
  assert.equal(expandTabs('\u05d1\u05b0\u05bc\t.'), `\u05d1\u05b0\u05bc${' '.repeat(7)}.`);
  assert.equal(expandTabs('no tab'), 'no tab');
});

// ---- R1 (S377, round 3): right to left ---------------------------------------------------------------------------------
// Hebrew is written here as it is stored (logical order); each visual form expected is spelled out as the screen gets it.
const SEG2 = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const clustersOf = (s) => [...SEG2.segment(s)].map((x) => x.segment);

test('R1: the mode by the terminal: Konsole (KONSOLE_VERSION) gets the text as stored, every other terminal the reader\'s layout; LTMS_READER_BIDI chooses, and a value it does not take is refused', () => {
  assert.deepEqual(RTL_MODES, ['reader', 'terminal']);
  assert.deepEqual(rtlModeOf({}), { mode: 'reader', by: 'default' });
  assert.deepEqual(rtlModeOf({ TERM_PROGRAM: 'vscode' }), { mode: 'reader', by: 'default' });
  assert.deepEqual(rtlModeOf({ KONSOLE_VERSION: '260803' }), { mode: 'terminal', by: 'KONSOLE_VERSION' });
  assert.deepEqual(rtlModeOf({ KONSOLE_VERSION: '' }), { mode: 'reader', by: 'default' });
  assert.deepEqual(rtlModeOf({ KONSOLE_VERSION: '260803', LTMS_READER_BIDI: 'reader' }), { mode: 'reader', by: 'LTMS_READER_BIDI' });
  assert.deepEqual(rtlModeOf({ LTMS_READER_BIDI: 'terminal' }), { mode: 'terminal', by: 'LTMS_READER_BIDI' });
  assert.deepEqual(rtlModeOf({ LTMS_READER_BIDI: '', KONSOLE_VERSION: '1' }), { mode: 'terminal', by: 'KONSOLE_VERSION' });
  assert.match(rtlModeOf({ LTMS_READER_BIDI: 'auto' }).refused, /^LTMS_READER_BIDI is "auto": it takes "reader" .* or "terminal" /);
  assert.throws(() => displayOrder([], 'auto'), /the modes are "reader" and "terminal"/);
});

test('R1: a line in visual order: a right-to-left paragraph reversed by clusters, its marks after their letters, its brackets mirrored, its numbers left to right', () => {
  assert.equal(visualLine('\u05de\u05d4 \u05e9\u05dc\u05d5\u05de\u05da?'), '?\u05da\u05de\u05d5\u05dc\u05e9 \u05d4\u05de');
  assert.equal(visualLine('\u05d4\u05d5\u05d0 \u05d0\u05de\u05e8 (\u05d1\u05e9\u05e7\u05d8) [\u05e9\u05dc\u05d5\u05dd] {\u05e2\u05d5\u05dc\u05dd} <ok>'), '<ok> {\u05dd\u05dc\u05d5\u05e2} [\u05dd\u05d5\u05dc\u05e9] (\u05d8\u05e7\u05e9\u05d1) \u05e8\u05de\u05d0 \u05d0\u05d5\u05d4');
  assert.equal(visualLine('\u05d1\u05e9\u05e0\u05ea 2026 \u05d4\u05d9\u05d5 1,234 \u05e7\u05d1\u05e6\u05d9\u05dd \u05d5-3.5 \u05d2\u05d9\u05d2\u05d4.'), '.\u05d4\u05d2\u05d9\u05d2 3.5-\u05d5 \u05dd\u05d9\u05e6\u05d1\u05e7 1,234 \u05d5\u05d9\u05d4 2026 \u05ea\u05e0\u05e9\u05d1');
  assert.equal(visualLine('The word \u05e9\u05dc\u05d5\u05dd means peace.'), 'The word \u05dd\u05d5\u05dc\u05e9 means peace.');
  // a pointed word: its clusters reversed, each letter keeping its marks after it, as a terminal draws them (L3)
  const pointed = '\u05e9\u05b8\u05c1\u05dc\u05d5\u05b9\u05dd';
  assert.deepEqual(clustersOf(visualLine(pointed)), clustersOf(pointed).reverse());
  // a cluster whose characters resolve to two levels takes its first one's: a Hebrew letter and a spacing mark of class L
  // (U+0903) stay one cluster, with the letter, in its right-to-left run (by code point the mark would leave it)
  assert.equal(visualLine('x באः'), 'x אःב');
  // nothing right to left in it: the same string
  const ascii = 'abc (def) 12 [x]';
  assert.equal(visualLine(ascii), ascii);
  // the paragraph's level given: an English line of a right-to-left paragraph keeps its words' order, its full stop left
  assert.equal(visualLine('abc def.', 1), '.abc def');
  assert.equal(directionOf('  \u05e9\u05dc\u05d5\u05dd abc'), 1);
  assert.equal(directionOf('abc \u05e9\u05dc\u05d5\u05dd'), 0);
  assert.equal(directionOf('12 34 !'), 0);
});

test('R1 (HL4): a path or a URL is laid out as one left-to-right unit: its parts in order, a Hebrew name in it reading right', () => {
  const line = '\u05e0\u05e9\u05de\u05e8 \u05d1\u05e0\u05ea\u05d9\u05d1 /home/user/\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8/\u05e7\u05d5\u05d1\u05e5.jsonl \u05d4\u05d9\u05d5\u05dd';
  assert.deepEqual(pathUnits(line).map(([a, b]) => line.slice(a, b)), ['/home/user/\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8/\u05e7\u05d5\u05d1\u05e5.jsonl']);
  assert.equal(visualLine(line), '\u05dd\u05d5\u05d9\u05d4 /home/user/\u05d8\u05e7\u05d9\u05d5\u05e8\u05e4/\u05e5\u05d1\u05d5\u05e7.jsonl \u05d1\u05d9\u05ea\u05e0\u05d1 \u05e8\u05de\u05e9\u05e0');
  // without the units, the algorithm's own result for the path: scrambled (GNU FriBidi gives the same: test/bidi.test.mjs)
  assert.equal(visualLine(line, null, { units: false }), '\u05dd\u05d5\u05d9\u05d4 jsonl.\u05e5\u05d1\u05d5\u05e7/\u05d8\u05e7\u05d9\u05d5\u05e8\u05e4/home/user/ \u05d1\u05d9\u05ea\u05e0\u05d1 \u05e8\u05de\u05e9\u05e0');
  for (const [text, units] of [
    ['\u05e8\u05d0\u05d4 src/\u05de\u05d5\u05d3\u05d5\u05dc.ts:12, \u05d5\u05e2\u05db\u05e9\u05d9\u05d5', ['src/\u05de\u05d5\u05d3\u05d5\u05dc.ts:12']],
    ['see https://he.wikipedia.org/wiki/x.', ['https://he.wikipedia.org/wiki/x']],
    ['(/tmp/a b) ~/x ./y ../z C:\\dir\\f', ['/tmp/a', '~/x', './y', '../z', 'C:\\dir\\f']],
    ['--file=/srv/f.txt;', ['/srv/f.txt']],
    ['(see /tmp/x) and [./y]', ['/tmp/x', './y']],
    ['/tmp/f(1) "/srv/q"', ['/tmp/f(1)', '/srv/q']],
    ['\u05d5/\u05d0\u05d5, 50 / 50, a / b', []],
  ]) assert.deepEqual(pathUnits(text).map(([a, b]) => text.slice(a, b)), units, text);
  assert.equal(visualLine('\u05e8\u05d0\u05d4 src/\u05de\u05d5\u05d3\u05d5\u05dc.ts:12, \u05d5\u05e2\u05db\u05e9\u05d9\u05d5'), '\u05d5\u05d9\u05e9\u05db\u05e2\u05d5 ,src/\u05dc\u05d5\u05d3\u05d5\u05de.ts:12 \u05d4\u05d0\u05e8');
  // its direction: a path is passed over, as an isolate's content is (P2)
  assert.equal(directionOf('/home/user/x \u05d4\u05d9\u05d5\u05dd'), 1);
  assert.equal(directionOf('/home/user/\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8'), 0);
});

test('R1: a row\'s segments, each a paragraph: "reader" lays each out in place, its spaces at either end where they are; "terminal" writes it as stored, with an RLM after a right-to-left one', () => {
  const row = [{ text: '> ', style: 'sel' }, { text: 'demo.jso:L2', style: 'addr' }, { text: '  ' }, { text: '\u05de\u05d4 \u05e9\u05dc\u05d5\u05de\u05da?   ', style: null }, { text: 'abc', style: 'dim' }];
  const r = displayOrder(row, 'reader');
  assert.deepEqual(r.map((s) => s.text), ['> ', 'demo.jso:L2', '  ', '?\u05da\u05de\u05d5\u05dc\u05e9 \u05d4\u05de   ', 'abc']);
  assert.deepEqual(r.map((s) => s.style), row.map((s) => s.style));
  const t = displayOrder(row, 'terminal');
  assert.deepEqual(t.map((s) => s.text), ['> ', 'demo.jso:L2', '  ', '\u05de\u05d4 \u05e9\u05dc\u05d5\u05de\u05da?\u200f   ', 'abc']);
  // a row with nothing right to left in it is the same row
  const plainRow = [{ text: 'abc  ', style: null }, { text: 'x', style: 'dim' }];
  assert.equal(displayOrder(plainRow, 'reader'), plainRow);
  assert.equal(displayOrder(plainRow, 'terminal'), plainRow);
  // a record's line: its text line's direction given; an English line of a Hebrew paragraph
  assert.deepEqual(displayOrder([{ text: 'abc def.', style: null, dir: 1 }], 'reader').map((s) => s.text), ['.abc def']);
  assert.deepEqual(displayOrder([{ text: 'abc def.', style: null, dir: 1 }], 'terminal').map((s) => s.text), ['abc def.\u200f']);
  // the columns stay: every segment as wide as it was
  for (const mode of RTL_MODES) assert.deepEqual(displayOrder(row, mode).map((s) => width(s.text)), row.map((s) => width(s.text)), mode);
});

test('R1: the parts of a cell cut in logical order, between clusters of the whole, with \u2026 at the end of the last part shown', () => {
  const parts = ['user  12 characters  ', '\u05de\u05d4 \u05e9\u05dc\u05d5\u05de\u05da \u05d4\u05d9\u05d5\u05dd?'];
  assert.equal(fitParts(parts, 200), parts);
  assert.deepEqual(fitParts(parts, 26), ['user  12 characters  ', '\u05de\u05d4 \u05e9\u2026']);
  assert.deepEqual(fitParts(parts, 21), ['user  12 characters \u2026']);
  assert.deepEqual(fitParts(parts, 22), ['user  12 characters  ', '\u2026']);
  assert.deepEqual(fitParts(parts, 0), []);
  for (let n = 1; n < 40; n++) assert.ok(width(fitParts(parts, n).join('')) <= n, `${n}`);
});

test('R1: a mirrored glyph is as wide as the character it stands for', async () => {
  const { MIRRORS } = await import('../src/bidi-table.mjs');
  for (let i = 0; i < MIRRORS.length; i += 2) assert.equal(clusterWidth(String.fromCodePoint(MIRRORS[i + 1])), clusterWidth(String.fromCodePoint(MIRRORS[i])), `U+${MIRRORS[i].toString(16)}`);
});

test(`the wide table: merged, sorted ranges from EastAsianWidth.txt ${VERSION}, its sha256 recorded`, () => {
  assert.equal(UNICODE_VERSION, VERSION);
  assert.equal(SOURCE_SHA256, SHA256);
  assert.match(SOURCE_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(SOURCE_URL, `https://www.unicode.org/Public/${VERSION}/ucd/EastAsianWidth.txt`);
  assert.equal(WIDE.length % 2, 0);
  for (let i = 0; i < WIDE.length; i += 2) {
    assert.ok(WIDE[i] <= WIDE[i + 1], `range ${i / 2}`);
    if (i + 2 < WIDE.length) assert.ok(WIDE[i + 1] + 1 < WIDE[i + 2], `ranges ${i / 2} and ${i / 2 + 1} are not merged`);
  }
  for (const cp of [0x1100, 0x115f, 0x3000, 0x3400, 0x4dbf, 0x4e00, 0x9fff, 0xf900, 0xfaff, 0xff01, 0x1f300, 0x1f600, 0x20000, 0x2fffd, 0x30000, 0x3fffd]) assert.ok(isWide(cp), `U+${cp.toString(16)} is W or F`);
  for (const cp of [0x41, 0x5d0, 0x5b0, 0x1160, 0x2026, 0xfe0f, 0x1f1e6, 0x2fffe, 0x3fffe, 0x10ffff, 0]) assert.ok(!isWide(cp), `U+${cp.toString(16)} is not W or F`);
});

test('the wide table is what scripts/width-table.mjs writes from the pinned source', { skip: process.env.LTMS_READER_EAW ? false : 'LTMS_READER_EAW names no EastAsianWidth.txt' }, () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'width-table.mjs'), process.env.LTMS_READER_EAW, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /is what .* gives \(\d+ ranges\)/);
});

// R.F5 (decided, S376): what reorders or hides text is shown as the other controls are: the bidirectional embeddings,
// overrides and isolates (U+202A-U+202E, U+2066-U+2069), the byte order mark (U+FEFF), the line and paragraph separators
// (U+2028, U+2029) and the tag characters (U+E0000-U+E007F); the light marks Hebrew uses (LRM U+200E, RLM U+200F, and
// ALM U+061C) are kept as written. Where they are drawn on a terminal that lays bidirectional text out itself is the
// right-to-left measurement's, not decided here.
const REORDER_OR_HIDE = [[0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff], [0x2028, 0x2029], [0xe0000, 0xe007f]];
test('R.F5: the characters that reorder or hide text, shown as escapes (\\u202e, \\u{e0041}); LRM, RLM and ALM as written', () => {
  let n = 0;
  for (const [first, last] of REORDER_OR_HIDE) {
    for (let cp = first; cp <= last; cp++) {
      const c = String.fromCodePoint(cp), v = visible(`x${c}y`);
      const want = cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, '0')}`;
      assert.equal(v, `x${want}y`, `U+${cp.toString(16)}`);
      assert.equal(visible(v), v, `U+${cp.toString(16)}: a second pass changes nothing`);
      n++;
    }
  }
  assert.equal(n, 5 + 4 + 1 + 2 + 128);
  for (const cp of [0x200e, 0x200f, 0x061c]) {
    const s = `ש${String.fromCodePoint(cp)}b`;
    assert.equal(visible(s), s, `U+${cp.toString(16)}: as written`);
  }
  // and nothing else of these blocks: their neighbours as written
  for (const cp of [0x2027, 0x202f, 0x2065, 0x206a, 0xfefe, 0xdffff, 0xe0080]) assert.equal(visible(String.fromCodePoint(cp)), String.fromCodePoint(cp), `U+${cp.toString(16)}`);
});

// ---- R4 (S377, round 3): Node 20 --------------------------------------------------------------------------------------
// On Node 20 (20.20.2, ICU 78.2), each step of Intl.Segmenter's iteration costs in proportion to the length of the string
// it walks: 3.4 us a cluster at 10,000 units, 115 at 80,000, so that a record's long line was never laid out (R.F1's pty
// test at 512 MB: 'no Record oooooooo:L3 within 120000 ms'). clusters() walks a long text a slice at a time.
test('R4: the clusters of a long text are those Intl.Segmenter gives the whole text, slices of it notwithstanding', async () => {
  const { clusters, SLICE } = await import('../src/text.mjs');
  const cp = (...x) => String.fromCodePoint(...x);
  let seed = 2004;
  const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  const atoms = ['a', ' ', '\n', '\r\n', '́', 'ָ', 'ש', '‍', cp(0x1f468), cp(0x1f1ee), '️', 'क', '्', '؀', cp(0x110bd), 'ᄀ', 'ᅡ', '가', '漢', cp(0x1f44d), cp(0x1f3fd), '©', '\ud800', '\udc00'];
  for (let i = 0; i < 400; i++) {
    let s = '';
    const len = SLICE - 10 + rnd(2500);
    while (s.length < len) { const a = atoms[rnd(atoms.length)]; s += a.repeat(rnd(6) === 0 ? 1 + rnd(700) : 1); }
    assert.deepEqual([...clusters(s)], [...SEG.segment(s)].map((x) => x.segment), `text ${i} (seed 2004), ${s.length} units`);
  }
});

test('R4: walking the clusters of 160,000 units of Hebrew, pointed and plain, takes under 2 s', async () => {
  const { clusters } = await import('../src/text.mjs');
  for (const unit of ['אבג ', 'שִׁ ']) {
    const s = unit.repeat(160_000 / unit.length);
    const t0 = performance.now();
    let n = 0;
    for (const _ of clusters(s)) n++;
    const ms = performance.now() - t0;
    assert.equal(n, unit === 'אבג ' ? 160_000 : 80_000);
    assert.ok(ms < 2000, `${JSON.stringify(unit)} x ${160_000 / unit.length}: ${Math.round(ms)} ms`);
  }
});
