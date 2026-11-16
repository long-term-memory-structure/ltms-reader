// test/compaction.test.mjs — A.F5 (S364's stranger, S365's repair): a compaction made by /compact sits in the turn before
// the command that made it, because Claude Code writes the boundary and its summary first and the command's records
// after them, with the command's earlier time. The view moves nothing; the compaction says which /compact made it, and
// that turn says which compaction it made. The records below copy the linkage measured in the demo corpus (dc532898,
// L123–L132: the boundary's logicalParentUuid is the last reply before it, the summary its child, then the caveat, the
// command and its output), with invented text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionView, turnItems } from '../src/view.mjs';

import { SID, name, make } from './fixtures/compact-command.mjs';

test('A.F5: the compaction names the /compact that made it, in the next turn; that turn names it; nothing moves', () => {
  const v = sessionView(make('manual', '2026-03-01T10:00:20.000Z'), { name });
  assert.deepEqual(v.turns.map((t) => [t.ta, t.a]), [['dddddddd:T001', 'dddddddd:L1'], ['dddddddd:T002', 'dddddddd:L6'], ['dddddddd:T003', 'dddddddd:L8']], 'the turns as ltms makes them: the /compact opens T002');
  const c = v.turns[0].items.find((x) => x.kind === 'compaction');
  assert.ok(c, 'the compaction stays in T001, where the file puts it');
  assert.deepEqual(c.by, { ta: 'dddddddd:T002', a: 'dddddddd:L6', line: 6, time: '2026-03-01T10:00:20.000Z' });
  assert.deepEqual(v.turns[1].made, [{ a: 'dddddddd:L3', line: 3, time: '2026-03-01T10:00:40.000Z', lead: false }]);
  assert.equal(v.turns[0].made, undefined);
  assert.equal(v.turns[2].made, undefined);
  // the same in a turn's items read whole (the page asks for them when a turn's items were cut)
  assert.deepEqual(turnItems(make('manual', '2026-03-01T10:00:20.000Z'), { name, ta: 'dddddddd:T001' }).items.find((x) => x.kind === 'compaction').by.ta, 'dddddddd:T002');
});

test('A.F5: a compaction that records no trigger is matched the same; an automatic one, or a /compact typed after it, is not', () => {
  assert.equal(sessionView(make(null, '2026-03-01T10:00:20.000Z'), { name }).turns[0].items.find((x) => x.kind === 'compaction').by?.ta, 'dddddddd:T002');
  const auto = sessionView(make('auto', '2026-03-01T10:00:20.000Z'), { name });
  assert.equal(auto.turns[0].items.find((x) => x.kind === 'compaction').by, undefined);
  assert.equal(auto.turns[1].made, undefined);
  const later = sessionView(make('manual', '2026-03-01T10:00:50.000Z'), { name });
  assert.equal(later.turns[0].items.find((x) => x.kind === 'compaction').by, undefined, 'a command whose time is after the compaction did not make it');
});

test('A.F18: a command typed in Claude Code is read as its name and arguments, not shown as markup', async () => {
  const { commandOf } = await import('../src/view.mjs');
  const v = sessionView(make('manual', '2026-03-01T10:00:20.000Z'), { name });
  assert.deepEqual(v.turns.map((t) => t.command), [null, { name: '/compact', args: '' }, null]);
  assert.deepEqual(commandOf('<command-message>model</command-message>\n<command-name>/model</command-name>\n<command-args>opus</command-args>'), { name: '/model', args: 'opus' });
  for (const t of ['plain text', '', null, '<command-name></command-name>', `<command-name>${'x'.repeat(201)}</command-name>`]) assert.equal(commandOf(t), null, JSON.stringify(t).slice(0, 40));
});
