// test/large.test.mjs — a turn too long for a call's arguments: one prompt and 33,000 tool calls (66,001 records, about
// 132,000 line numbers in the turn: more than the 125,000 or so arguments a spread call takes on Node 26's default
// stack). Its session view, its turn's view and the screen's frames are made without passing those numbers as
// arguments. The transcript is written in a folder of the test's own.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../src/app.mjs';
import { FileSource } from '../src/sources.mjs';
import { readTranscript } from '../src/reading.mjs';
import { top } from '../src/views.mjs';
import { KEY, keyboard, plainOf } from './helpers.mjs';

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
    const d = readTranscript(file);
    assert.equal(d.view.turns.length, 1);
    assert.equal(d.view.turns[0].calls, CALLS);
    assert.deepEqual([d.view.turns[0].from, d.view.turns[0].to], [1, 2 * CALLS + 1]);
    const source = new FileSource({ file });
    const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
    const k = keyboard(app);
    try {
      app.start(); await app.idle();
      assert.equal(top(app.state).error ?? null, null);
      await k.press(KEY.enter);
      assert.equal(top(app.state).kind, 'turn');
      assert.equal(top(app.state).rows.length, 1 + 2 * CALLS);
      await k.press(KEY.end);
      const f = plainOf(app.lines());
      assert.match(f.find((l) => l.startsWith('> ')), /^> large\.js:L66001 {2}result /, 'the last row, its address whole');
    } finally { app.dispose(); source.dispose(); }
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
