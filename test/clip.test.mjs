// test/clip.test.mjs — R.F4: the view layer's clip (src/view.mjs) cuts a text at a grapheme cluster's boundary, at or
// before its limit, never inside a cluster (it kept a whole surrogate pair, and cut a pointed Hebrew letter from its
// marks); and a row whose text the clip cut ends with …, so that it shows the text goes on. Cluster boundaries are
// Intl.Segmenter's, which defines them.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../src/app.mjs';
import { FileSource } from '../src/sources.mjs';
import { clip, LIMITS } from '../src/view.mjs';
import { top } from '../src/views.mjs';
import { KEY, keyboard, plainOf } from './helpers.mjs';

const SEG = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const boundaries = (s) => { const b = new Set([s.length]); for (const { index } of SEG.segment(s)) b.add(index); return b; };
const cp = (...xs) => String.fromCodePoint(...xs);
// shin, its shin dot, dagesh, qamats and zarqa: five units, one cluster, one column
const SHIN = cp(0x5e9, 0x5c1, 0x5bc, 0x5b8, 0x5ae);
const SAMPLES = {
  'pointed Hebrew after one letter': `x${SHIN.repeat(100)}`,
  'a with two combining marks, and a space': `${cp(0x61, 0x300, 0x301)} `.repeat(150),
  'a family of four (ZWJ) and a flag': `ab${cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466)}${cp(0x1f1ee, 0x1f1f1)}`.repeat(40),
  'surrogate pairs: an emoji with a skin tone': `z${cp(0x1f44d, 0x1f3fd)}`.repeat(120),
  'plain ASCII': 'plain words, nothing else; '.repeat(30),
};

test('R.F4: clip cuts at the last cluster boundary at or before its limit, never inside a cluster, and says how much is left', () => {
  for (const [what, s] of Object.entries(SAMPLES)) {
    const b = boundaries(s);
    for (let n = 0; n <= s.length + 2; n++) {
      const r = clip(s, n);
      assert.equal(s.slice(0, r.text.length), r.text, `${what} at ${n}: a start of the text`);
      assert.ok(r.text.length <= n, `${what} at ${n}: ${r.text.length} units`);
      assert.ok(b.has(r.text.length), `${what} at ${n}: cut inside a cluster, at ${r.text.length}`);
      const next = Math.min(...[...b].filter((x) => x > r.text.length));
      if (r.text.length < s.length) assert.ok(next > n, `${what} at ${n}: the cluster up to ${next} would have fit`);
      assert.equal(r.more, s.length - r.text.length, `${what} at ${n}: what is left`);
    }
  }
});

test('R.F4: a call\'s input cut by the clip: its row ends with …, after a whole cluster, at 200 and at 133 columns', async () => {
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-clip-'));
  try {
    const command = SAMPLES['pointed Hebrew after one letter'];
    assert.ok(command.length > LIMITS.input && !boundaries(command).has(LIMITS.input), 'the limit falls inside a cluster here');
    const base = { isSidechain: false, userType: 'external', cwd: '/work/clip', sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', version: '2.0.0' };
    const recs = [
      { ...base, parentUuid: null, type: 'user', message: { role: 'user', content: 'run it' }, uuid: 'c1', timestamp: '2026-11-15T09:00:00.000Z', promptSource: 'typed' },
      { ...base, parentUuid: 'c1', type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command } }] }, requestId: 'r1', uuid: 'c2', timestamp: '2026-11-15T09:00:01.000Z' },
      { ...base, parentUuid: 'c2', type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: command }] }, uuid: 'c3', timestamp: '2026-11-15T09:00:02.000Z' },
    ];
    const file = path.join(own, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc.jsonl');
    writeFileSync(file, `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`);
    for (const cols of [200, 133]) {
      const source = new FileSource({ file });
      const app = new App({ source, cols, rows: 24, timeZone: 'UTC' });
      const keys = keyboard(app);
      try {
        app.start(); await app.idle();
        await keys.press(KEY.enter);
        assert.equal(top(app.state).kind, 'turn');
        const lines = plainOf(app.lines()).map((l) => l.trimEnd());
        for (const [kind, prefix] of [['call', 'command: '], ['result', '']]) {
          const row = lines.find((l) => new RegExp(`^  cccccccc:L\\d+ +${kind} `).test(l));
          assert.ok(row, `${cols}: a ${kind} row`);
          const at = row.indexOf(`${prefix}x`) + prefix.length;
          const shown = row.slice(at);
          assert.ok(shown.endsWith('…'), `${cols}: the ${kind}'s row ends with …: ${JSON.stringify(shown.slice(-12))}`);
          const kept = shown.slice(0, -1);
          assert.ok(command.startsWith(kept) && boundaries(command).has(kept.length), `${cols}: the ${kind}'s text ends after a whole cluster (${kept.length} units)`);
        }
      } finally { app.dispose(); source.dispose(); }
    }
  } finally { rmSync(own, { recursive: true, force: true }); }
});

// ---- N4 (S377): a cluster longer than the window clip looked back over -------------------------------------------------
// clip found a cut by segmenting the 512 units before its limit as if they began a text: a cluster that began before them
// was cut inside (the checker's 'x', 'a' with 2,000 combining acute accents, 'y': cut at 988 for 1,500), and so is any
// cluster whose rules look back past such a window: an emoji ZWJ sequence (GB11), an Indic conjunct (GB9c), a run of
// regional indicators, which pair from the run's start (GB12, GB13). Each is checked at every limit, against the
// boundaries of the whole text, segmented from its start here.
const LONG = {
  "the checker's: 'x', 'a' with 2,000 combining acute accents, 'y'": `x${'a'}${'́'.repeat(2000)}y`,
  'an emoji ZWJ sequence of 300 people': `x${cp(0x1f468)}${`‍${cp(0x1f468)}`.repeat(300)}y`,
  'an Indic conjunct of 401 consonants (ka, virama)': `x${'क'}${'्क'.repeat(400)} y`,
  '801 regional indicators, then a word': `x${cp(0x1f1e6).repeat(801)}word`,
  '601 regional indicators after 700 letters': `${'b'.repeat(700)}${cp(0x1f1e6).repeat(601)}c`,
  // a Prepend character written as a surrogate pair (U+110BD) joins the letter after it (GB9b)
  'the Kaithi number sign before each of 300 letters': `x${`${cp(0x110bd)}a`.repeat(300)}`,
  // the copyright sign is an emoji (Extended_Pictographic) and joins after a ZWJ (GB11): one cluster of 601 units
  'a man, then 300 times ZWJ and the copyright sign': `x${cp(0x1f468)}${'‍©'.repeat(300)}y`,
};
test('N4: clip never cuts inside a cluster longer than any window: the last boundary at or before its limit, of the whole text', () => {
  for (const [what, s] of Object.entries(LONG)) {
    const b = boundaries(s);
    for (let n = 0; n <= s.length + 2; n++) {
      const r = clip(s, n);
      assert.ok(b.has(r.text.length), `${what} at ${n}: cut inside a cluster, at ${r.text.length}`);
      const next = Math.min(...[...b].filter((x) => x > r.text.length));
      if (r.text.length < s.length) assert.ok(next > n, `${what} at ${n}: the cluster up to ${next} would have fit`);
      assert.equal(r.more, s.length - r.text.length, `${what} at ${n}: what is left`);
    }
  }
});

test('N4: clip on texts made of the characters that join (marks, ZWJ, emoji, regional indicators, Indic, Hangul, CR LF, Prepend) and long runs of them: always the whole text\'s last boundary at or before the limit', () => {
  // a fixed sequence of pseudo-random numbers, so that a failure can be run again
  let seed = 377;
  const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  // the Prepend characters U+0600 (Arabic) and U+110BD (Kaithi, a surrogate pair) join the character after them, ASCII too
  const atoms = ['a', ' ', 'x', '-', '\n', '\r', '\r\n', '́', 'ָ', 'ש', 'ب', '‍', cp(0x1f468), cp(0x1f1ee), cp(0x1f1f1), '️', 'क', '्', '؀', cp(0x110bd), 'ᄀ', 'ᅡ', 'ᆨ', '가', 'é', '漢', cp(0x1f44d), cp(0x1f3fd), 'ำ', 'ः', '©'];
  for (let i = 0; i < 300; i++) {
    let s = '';
    while (s.length < 1500) { const a = atoms[rnd(atoms.length)]; s += a.repeat(rnd(4) === 0 ? 1 + rnd(400) : 1); }
    const b = boundaries(s);
    for (let j = 0; j < 12; j++) {
      const n = rnd(s.length + 1);
      const r = clip(s, n);
      const want = Math.max(...[...b].filter((x) => x <= n));
      assert.equal(r.text.length, want, `text ${i} (seed 377), at ${n}: the last boundary at or before it is ${want}`);
    }
  }
});
