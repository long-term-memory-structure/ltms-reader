// test/large.test.mjs — a turn too long for a call's arguments: one prompt and 33,000 tool calls (66,001 records, about
// 132,000 line numbers in the turn: more than the 125,000 or so arguments a spread call takes on Node 26's default
// stack). Its session view, its turn's view and the screen's frames are made without passing those numbers as
// arguments. The transcript is written in a folder of the test's own, and read in a process of its own (R8b, round 8).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { OWN, plainOf } from './helpers.mjs';

const CALLS = 33_000;

function write(file) {
  const sid = '77777777-7777-4777-8777-777777777777', lines = [];
  let parent = null, n = 0;
  const rec = (r) => { n++; const uuid = `77777777-0000-4000-8000-${String(n).padStart(12, '0')}`; lines.push(JSON.stringify({ parentUuid: parent, sessionId: sid, type: r.type, message: r.message, uuid, timestamp: '2026-11-15T09:00:00.000Z', ...(r.extra ?? {}) })); parent = uuid; };
  rec({ type: 'user', message: { role: 'user', content: 'run the invented step many times' }, extra: { promptSource: 'typed' } });
  for (let i = 0; i < CALLS; i++) {
    rec({ type: 'assistant', message: { id: `m${i}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: 'true' } }] }, extra: { requestId: `r${i}` } });
    rec({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'ok' }] } });
  }
  writeFileSync(file, `${lines.join('\n')}\n`);
}

test(`one turn of ${CALLS.toLocaleString('en-US')} calls: its session view, its turn and their frames`, { timeout: 300_000 }, async () => {
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-large-'));
  try {
    const file = path.join(own, 'large.jsonl');
    write(file);
    // read in a process of its own, with no NODE_OPTIONS (R8b, round 8): in this one, under the suite's
    // NODE_OPTIONS=--max-old-space-size=100, the size rules read that old space and refused the file (21 MB), and with
    // them set aside its parse ran it out; this test is of a turn's length, not of the memory a test runner is given
    const r = spawnSync(process.execPath, [path.join(OWN, 'large-turn.mjs'), file], { cwd: own, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: own, CLAUDE_CONFIG_DIR: own, TZ: 'UTC' }, timeout: 250_000 });
    assert.equal(r.status, 0, `status ${r.status}, signal ${r.signal}: ${(r.stderr ?? '').slice(-600)}`);
    const seen = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.equal(seen.turns, 1);
    assert.equal(seen.calls, CALLS);
    assert.deepEqual([seen.from, seen.to], [1, 2 * CALLS + 1]);
    assert.equal(seen.error, null);
    assert.equal(seen.kind, 'turn');
    assert.equal(seen.rows, 1 + 2 * CALLS);
    assert.match(seen.selected, /^> large\.js:L66001 {2}result /, 'the last row, its address whole');
  } finally { rmSync(own, { recursive: true, force: true }); }
});

test('a list of 300,000 rows: its columns measured without spreading the rows into a call', async () => {
  const { render } = await import('../src/views.mjs');
  const rows = Array.from({ length: 300_000 }, (_, i) => ({ kind: 'call', a: `abcdefgh:L${i + 1}`, line: i + 1, tool: 'Bash', ok: true, inputKey: 'command', inputText: 'true', r: null }));
  const view = { kind: 'turn', rows, sel: rows.length - 1, top: 0, doc: { ek: null }, turn: { ta: 'abcdefgh:T001', ch: 'typed', calls: rows.length, failed: 0 }, project: null, file: 'x.jsonl' };
  const lines = plainOf(render({ cols: 80, rows: 24, stack: [view], input: null, help: false, note: null, now: 0 }, 80, 24));
  assert.equal(lines.length, 24);
  assert.match(lines.find((l) => l.startsWith('> ')), /^> abcdefgh:L300000 {2}call {8}ok {2}Bash /);
});

// R.F9: counts of 10,000 or more were cut in their 5-column cells ("12,0…")
test('R.F9: counts of 10,000 and more are whole: Sessions\' turns, calls, failed, compactions and agents; a session\'s calls and failed', async () => {
  const { render } = await import('../src/views.mjs');
  const counts = { turns: 12_000, calls: 35_000, failures: 1_715, compactions: 10_500, agents: 123_456 };
  const sessions = { kind: 'sessions', project: '-work-big', data: { sessions: [{}], coverage: { files: { found: 1, read: 1, failed: 0 } }, ms: 3800 }, rows: [{ kind: 'session', p: '71717171', first: '2026-03-01T10:00:00.000Z', last: '2026-03-01T11:00:00.000Z', ...counts, file: '71717171.jsonl', copies: 0 }], sel: 0, top: 0 };
  for (const cols of [80, 200]) {
    const lines = plainOf(render({ cols, rows: 24, stack: [sessions], input: null, help: false, note: null, now: 0, timeZone: 'UTC' }, cols, 24));
    const row = lines.find((l) => l.startsWith('> 71717171'));
    assert.deepEqual(row.slice(2).trim().split(/ {2,}/).slice(2, 7), ['12,000', '35,000', '1,715', '10,500', '123,456'], `Sessions at ${cols}: ${row}`);
    const head = lines[2].trim().split(/ {2,}/);
    assert.deepEqual(head.slice(2, 7), ['turns', 'calls', 'failed', 'compact', 'agents'], `the headings over them at ${cols}: ${lines[2]}`);
    // each count right-aligned under its heading: the heading ends where the count ends
    for (const [h, c] of [['turns', '12,000'], ['calls', '35,000'], ['failed', '1,715'], ['compact', '10,500'], ['agents', '123,456']]) assert.equal(lines[2].indexOf(` ${h}`) + 1 + h.length, row.indexOf(` ${c}`) + 1 + c.length, `${h} over ${c}`);
  }
  const doc = { view: { turns: [{}], index: { failures: 12_345, calls: 35_000, compactions: [] }, stats: { lines: 70_001, parsed: 70_001, first: '2026-03-01T10:00:00.000Z', last: '2026-03-01T11:00:00.000Z' }, fileKind: 'transcript', problems: { count: 0 } } };
  const session = { kind: 'session', project: null, file: 'oneturn3.jsonl', doc, rows: [{ kind: 'turn', index: 0, ta: 'oneturn3:T001', a: 'oneturn3:L1', ch: 'typed', calls: 35_000, failed: 12_345, prompt: 'one turn, many calls', command: null, from: 1, to: 70_001, records: 70_001 }], sel: 0, top: 0 };
  for (const cols of [80, 200]) {
    const lines = plainOf(render({ cols, rows: 24, stack: [session], input: null, help: false, note: null, now: 0, timeZone: 'UTC' }, cols, 24));
    const row = lines.find((l) => l.startsWith('> oneturn3:T001'));
    assert.deepEqual(row.slice(2).trim().split(/ {2,}/).slice(1, 4), ['typed', '35,000', '12,345'], `a session at ${cols}: ${row}`);
  }
});
