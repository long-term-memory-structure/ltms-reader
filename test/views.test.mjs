// test/views.test.mjs — the render functions, line by line, at 80 x 24 and at 200 x 60, over ltms's own synthetic
// transcripts (test/fixtures/ltms, the core's test/fixtures) and the reader's two (test/fixtures/hebrew-english.jsonl,
// test/fixtures/escapes.jsonl); and, when LTMS_READER_FIXTURES names a folder, every .jsonl under it at any depth (the
// core's own test/fixtures, say, with its review/ transcripts, which are not copied here).
//
// For every transcript, at both sizes, every page of the session view, of each turn's view, and of each item's record
// (as text and as JSON): exactly `rows` lines, each within the columns (the last line one column short), no control
// character in any of them, and each row's address whole at its place. What the rows say is recomputed from ltms's own
// CLI, run as a separate process by the package's name: the turns and calls `ltms skeleton` prints (their addresses,
// channels, counts, results, ok and error classes) and the compactions `ltms index` prints. A record's lines, joined,
// are its text; its JSON lines, joined, are the record parsed from the file's own line by JSON.parse. Then a few whole
// frames, compared line by line.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../src/app.mjs';
import { FileSource, RootSource } from '../src/sources.mjs';
import { visible, width } from '../src/text.mjs';
import { bodyHeight, recordLines, top } from '../src/views.mjs';
import { FX, HEB, OWN, keyboard, KEY, ltms, makeRoot, plainOf } from './helpers.mjs';

const SIZES = [[80, 24], [200, 60]];
const CC = /[\u0000-\u001f\u007f-\u009f]/;
const STYLES = new Set([null, 'head', 'dim', 'sel', 'bad', 'addr']);
const deep = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? deep(path.join(d, e.name)) : e.isFile() && e.name.endsWith('.jsonl') ? [path.join(d, e.name)] : [])).sort();
const population = [
  ...readdirSync(FX).filter((n) => n.endsWith('.jsonl')).sort().map((n) => path.join(FX, n)),
  path.join(OWN, 'hebrew-english.jsonl'), path.join(OWN, 'escapes.jsonl'), path.join(OWN, 'channels.jsonl'),
  ...(process.env.LTMS_READER_FIXTURES ? deep(process.env.LTMS_READER_FIXTURES) : []),
];
const label = (s) => visible(String(s)).replace(/\n/g, '\\n').replace(/\t/g, '\\t');

/** Every line of a frame: the count, the width (the last line one column short), no control character, known styles. */
function checkFrame(lines, cols, rows, where) {
  assert.equal(lines.length, rows, `${where}: ${lines.length} lines`);
  lines.forEach((l, i) => {
    const text = l.map((s) => s.text).join('');
    assert.ok(!CC.test(text), `${where}: line ${i + 1} holds a control character: ${JSON.stringify(text)}`);
    const max = i === rows - 1 ? cols - 1 : cols;
    assert.ok(width(text) <= max, `${where}: line ${i + 1} is ${width(text)} columns, over ${max}: ${JSON.stringify(text)}`);
    for (const s of l) assert.ok(typeof s.text === 'string' && STYLES.has(s.style ?? null), `${where}: line ${i + 1}: a segment ${JSON.stringify(s)}`);
  });
}

/** The list rows of every page of the view on top, as drawn: [{ k (the row's place in the list), text }], after Home
 *  and then PgDn until the last row is drawn; the frames are checked on the way. */
async function pagesOf(app, keys, cols, rows, where, headed = true) {
  await keys.press(KEY.home);
  const v = top(app.state), n = v.rows.length, h = bodyHeight(rows, headed), first = headed ? 3 : 2;
  const seen = new Map();
  for (let guard = 0; guard < n + 2; guard++) {
    const lines = app.lines();
    checkFrame(lines, cols, rows, `${where} page at row ${v.sel}`);
    const body = plainOf(lines).slice(first, first + h);
    const b = body.findIndex((l) => l.startsWith('> '));
    if (n) assert.ok(b >= 0, `${where}: the selected row is not drawn`);
    const t = v.sel - b;
    body.forEach((text, j) => { if (t + j < n) seen.set(t + j, text); });
    if (t + h >= n) break;
    await keys.press(KEY.pagedown);
  }
  assert.equal(seen.size, n, `${where}: ${seen.size} of ${n} rows drawn`);
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([k, text]) => ({ k, text }));
}

/** A row's address: what stands after its two-column marker, up to the next two spaces. */
const addressOf = (text) => text.slice(2).split('  ')[0];
/** The cells of a row: what is between runs of two spaces or more, after the marker. */
const cellsOf = (text) => text.slice(2).trim().split(/ {2,}/);

for (const file of population) {
  const name = path.basename(file);
  test(`frames of ${path.relative(process.cwd(), file)}, at 80 x 24 and 200 x 60`, async () => {
    const sk = ltms(['skeleton', '--', file]);
    const ix = ltms(['index', '--max', '0', '--', file]).find((l) => l.k === 'session') ?? null;
    const skTurns = sk.filter((l) => l.k === 'turn'), skCalls = sk.filter((l) => l.k === 'call');
    const fileLines = readFileSync(file, 'utf8').split('\n');
    // the compactions on the live path, as ltms index prints them; each is drawn after the turn whose records hold it
    // (ltms's turns, in path order: a /compact's boundary can be written before its own prompt), so only their order is
    // checked here, not their place among the turns
    const comps = (ix?.compactions ?? []).map((c) => ({ a: c.boundary, summary: c.summary }));

    for (const [cols, rows] of SIZES) {
      const at = `${name} ${cols}x${rows}`;
      const source = new FileSource({ file });
      const app = new App({ source, cols, rows, timeZone: 'UTC' });
      const keys = keyboard(app);
      try {
        app.start();
        await app.idle();
        const sv = top(app.state);
        assert.equal(sv.kind, 'session', `${at}: the first view`);
        assert.equal(sv.error ?? null, null, `${at}: ${sv.error}`);
        const drawn = await pagesOf(app, keys, cols, rows, `${at} session`);
        if (!skTurns.length && !comps.length) { assert.equal(drawn.length, 0); continue; }
        // compactions and turns, in the order of the lines; a turn's row: its id, channel, calls and failed calls
        const shownTurns = drawn.filter((d) => /:T\d+$/.test(addressOf(d.text)));
        assert.deepEqual(shownTurns.map((d) => addressOf(d.text)), skTurns.map((t) => t.ta), `${at}: the turns`);
        for (const d of shownTurns) {
          const t = skTurns.find((x) => x.ta === addressOf(d.text));
          const [, ch, calls, failed] = cellsOf(d.text);
          const mine = skCalls.filter((c) => c.ta === t.ta);
          // the channel's column is 8 wide: a longer word is read as far as it goes
          if (t.ch !== '(withheld)') assert.ok(ch === t.ch || (ch.endsWith('\u2026') && t.ch.startsWith(ch.slice(0, -1))), `${at}: ${t.ta} channel ${JSON.stringify(ch)}, ltms skeleton: ${JSON.stringify(t.ch)}`);
          assert.equal(calls, mine.length.toLocaleString('en-US'), `${at}: ${t.ta} calls`);
          assert.equal(failed, mine.filter((c) => c.ok === false).length.toLocaleString('en-US'), `${at}: ${t.ta} failed`);
        }
        const shownComps = drawn.filter((d) => / {2}compaction\b/.test(d.text));
        assert.deepEqual(shownComps.map((d) => addressOf(d.text)), comps.map((c) => c.a), `${at}: the compactions`);
        comps.forEach((c, i) => assert.ok(c.summary === null ? / {2}no summary/.test(shownComps[i].text) : shownComps[i].text.includes(`summary ${c.summary}`), `${at}: ${c.a}'s summary ${c.summary}: ${shownComps[i].text}`));

        // each turn: its prompt, its calls (address, ok, error class) and results, as skeleton prints them
        for (const t of skTurns) {
          sv.sel = sv.rows.findIndex((r) => r.kind === 'turn' && r.ta === t.ta);
          await keys.press(KEY.enter);
          const tv = top(app.state);
          assert.equal(tv.kind, 'turn', `${at}: ${t.ta} opens`);
          assert.ok(plainOf(app.lines())[0].includes(`Turn ${t.ta}`), `${at}: ${t.ta}'s title`);
          const items = await pagesOf(app, keys, cols, rows, `${at} ${t.ta}`);
          assert.equal(addressOf(items[0].text), t.a, `${at}: ${t.ta}'s first row is its prompt`);
          assert.equal(cellsOf(items[0].text)[1], 'prompt');
          const calls = items.filter((d) => cellsOf(d.text)[1] === 'call');
          const results = items.filter((d) => cellsOf(d.text)[1] === 'result');
          const mine = skCalls.filter((c) => c.ta === t.ta);
          const said = (c) => (c.ok === true ? 'ok' : c.ok === false ? `failed${c.ek ? ` ${c.ek}` : ''}` : 'no result recorded');
          const key = (a, status) => `${a} ${status}`;
          // a status cut at the screen's edge (a long error class at 80 columns) is read as far as it goes
          const statusOf = (d) => cellsOf(d.text)[2] ?? '';
          const shownCalls = calls.map((d) => ({ a: addressOf(d.text), status: statusOf(d) }));
          const wantCalls = mine.map((c) => ({ a: c.a, status: said(c) }));
          const byA = (x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.status < y.status ? -1 : 1);
          shownCalls.sort(byA); wantCalls.sort(byA);
          assert.deepEqual(shownCalls.map((x) => x.a), wantCalls.map((x) => x.a), `${at}: ${t.ta}'s calls`);
          shownCalls.forEach((x, i) => assert.ok(x.status === wantCalls[i].status || (x.status.endsWith('\u2026') && wantCalls[i].status.startsWith(x.status.slice(0, -1))), `${at}: ${x.a}: ${JSON.stringify(x.status)}, ltms skeleton: ${JSON.stringify(wantCalls[i].status)}`));
          assert.deepEqual(results.map((d) => addressOf(d.text)).sort(), mine.filter((c) => c.r).map((c) => c.r).sort(), `${at}: ${t.ta}'s results`);
          for (const d of items) assert.match(addressOf(d.text), /^(?:agent-)?[^\s:]{1,8}:L\d+$/, `${at}: ${t.ta}: a row without its address: ${d.text}`);

          // each row's record: its address in the title; its lines, joined, are its text; as JSON, the line's record
          for (let k = 0; k < tv.rows.length; k++) {
            tv.sel = k;
            await keys.press(KEY.enter);
            const rv = top(app.state);
            if (rv.kind !== 'record') { assert.fail(`${at}: ${tv.rows[k].a} did not open: ${app.state.note?.text}`); }
            const where = `${at} ${rv.rec.a}`;
            assert.ok(plainOf(app.lines())[0].includes(`Record ${tv.rows[k].a}`), `${where}: the title`);
            for (const json of [false, true]) {
              if (json) await keys.press('j');
              checkFrame(app.lines(), cols, rows, `${where} first page${json ? ' JSON' : ''}`);
              await keys.press(KEY.end);
              checkFrame(app.lines(), cols, rows, `${where} last page${json ? ' JSON' : ''}`);
              const all = recordLines(rv.rec, json, cols).slice().map((l) => l.map((s) => s.text).join(''));
              for (const l of all) { assert.ok(!CC.test(l), `${where}: a control character`); assert.ok(width(l) <= cols, `${where}: ${width(l)} columns`); }
              const squash = (s) => s.replace(/\s+/g, '');
              if (json) {
                const raw = JSON.stringify(JSON.parse(fileLines[rv.rec.line - 1]), null, 1);
                const shown = all.join(''), want = visible(raw);
                assert.equal(squash(shown), squash(rv.rec.raw.more ? want.slice(0, shown.length) : want), `${where}: the JSON shown is the line's record`);
              } else {
                const want = rv.rec.reading.map((p) => `-- ${label(p.label)} --${visible(p.text)}`).join('');
                const shown = all.filter((l) => !/^\.\.\. [\d,]+ more characters? not shown$/.test(l)).join('');
                assert.equal(squash(shown), squash(want), `${where}: the text shown is the record's`);
              }
              await keys.press(KEY.home);
            }
            await keys.press(KEY.left);
            assert.equal(top(app.state), tv, `${at}: Left goes back to the turn`);
          }
          await keys.press(KEY.left);
          assert.equal(top(app.state), sv, `${at}: Left goes back to the session`);
        }
      } finally { app.dispose(); source.dispose(); }
    }
  });
}

// ---- whole frames, line by line -------------------------------------------------------------------------------------
const trimmed = (lines) => plainOf(lines).map((l) => l.replace(/ +$/, ''));

test('the demo session, its third turn and a record, at 80 x 24, line by line', async () => {
  // each line read against the data: ltms skeleton prints T001 L2 typed 2 calls 1 failed, T002 L10 4 and 1, T003 L20 5
  // and 3 (its calls L22 hook-block:demo-gate, L24 and L26 exit-1, L28 and L30 ok; results 111, 58, 69, 56, 35
  // characters), T004 L33 task 1 and 0; ltms records gives L22 at offset 13921, 739 bytes (the core's README)
  const source = new FileSource({ file: path.join(FX, 'demo.jsonl') });
  const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
  const keys = keyboard(app);
  try {
    app.start(); await app.idle();
    assert.deepEqual(trimmed(app.lines()), [
      'ltms-reader  Session demo.jso  demo.jsonl',
      '4 turns  12 calls  5 failed  0 compactions  37 lines  2026-01-05 09:00 to 2026-…',
      '  turn           channel   calls  failed  prompt',
      '> demo.jso:T001  typed         2       1  Please list the files in the demo pro…',
      '  demo.jso:T002  typed         4       1  Fix the spelling mistake in notes.txt…',
      '  demo.jso:T003  typed         5       3  Clean out the build folder, then run …',
      '  demo.jso:T004  task          1       0  <task-notification>',
      ...Array(15).fill(''),
      'demo.jso:T001  prompt demo.jso:L2  lines 2 to 9  7 records  2026-01-05 09:00',
      'demo.jso:T001  Enter opens  Esc back  / search  : address  ? keys  q quits',
    ]);
    await keys.press(KEY.down + KEY.down + KEY.enter);
    assert.deepEqual(trimmed(app.lines()), [
      'ltms-reader  Turn demo.jso:T003  demo.jsonl',
      'typed  5 calls  3 failed  2026-01-05 09:02',
      '  address       kind        what',
      '> demo.jso:L20  prompt      typed  47 characters  Clean out the build folder, t…',
      '  demo.jso:L21  note        meta  <system-reminder>Demo reminder: the test comm…',
      '  demo.jso:L22  call        failed hook-block:demo-gate  Bash  command: rm -rf …',
      '  demo.jso:L23  result      111 characters  PreToolUse:Bash hook error: [bash /…',
      '  demo.jso:L24  call        failed exit-1  Bash  command: npm test',
      '  demo.jso:L25  result      58 characters  Exit code 1',
      '  demo.jso:L26  call        failed exit-1  Bash  command: CI=1 timeout 120 npm …',
      '  demo.jso:L27  result      69 characters  Exit code 1',
      '  demo.jso:L28  call        ok  Edit  file_path: /work/demo-project/src/add.js',
      '  demo.jso:L29  result      56 characters  The file /work/demo-project/src/add.…',
      '  demo.jso:L30  call        ok  Bash  command: cd /work/demo-project && npm test',
      '  demo.jso:L31  result      35 characters  PASS test/add.test.js',
      '  demo.jso:L32  reply       A hook blocked removing the build folder, so it is …',
      ...Array(6).fill(''),
      'demo.jso:L20  prompt  2026-01-05 09:02',
      'demo.jso:L20  Enter opens the record  Esc back  / search  ? keys  q quits',
    ]);
    await keys.press(KEY.down + KEY.down + KEY.enter);
    assert.deepEqual(trimmed(app.lines()), [
      'ltms-reader  Record demo.jso:L22  demo.jsonl',
      'lines 1 to 5 of 5  1 part  assistant  2026-01-05 09:02  739 bytes at offset 13,…',
      '-- tool call: Bash --',
      '{',
      '  "command": "rm -rf ./build",',
      '  "description": "Remove the build folder"',
      '}',
      ...Array(15).fill(''),
      'demo.jso:L22  line 22 of demo.jsonl  uuid a0000000-0000-4000-8000-000000000022',
      'demo.jso:L22  j JSON  Esc back  PgUp PgDn pages  / search  ? keys  q quits',
    ]);
    await keys.press(KEY.escape);
    assert.equal(trimmed(app.lines())[0], 'ltms-reader  Turn demo.jso:T003  demo.jsonl', 'Esc goes back');
  } finally { app.dispose(); source.dispose(); }
});

test('Hebrew and English: a result and a long reply, at 80 x 24 and 200 x 60, line by line (the text as written)', async () => {
  const source = new FileSource({ file: path.join(OWN, 'hebrew-english.jsonl') });
  for (const [cols, rows] of SIZES) {
    const app = new App({ source, cols, rows, timeZone: 'UTC' });
    const keys = keyboard(app);
    try {
      app.start(); await app.idle();
      const s = trimmed(app.lines());
      assert.ok(s[3].startsWith('> hebrew-e:T001  typed         1       0  בְּרֵאשִׁית: read src/מודול.ts (line 12)'), s[3]);
      await keys.press(KEY.enter + KEY.down + KEY.down + KEY.enter);   // T001, its result at L4
      const r = trimmed(app.lines());
      assert.equal(r[0], 'ltms-reader  Record hebrew-e:L4  hebrew-english.jsonl');
      // the result as the file holds it, line by line, its tab as spaces to column 8 (after "13:", three columns)
      const res = JSON.parse(readFileSync(path.join(OWN, 'hebrew-english.jsonl'), 'utf8').split('\n')[3]).message.content[0].content;
      assert.deepEqual(r.slice(2, 6), ['-- tool result --', ...res.split('\n').map((l) => l.replace('\t', ' '.repeat(8 - l.indexOf('\t'))))]);
      assert.equal(r[4].slice(0, 8), '13:     ');
      await keys.press(KEY.escape);
      await keys.press(KEY.escape);
      await keys.press(KEY.down + KEY.enter + KEY.end + KEY.enter);   // T002, its last row: the long reply at L9
      const lines = trimmed(app.lines());
      assert.equal(lines[0], 'ltms-reader  Record hebrew-e:L9  hebrew-english.jsonl');
      const body = lines.slice(3).filter((l) => l !== '').slice(0, -2);
      for (const l of body) assert.ok(width(l) <= cols);
      const text = JSON.parse(readFileSync(path.join(OWN, 'hebrew-english.jsonl'), 'utf8').split('\n')[8]).message.content[0].text;
      assert.equal(body.join(''), text, 'the reply, cut by columns, joins back to its text');
      // every cluster of this reply takes one column, so each line but the last is full: 4 lines at 80, 2 at 200
      assert.deepEqual(body.map((l) => width(l)), [...Array(body.length - 1).fill(cols), width(body[body.length - 1])], 'each line full but the last');
      assert.equal(body.length, cols === 80 ? 4 : 2);
    } finally { app.dispose(); }
  }
  source.dispose();
});

test('Projects and Sessions over a folder of projects: what ltms index lists, at 80 x 24 and 200 x 60', async () => {
  const r = makeRoot();
  try {
    for (const [cols, rows] of SIZES) {
      const source = new RootSource({ root: r.root });
      const app = new App({ source, cols, rows, timeZone: 'UTC' });
      const keys = keyboard(app);
      try {
        app.start(); await app.idle();
        const p = await pagesOf(app, keys, cols, rows, `projects ${cols}x${rows}`);
        // a project's count: its transcripts at the top (the agent in a session's own folder is not one ltms index reads)
        const counted = p.map((d) => [addressOf(d.text), cellsOf(d.text)[1]]).sort();
        assert.deepEqual(counted, [['-work-demo', '2'], ['-work-other', '2']]);
        top(app.state).sel = top(app.state).rows.findIndex((x) => x.name === '-work-demo');
        await keys.press(KEY.enter);
        const s = await pagesOf(app, keys, cols, rows, `sessions ${cols}x${rows}`);
        const ix = ltms(['index', '--max', '0', '--', path.join(r.root, '-work-demo')]).filter((l) => l.k === 'session');
        assert.deepEqual(s.map((d) => addressOf(d.text)), ix.map((l) => l.p), 'newest first, as ltms index lists them');
        s.forEach((d, i) => {
          const c = cellsOf(d.text), l = ix[i];
          assert.deepEqual(c.slice(2, 7), [l.turns, l.calls, l.failures, l.compactions.length, l.agents].map(String), `${l.p}: turns, calls, failed, compactions, agents`);
          assert.equal(c[1], new Date(l.first).toISOString().slice(0, 16).replace('T', ' '), `${l.p}: started`);
          if (cols >= 120) assert.ok(c.some((x) => x.startsWith(path.basename(l.path))), `${l.p}: its file, on a wide screen`);
        });
      } finally { app.dispose(); source.dispose(); }
    }
  } finally { r.dispose(); }
});

test('the reader\'s own fixtures are what make-fixtures.mjs writes', async () => {
  const { HEBREW_ENGLISH, ESCAPES, CHANNELS } = await import('./fixtures/make-fixtures.mjs');
  assert.equal(readFileSync(path.join(OWN, 'hebrew-english.jsonl'), 'utf8'), HEBREW_ENGLISH);
  assert.equal(readFileSync(path.join(OWN, 'escapes.jsonl'), 'utf8'), ESCAPES);
  assert.equal(readFileSync(path.join(OWN, 'channels.jsonl'), 'utf8'), CHANNELS);
  assert.equal(HEB.length, 42);
});
