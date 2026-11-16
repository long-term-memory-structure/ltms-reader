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
import { expandTabs, fit, visible, wrap } from '../src/text.mjs';
import { recordLines, top } from '../src/views.mjs';
import { KEY, keyboard, plainOf } from './helpers.mjs';

/** The lines as the record view made them whole before (44b868f's recordLines, its wrap cutting the same places). */
function whole(rec, json, cols) {
  const out = [], seg = (text, style = null) => ({ text, style });
  const lbl = (s) => visible(s ?? '').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  const more = (n) => `... ${n.toLocaleString('en-US')} ${n === 1 ? 'more character' : 'more characters'} not shown`;
  const text = (s, style = null) => { for (const p of visible(s).split('\n')) for (const l of wrap(expandTabs(p), cols)) out.push([seg(l, style)]); };
  if (json) {
    text(rec.raw.text);
    if (rec.raw.more) out.push([seg(fit(more(rec.raw.more), cols), 'dim')]);
  } else {
    if (!rec.reading.length) out.push([seg(fit('(nothing to read in this record)', cols), 'dim')]);
    rec.reading.forEach((p, i) => {
      if (i) out.push([]);
      for (const l of wrap(`-- ${lbl(p.label)} --`, cols)) out.push([seg(l, 'head')]);
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
