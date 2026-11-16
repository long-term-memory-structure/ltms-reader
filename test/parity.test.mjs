// test/parity.test.mjs — the session view shows exactly the turns and calls `ltms skeleton` prints, and the counts and
// addresses `ltms index` prints, for every transcript of the population, field by field.
//
// The population: every .jsonl of test/fixtures/ltms (ltms's own synthetic transcripts, v0.2.0), and, when
// LTMS_GUI_CORPUS names a folder, every .jsonl under it at any depth (sessions and their agents' transcripts).
// The CLI is the installed core's (long-term-memory-structure/dist/cli.js), run as a separate process, so this compares
// the extension's reading with the command an agent runs, not the library with itself.
//
//   node --test test/parity.test.mjs
//   LTMS_GUI_CORPUS=/path/to/a/projects/folder node --test test/parity.test.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript } from 'long-term-memory-structure';
import { sessionView } from '../src/view.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = createRequire(import.meta.url).resolve('long-term-memory-structure/dist/cli.js');
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.isFile() && e.name.endsWith('.jsonl') ? [path.join(d, e.name)] : []));
const population = [...walk(path.join(here, 'fixtures', 'ltms'))];
if (process.env.LTMS_GUI_CORPUS) population.push(...walk(process.env.LTMS_GUI_CORPUS));

const ltms = (args) => {
  try { return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout ?? '') }; }
};
const lines = (s) => s.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const LABEL = /^[A-Za-z0-9._:+-]{1,64}$/;

test(`the population is not empty (${population.length} files${process.env.LTMS_GUI_CORPUS ? `, with ${process.env.LTMS_GUI_CORPUS}` : ', fixtures only; LTMS_GUI_CORPUS unset'})`, () => {
  assert.ok(population.length >= 52, `expected ltms's 52 fixtures at least, found ${population.length}`);
});

const totals = { files: 0, turns: 0, calls: 0, failures: 0, compared: 0 };
for (const file of population) {
  const name = path.basename(file);
  test(`skeleton and index parity: ${path.relative(process.cwd(), file)}`, () => {
    const view = sessionView(parseTranscript(readFileSync(file, 'utf8')), { name });
    const sk = lines(ltms(['skeleton', file]).out);
    const cliTurns = sk.filter((l) => l.k === 'turn'), cliCalls = sk.filter((l) => l.k === 'call');
    // turns, in order: address, turn id, channel (where the CLI prints it), prompt length
    assert.equal(view.turns.length, cliTurns.length, 'turn count');
    view.turns.forEach((t, i) => {
      const c = cliTurns[i];
      assert.equal(t.a, c.a, `turn ${i + 1} address`);
      assert.equal(t.ta, c.ta, `turn ${i + 1} id`);
      if (c.ch !== '(withheld)') assert.equal(t.ch, c.ch, `turn ${i + 1} channel`);
      else assert.ok(!LABEL.test(t.ch), `turn ${i + 1}: the CLI withheld a channel that is label-shaped here: ${t.ch}`);
      assert.equal(t.n, c.n, `turn ${i + 1} prompt length`);
    });
    // calls, as multisets per turn: address, turn id, ok, result address, result length, tool (where the CLI prints it)
    const key = (x) => JSON.stringify([x.ta, x.a, x.r, x.ok, x.n]);
    const ours = view.turns.flatMap((t) => t.items.filter((x) => x.kind === 'call').map((x) => ({ ta: t.ta, a: x.a, r: x.r, ok: x.ok, n: x.n, tool: x.tool })));
    assert.deepEqual(ours.map(key).sort(), cliCalls.map(key).sort(), 'calls');
    const toolsOurs = ours.map((x) => `${key(x)}${LABEL.test(x.tool) ? x.tool : '(withheld)'}`).sort();
    const toolsCli = cliCalls.map((x) => `${key(x)}${x.tool}`).sort();
    assert.deepEqual(toolsOurs, toolsCli, 'tool names');
    // the index line: counts and addresses, from the CLI's index of this one file
    const ix = lines(ltms(['index', file]).out).find((l) => l.k === 'session');
    if (cliTurns.length === 0) assert.equal(ix, undefined, 'index lists a file with no turn');
    else {
      for (const f of ['turns', 'calls', 'failures', 'firstPrompt', 'lastPrompt', 'lastReply']) assert.deepEqual(view.index[f], ix[f], `index ${f}`);
      assert.deepEqual(view.index.compactions, ix.compactions, 'index compactions');
      // and the view's own items agree with the index's counts (counted from the items, not from the library's index)
      assert.equal(ours.length, ix.calls, 'calls counted from the items');
      assert.equal(ours.filter((x) => x.ok === false).length, ix.failures, 'failures counted from the items');
      const marks = view.turns.flatMap((t) => t.items.filter((x) => x.kind === 'compaction').map((x) => x.a));
      assert.deepEqual(marks.slice().sort(), ix.compactions.map((c) => c.boundary).sort(), 'compaction boundaries among the items');
    }
    totals.files++; totals.turns += cliTurns.length; totals.calls += cliCalls.length; totals.failures += cliCalls.filter((x) => x.ok === false).length; totals.compared++;
  });
}

test('totals', () => {
  console.log(`parity: ${totals.compared} files, ${totals.turns} turns, ${totals.calls} calls, ${totals.failures} failed calls, each equal to the CLI's`);
  assert.equal(totals.compared, population.length);
});
