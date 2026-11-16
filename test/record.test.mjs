// test/record.test.mjs — Details: the record the extension shows at an address is the line of the file at that number,
// and the text it shows around a search match is what ltms's README tells a reader to print for it.
//
// Two independent methods:
//   1. every line of every file of the population, read by splitting the file's bytes on "\n" and parsing the line
//      with JSON.parse, against recordView: the same record, its byte offset and its length;
//   2. every entry of every hit `ltms search` returns for a word of each file's first prompt, with `--kind all`, against
//      the README's own command for reading a hit (test/fixtures/reading-a-hit.recipe.js, copied verbatim from ltms's
//      README at v0.2.0), run as the README runs it: node -e.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript } from 'long-term-memory-structure';
import { fieldWindow, recordView, sessionView, recordIndexAt } from '../src/view.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = createRequire(import.meta.url).resolve('long-term-memory-structure/dist/cli.js');
const RECIPE = readFileSync(path.join(here, 'fixtures', 'reading-a-hit.recipe.js'), 'utf8').trim();
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.isFile() && e.name.endsWith('.jsonl') ? [path.join(d, e.name)] : []));
const population = [...walk(path.join(here, 'fixtures', 'ltms'))];
if (process.env.LTMS_GUI_CORPUS) population.push(...walk(process.env.LTMS_GUI_CORPUS));

const depth = (v, d = 0) => (v !== null && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map((x) => depth(x, d + 1))) : 0);
let lines = 0, parsed = 0, hits = 0, entries = 0;

for (const file of population) {
  const name = path.basename(file);
  const text = readFileSync(file, 'utf8');
  const t = parseTranscript(text);
  test(`every line as recorded: ${path.relative(process.cwd(), file)}`, () => {
    const parts = text.split('\n');
    let offset = 0;
    parts.forEach((raw, k) => {
      const line = k + 1, bytes = Buffer.byteLength(raw, 'utf8');
      let obj; try { obj = JSON.parse(raw); } catch { obj = undefined; }
      const isObject = obj !== null && typeof obj === 'object' && !Array.isArray(obj);
      const v = recordView(t, line, { name });
      if (isObject && depth(obj) <= 1000) {
        assert.ok(v, `line ${line}: a JSON object, and the view has no record there`);
        assert.equal(v.offset, offset, `line ${line}: byte offset`);
        assert.equal(v.bytes, bytes, `line ${line}: byte length`);
        assert.equal(v.raw.more, 0, `line ${line}: clipped`);
        assert.deepEqual(JSON.parse(v.raw.text), obj, `line ${line}: the record`);
        assert.equal(v.a, `${sessionView(t, { name }).prefix}:L${line}`, `line ${line}: address`);
        parsed++;
      } else {
        assert.equal(v, null, `line ${line}: not a record (${raw === '' ? 'blank' : isObject ? 'nested too deep' : 'not a JSON object'}), and the view shows one`);
      }
      offset += bytes + 1; lines++;
    });
  });
  test(`search hits read as the README reads them: ${path.relative(process.cwd(), file)}`, () => {
    const v = sessionView(t, { name });
    const first = v.turns[0]?.prompt.text.match(/\p{L}{4,}/u)?.[0];
    if (!first) return;
    let out = '';
    try { out = execFileSync(process.execPath, [CLI, 'search', '--kind', 'all', '--max', '0', '--', first, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }); }
    catch (e) { out = String(e.stdout ?? ''); }
    for (const h of out.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.k === 'hit')) {
      hits++;
      for (const e of h.at) {
        const line = Number(e.a.slice(e.a.lastIndexOf(':L') + 2));
        const r = t.records[recordIndexAt(t, line)];
        const w = fieldWindow(r, e.field, e.at, 600);
        const readme = execFileSync(process.execPath, ['-e', RECIPE, file, String(line), JSON.stringify(e.field), String(e.at)], { encoding: 'utf8' }).replace(/\n$/, '');
        const ours = w.keys ? `keys here: ${JSON.stringify(w.keys)}` : w.error ?? w.text;
        assert.equal(ours, readme, `${e.a} ${JSON.stringify(e.field)} at ${e.at}`);
        entries++;
      }
    }
  });
}

test('totals', () => {
  console.log(`record: ${lines} lines in ${population.length} files, ${parsed} records equal to their line; ${entries} hit entries in ${hits} hits read as the README reads them`);
  assert.ok(parsed > 0 && entries > 0);
});
