// test/record-view.test.mjs — R.F1: a record's view in the memory it has. Its lines are laid out a page at a time
// (src/views.mjs RecordLines): every page, read from the marks it keeps, is the page of the whole, and the whole is what
// the view drew before it laid out pages (each part's label, its text cut at its new lines, its tabs as spaces, cut
// by columns; its JSON), at widths from the narrowest the reader draws. A record too large for the record view beside
// its transcript (src/reading.mjs recordTooLarge) is refused before anything of it is laid out, with its size and the
// NODE_OPTIONS that would show it, the command given whole; at the setting it names, it is shown.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../src/app.mjs';
import { MB, PARSE_PER_BYTE, RECORD_VIEW_PER_BYTE, recordTooLarge } from '../src/reading.mjs';
import { FileSource } from '../src/sources.mjs';
import { againOf } from '../src/start.mjs';
import { directionOf, expandTabs, fit, lineSpans, visible } from '../src/text.mjs';
import { RecordLines, recordLines, top } from '../src/views.mjs';
import { KEY, deepRecord, keyboard, plainOf } from './helpers.mjs';

/** The lines as the record view made them whole before (44b868f's recordLines, cutting where lineSpans cuts: since V7,
 *  round 5, a space at a break hangs at the end of the line before, in no line); each line of a text with its text
 *  line's direction (R1: the paragraph's, for the right-to-left layout), and its text line and its place in it (W1,
 *  round 4: the paragraph it is laid out from). */
function whole(rec, json, cols) {
  const out = [], seg = (text, style = null, dir = undefined) => (dir === undefined ? { text, style } : { text, style, dir });
  const lbl = (s) => visible(s ?? '').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  const more = (n) => `... ${n.toLocaleString('en-US')} ${n === 1 ? 'more character' : 'more characters'} not shown`;
  const text = (s, style = null) => { for (const p of visible(s).split('\n')) { const t = expandTabs(p), d = directionOf(t); for (const [a, b] of lineSpans(t, cols)) out.push([{ ...seg(t.slice(a, b), style, d), par: t, at: a }]); } };
  if (json) {
    text(rec.raw.text);
    if (rec.raw.more) out.push([seg(fit(more(rec.raw.more), cols), 'dim')]);
  } else {
    if (!rec.reading.length) out.push([seg(fit('(nothing to read in this record)', cols), 'dim')]);
    rec.reading.forEach((p, i) => {
      if (i) out.push([]);
      text(`-- ${lbl(p.label)} --`, 'head');
      if (p.text !== '') text(p.text);
      if (p.more) out.push([seg(fit(more(p.more), cols), 'dim')]);
    });
  }
  return out;
}

const hebrew = 'בְּרֵאשִׁית בָּרָא אֱלֹהִים 👍🏽 中文 '.repeat(3000);
const records = {
  'one long line of Hebrew with marks, an emoji and wide characters': { reading: [{ label: 'tool result', text: hebrew, more: 12 }], raw: { text: JSON.stringify({ t: hebrew }), more: 0 } },
  'many short lines, tabs among clusters, blank lines, control characters': { reading: [{ label: 'text', text: Array.from({ length: 4000 }, (_, i) => (i % 7 ? `${i}\tבּ\t👍🏽 x\u001b[0m` : '')).join('\n'), more: 0 }], raw: { text: JSON.stringify({ n: Array(3000).fill(1) }, null, 1), more: 3 } },
  'several parts: an empty text, a long tool name, the more lines': { reading: [{ label: 'thinking (redacted)', text: '', more: 0 }, { label: `tool call: ${'Bash'.repeat(30)}`, text: 'a\n\n\tb\n'.repeat(700), more: 1 }, { label: 'text', text: 'x'.repeat(50_000), more: 0 }], raw: { text: 'y'.repeat(30_000), more: 0 } },
  'no parts': { reading: [], raw: { text: '{}', more: 0 } },
};

test('R.F1: a record\'s lines laid out a page at a time: every page is that page of the whole, and the whole is what the view drew before', () => {
  for (const [what, rec] of Object.entries(records)) {
    for (const json of [false, true]) {
      for (const cols of [20, 80, 133, 200]) {
        const at = `${what}, ${json ? 'JSON' : 'text'}, ${cols} columns`;
        const lines = recordLines(rec, json, cols), all = whole(rec, json, cols);
        assert.equal(lines.length, all.length, `${at}: the count`);
        assert.deepEqual(lines.slice(), all, `${at}: the whole`);
        const h = 18, starts = new Set([0, 1, 255, 256, 257, 511, 512, 513, lines.length - h, lines.length - 1]);
        for (let a = 0; a < lines.length; a += 97) starts.add(a);
        for (const a of starts) if (a >= 0) assert.deepEqual(lines.slice(a, a + h), all.slice(a, a + h), `${at}: the page at ${a}`);
        assert.equal(recordLines(rec, json, cols), lines, `${at}: kept for the width drawn last`);
      }
    }
  }
});

// V1 (round 5): round 4 laid out each line of a wrapped paragraph from the paragraph's levels, and found the paths and
// URLs (its units) a line holds by passing over every unit before the line, from the first. In a right-to-left paragraph
// of 200,000 paths (round 4's check's probe, unitscost.mjs, run on 2026-11-17, twice), a page at its end took 44.8 and
// 45.3 ms at 200 x 60 against 5.9 and 6.2 at its start, and 16.8 and 20.0 ms at 80 x 24 against 1.1 and 1.3, where round
// 3 (b0ff6ac) drew every page alike (13.5 to 15.0 ms, 2.1 to 2.9). The probe made a test: the page at the end against the
// page at the start, drawn one after the other, the median of 15 each, after the first frame (which resolves the
// paragraph's levels); the bound leaves room for a machine's noise (the suite runs its files side by side), not for a
// pass over the paths.
test('V1: in a right-to-left paragraph of 200,000 paths, a page at its end costs about what a page at its start does (at most three times, and 3 ms), at 80 x 24 and 200 x 60', { timeout: 300_000 }, async (t) => {
  const { frameBytes } = await import('../src/screen.mjs');
  const text = 'אבגד' + '/srv/data/x.txt '.repeat(200_000);
  const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  for (const [cols, rows] of [[80, 24], [200, 60]]) {
    const lines = new RecordLines([{ text, style: null }], cols), last = lines.length - rows;
    const page = (at) => { const t0 = performance.now(); frameBytes(lines.slice(at, at + rows), { cols, rows, colour: true, rtl: 'reader' }); return performance.now() - t0; };
    const first = page(0);
    const start = [], end = [];
    for (let i = 0; i < 15; i++) { start.push(page(0)); end.push(page(last)); }
    const s = median(start), e = median(end);
    const said = `${cols} x ${rows}: the first frame ${first.toFixed(1)} ms; a page at the start ${s.toFixed(1)} ms, at the end (line ${last.toLocaleString('en-US')} of ${lines.length.toLocaleString('en-US')}) ${e.toFixed(1)} ms`;
    t.diagnostic(said);
    assert.ok(e <= 3 * s + 3, said);
  }
});

test('R.F1: a record\'s lines are kept for one width only: at another, laid out again; the text\'s and the JSON\'s each', () => {
  const rec = records['one long line of Hebrew with marks, an emoji and wide characters'];
  const t80 = recordLines(rec, false, 80), j80 = recordLines(rec, true, 80);
  assert.equal(recordLines(rec, false, 80), t80);
  assert.equal(recordLines(rec, true, 80), j80, 'the JSON\'s, beside the text\'s');
  const t81 = recordLines(rec, false, 81);
  assert.notEqual(t81, t80);
  assert.notEqual(recordLines(rec, false, 80), t80, 'the lines at 80 were not kept once 81 was drawn');
});

test('R.F1: the rule for a record too large: its view, 16 times its size, beside its transcript\'s parse, 8 times the file\'s, within nine tenths of the heap limit', () => {
  assert.equal(RECORD_VIEW_PER_BYTE, 16);
  assert.equal(PARSE_PER_BYTE, 8);
  // R's scenario: the result's line, 14,000,514 bytes, in a transcript of 14,002,119; the heap limits Node gave at
  // --max-old-space-size=512 and =128 (measured here: 637,534,208 and 234,881,024)
  assert.equal(recordTooLarge(14_000_514, 14_002_119, 637_534_208, 'npx ltms-reader x.jsonl'), null, 'at 512: shown');
  assert.equal(recordTooLarge(14_000_514, 14_002_119, 234_881_024, 'npx ltms-reader x.jsonl'), "it is 14 MB, and in a transcript of 14 MB this process shows a record of up to 5 MB (its view takes up to 16 times a record's size, the transcript's parse up to 8 times the file's, both within nine tenths of the memory limit). To show it, give Node more memory: NODE_OPTIONS=--max-old-space-size=512 npx ltms-reader x.jsonl", 'at 128: refused, and 512 named');
  // the boundary, by the rule's own numbers
  const heap = 1000 * MB, file = 20 * MB, limit = Math.floor((0.9 * heap - 8 * file) / 16);
  assert.equal(recordTooLarge(limit, file, heap), null);
  assert.match(recordTooLarge(limit + 1, file, heap), /^it is \d+ MB, and in a transcript of 20 MB this process shows a record of up to \d+ MB .* NODE_OPTIONS=--max-old-space-size=\d+ npx ltms-reader$/);
  // the setting named is enough by the same rule (Node's limit at --max-old-space-size=N is N MB and more), and for
  // the transcript too (a tenth of it); under a megabyte, sizes in KB
  for (const [bytes, size, h] of [[14_000_514, 14_002_119, 234_881_024], [3 * MB, 3 * MB, 40 * MB], [600_000, 700_000, 8 * MB], [100 * MB, 180 * MB, 2048 * MB]]) {
    const why = recordTooLarge(bytes, size, h);
    assert.ok(why, `${bytes} in ${size} at ${h}: refused`);
    const need = Number(/--max-old-space-size=(\d+)/.exec(why)[1]) * MB;
    assert.equal(recordTooLarge(bytes, size, need), null, `${bytes} in ${size}: shown at the ${need / MB} MB it names`);
    assert.ok(size <= need / 10, 'and the transcript is read at that setting');
  }
  assert.match(recordTooLarge(600_000, 700_000, 8 * MB), /^it is 586 KB, and in a transcript of 684 KB this process shows a record of up to \d+ KB /);
});

test('R.F1: a record too large for this process\'s memory: refused before it is laid out; its view says so, with its size and the NODE_OPTIONS that would show it; j and the arrows do nothing; Esc goes back', async () => {
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-record-'));
  try {
    const file = path.join(own, 'rec.jsonl');
    const prompt = { parentUuid: null, isSidechain: false, userType: 'external', cwd: '/work/rec', sessionId: '88888888-8888-4888-8888-888888888888', version: '2.0.0', type: 'user', message: { role: 'user', content: `a long prompt ${'z'.repeat(5 * MB)}` }, uuid: '88888888-0000-4000-8000-000000000001', timestamp: '2026-11-15T09:00:00.000Z', promptSource: 'typed' };
    writeFileSync(file, `${JSON.stringify(prompt)}\n`);
    // a heap limit of 100 MB for the rule: the transcript (5 MB) is read (a tenth: 10 MB); its one record is not shown
    const source = new FileSource({ file, heapLimit: 100 * MB, again: againOf('rec.jsonl') });
    const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
    const keys = keyboard(app);
    try {
      app.start(); await app.idle();
      await keys.press(KEY.enter);
      assert.equal(top(app.state).kind, 'turn');
      await keys.press(KEY.enter);
      const v = top(app.state);
      assert.equal(v.kind, 'record');
      assert.equal(v.rec, null, 'nothing of the record was laid out');
      let f = plainOf(app.lines()).map((l) => l.trimEnd());
      assert.equal(f[0], 'ltms-reader  Record rec.json:L1  rec.jsonl');
      assert.equal(f[1], 'this record is not shown');
      const said = f.slice(2, f.indexOf('', 2)).map((l) => l.trim()).join(' ');
      assert.match(said, /^rec\.json:L1 is not shown: it is 6 MB, and in a transcript of 6 MB this process shows a record of up to 3 MB \(.*\)\. To show it, give Node more memory: NODE_OPTIONS=--max-old-space-size=256 npx ltms-reader rec\.jsonl$/);
      assert.match(f[23], /^rec\.json:L1 {2}/, 'its address on the last line');
      const before = plainOf(app.lines());
      await keys.press('j'); await keys.press(KEY.down); await keys.press(KEY.end);
      assert.deepEqual(plainOf(app.lines()), before, 'j and the arrows change nothing');
      await keys.press(KEY.escape);
      assert.equal(top(app.state).kind, 'turn');
    } finally { app.dispose(); source.dispose(); }
  } finally { rmSync(own, { recursive: true, force: true }); }
});

// ---- N3 (S377): a record nested deep -----------------------------------------------------------------------------------
// The record view writes the record as JSON (json(r, 1)) and the parts it shows as JSON (json(.., 2)) whole before it
// clips them, and JSON's indentation grows with depth: the checker's list nested 990 deep, a line of 0.8 MB, wrote
// 399,389,570 units, and at --max-old-space-size=256 the heap ran out. The rule now weighs what the view builds, measured
// by walking the record (view.mjs recordViewBytes), beside the 16 times its line.
test('N3: a record nested 990 deep, its line small, its JSON large: refused before it is laid out, with its size and the NODE_OPTIONS that would show it; at that setting, shown', async () => {
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-deep-'));
  try {
    const file = path.join(own, 'dddddddd-0000-4000-8000-000000000000.jsonl');
    deepRecord(file, 990, 20_000);
    const open = async (heapLimit) => {
      const source = new FileSource({ file, heapLimit, again: againOf('deep.jsonl') });
      const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
      const keys = keyboard(app);
      try {
        app.start(); await app.idle();
        await keys.press(KEY.enter); await keys.press(KEY.down); await keys.press(KEY.down);
        assert.match(plainOf(app.lines()).find((l) => l.startsWith('> ')) ?? '', /^> dddddddd:L3 +result /, 'the result selected');
        await keys.press(KEY.enter);
        const v = top(app.state);
        return { v, lines: plainOf(app.lines()).map((l) => l.trimEnd()) };
      } finally { app.dispose(); source.dispose(); }
    };
    // a heap limit of 160 MB for the rule: the line (about 42 KB) passes 16 times its size; its JSON does not fit
    const { v, lines } = await open(160 * MB);
    assert.equal(v.kind, 'record');
    assert.ok(v.rec === null, `nothing of the record was laid out: ${lines[1]}`);
    const said = lines.slice(2, lines.indexOf('', 2)).map((l) => l.trim()).join(' ');
    assert.match(said, /^dddddddd:L3 is not shown: it is \d+ KB, and its view would write \d+ MB of JSON .*To show it, give Node more memory: NODE_OPTIONS=--max-old-space-size=\d+ npx ltms-reader deep\.jsonl$/, said);
    const need = Number(/--max-old-space-size=(\d+)/.exec(said)[1]);
    const shown = await open(need * MB);
    assert.ok(shown.v.rec, `shown at the ${need} MB it names`);
  } finally { rmSync(own, { recursive: true, force: true }); }
});

test('N3: what the record view builds, measured by a walk that builds no string, is what it builds: over the fixtures\' records and deep ones', async () => {
  const V = await import('../src/view.mjs');
  assert.equal(typeof V.recordViewBytes, 'function', 'view.mjs measures what recordView builds');
  const { parseTranscript } = await import('#ltms');
  const { readdirSync, readFileSync } = await import('node:fs');
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-deep-'));
  try {
    for (const [d, n] of [[990, 2000], [300, 5000], [1, 3]]) deepRecord(path.join(own, `deep-${d}-${n}.jsonl`), d, n);
    const FXS = [path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures'), path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'ltms'), own];
    let records = 0;
    for (const dir of FXS) for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
      const t = parseTranscript(readFileSync(path.join(dir, f), 'utf8'));
      for (let i = 0; i < t.records.length; i++) {
        const line = t.positions[i].line;
        if (V.recordIndexAt(t, line) !== i) continue;
        const r = t.records[i];
        // what is written, by JSON.stringify here: the record at indent 1, each part shown as JSON at indent 2
        const bytes = (s) => (s === undefined ? 0 : s.length > 536_870_888 ? 0 : s.length * (/[^\u0000-ÿ]/.test(s) ? 2 : 1));
        let want = bytes(JSON.stringify(r, null, 1));
        for (const p of V.partsOf(r)) if (p.json !== undefined) want += bytes(JSON.stringify(p.json, null, p.indent));
        assert.equal(V.recordViewBytes(t, line), want, `${f}:L${line}`);
        // and the view writes those: its JSON whole is the raw's text and what it left out
        const rec = V.recordView(t, line, { name: f, whole: true });
        assert.equal(rec.raw.text.length + rec.raw.more, JSON.stringify(r, null, 1).length, `${f}:L${line}: the record's JSON`);
        records++;
      }
    }
    assert.ok(records > 100, `${records} records`);
  } finally { rmSync(own, { recursive: true, force: true }); }
});

test("N3: the checker's record (a list nested 990 deep, 400,000 ones): its view's JSON measured at 399,389,570 bytes (the structured part, 796,770,118 units, past JavaScript's limit, is never written and counts nothing); refused at --max-old-space-size=256, 768 named", async () => {
  const V = await import('../src/view.mjs');
  const { parseTranscript } = await import('#ltms');
  const { readFileSync } = await import('node:fs');
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-deep-'));
  try {
    const file = path.join(own, 'deep.jsonl');
    deepRecord(file, 990, 400_000);
    const text = readFileSync(file, 'utf8'), t = parseTranscript(text);
    assert.deepEqual(V.jsonSize(t.records[2], 1), { units: 399_389_570, wide: false });
    assert.deepEqual(V.jsonSize(t.records[2].toolUseResult, 2), { units: 796_770_118, wide: false });
    assert.ok(796_770_118 > V.STRING_MAX_UNITS);
    assert.equal(V.recordViewBytes(t, 3), 399_389_570);
    // Node's heap limit at --max-old-space-size=256 is 352 MB (measured)
    const why = recordTooLarge(t.positions[2].bytes, Buffer.byteLength(text), 352 * MB, 'npx ltms-reader deep.jsonl', V.recordViewBytes(t, 3));
    assert.equal(why, "it is 784 KB, and its view would write 381 MB of JSON (indented, as JSON is, once more at each level a value is nested in), which with what the view needs beside it (96 MB) does not fit beside the transcript's parse in nine tenths of the memory limit. To show it, give Node more memory: NODE_OPTIONS=--max-old-space-size=768 npx ltms-reader deep.jsonl");
    assert.equal(recordTooLarge(t.positions[2].bytes, Buffer.byteLength(text), 768 * MB, 'x', V.recordViewBytes(t, 3)), null, 'shown at the setting named');
  } finally { rmSync(own, { recursive: true, force: true }); }
});

test('N3, Node 20: a part whose JSON would pass the limit on a string\'s length is never handed to JSON.stringify (on Node 20 that held some 800 MB before the heap ran out); it reads "(too large to write out)"', async () => {
  const V = await import('../src/view.mjs');
  const { parseTranscript } = await import('#ltms');
  const { readFileSync } = await import('node:fs');
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-deep-'));
  try {
    const file = path.join(own, 'deep.jsonl');
    deepRecord(file, 990, 400_000);
    const r = parseTranscript(readFileSync(file, 'utf8')).records[2];
    const real = JSON.stringify, asked = [];
    let parts;
    JSON.stringify = function (v, ...rest) { asked.push(v); return real.call(this, v, ...rest); };
    try { parts = V.readingOf(r, 4_000_000); } finally { JSON.stringify = real; }
    assert.ok(!asked.includes(r.toolUseResult), 'the structured part (796,770,118 units at indent 2) was not handed to JSON.stringify');
    assert.deepEqual(parts.find((p) => p.kind === 'structured'), { kind: 'structured', label: 'tool result, structured', text: '(too large to write out)', more: 0 });
  } finally { rmSync(own, { recursive: true, force: true }); }
});
