// test/repairs.test.mjs — one test for each repair the cold seats asked for that can be shown without a window: each
// fails on the code before the repairs (ltms-gui's commit before 96aaee8) and passes on it. The finding it answers is in
// its name (A: the stranger in the window, B: the adversary, C: the claims reader). The one that drives the page's router
// (B.F10) stays with the router, in ltms-gui.
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Refusal, childEnv } from '../src/engine.mjs';
import { parseTranscript } from 'long-term-memory-structure';
import * as V from '../src/view.mjs';
const { sessionView } = V;
const CAPS = V.CAPS ?? { turnItems: 200 };
const turnItems = (...a) => { assert.ok(V.turnItems, 'view.mjs has no turnItems'); return V.turnItems(...a); };

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'ltms');
const top = mkdtempSync(path.join(tmpdir(), 'ltms-reader-repairs-'));
test.after(() => { try { chmodSync(path.join(top, 'root', '-locked'), 0o755); } catch {} rmSync(top, { recursive: true, force: true }); });

const root = path.join(top, 'root'), APP = '-home-me-app', DEMO = '11111111-1111-4111-8111-111111111111.jsonl';
mkdirSync(path.join(root, APP), { recursive: true });
cpSync(path.join(FX, 'demo.jsonl'), path.join(root, APP, DEMO));
cpSync(path.join(FX, 'agent-a0123456789abcdef.jsonl'), path.join(root, APP, 'agent-a0123456789abcdef.jsonl'));   // the earlier layout

const base = (sid) => ({ isSidechain: false, userType: 'external', cwd: '/work/x', sessionId: sid, version: '2.0.0', gitBranch: 'main', entrypoint: 'cli' });
const uuid = (p, n) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** A turn of n Bash calls, each answered. */
function manyCalls(n, sid) {
  const recs = [{ ...base(sid), parentUuid: null, type: 'user', message: { role: 'user', content: 'run them all' }, uuid: uuid('e', 1), timestamp: '2026-01-08T10:00:00.000Z', promptSource: 'typed' }];
  let parent = uuid('e', 1), k = 2;
  for (let i = 0; i < n; i++) {
    const a = uuid('e', k++), r = uuid('e', k++), id = `toolu_${i}`;
    recs.push({ ...base(sid), parentUuid: parent, type: 'assistant', message: { id: `msg_${i}`, type: 'message', role: 'assistant', model: 'm', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: `echo ${i}` } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }, requestId: `req_${i}`, uuid: a, timestamp: '2026-01-08T10:00:01.000Z' });
    recs.push({ ...base(sid), parentUuid: a, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: String(i), is_error: false }] }, uuid: r, timestamp: '2026-01-08T10:00:02.000Z' });
    parent = r;
  }
  return `${recs.map((x) => JSON.stringify(x)).join('\n')}\n`;
}

test('a session view carries at most CAPS.turnItems items of a turn, says how many it left out, and the rest comes by turnItems', () => {
  const t = parseTranscript(manyCalls(250, 'f'));
  const v = sessionView(t, { name: 'ffffffff-big.jsonl' });
  assert.equal(v.turns[0].items.length, CAPS.turnItems);
  assert.equal(v.turns[0].itemsMore, 250 - CAPS.turnItems);
  const all = turnItems(t, { name: 'ffffffff-big.jsonl', ta: 'ffffffff:T001' });
  assert.equal(all.items.filter((x) => x.kind === 'call').length, 250);
  assert.equal(all.total, 250);
  assert.equal(v.turns[0].calls, 250, 'the counts are taken before the cap');
  assert.ok(v.turns[0].from <= v.turns[0].line && v.turns[0].to >= 500, "the turn's lines, for an address in its cut items");
  assert.equal(turnItems(t, { name: 'ffffffff-big.jsonl', ta: 'ffffffff:T009' }), null);
});

test('B.F12: records before the first prompt (a session that opens with a compaction) are drawn as a lead-in', () => {
  const sid = 'g', recs = [
    { ...base(sid), parentUuid: null, logicalParentUuid: 'zzzz', type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: 1000, postTokens: 100 }, uuid: uuid('f', 1), timestamp: '2026-01-09T10:00:00.000Z' },
    { ...base(sid), parentUuid: uuid('f', 1), type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued from a previous conversation.' }, uuid: uuid('f', 2), timestamp: '2026-01-09T10:00:01.000Z' },
    { ...base(sid), parentUuid: uuid('f', 2), type: 'user', message: { role: 'user', content: 'go on' }, uuid: uuid('f', 3), timestamp: '2026-01-09T10:00:02.000Z', promptSource: 'typed' },
  ];
  const v = sessionView(parseTranscript(`${recs.map((x) => JSON.stringify(x)).join('\n')}\n`), { name: 'gggggggg-lead.jsonl' });
  assert.equal(v.index.compactions.length, 1, 'the header counts it');
  assert.deepEqual(v.lead.map((x) => [x.kind, x.a]), [['compaction', 'gggggggg:L1'], ['summary', 'gggggggg:L2']], 'and it is drawn');
  assert.deepEqual([v.lead[0].trigger, v.lead[0].pre, v.lead[0].post], ['auto', 1000, 100], "A.F6: the compaction says what its record says");
});

test('B.F2, C-09: a projects folder that is itself a symbolic link is read; what is shown is the folder as given', async () => {
  const link = path.join(top, 'projects-link');
  symlinkSync(root, link);
  const e = new Engine({ root: link, env: childEnv(process.env) });
  try {
    assert.equal(e.rootState(), 'dir');
    assert.deepEqual(e.projects().projects.map((p) => p.name), [APP]);
    assert.equal(e.rootShown(), link);
    assert.equal((await e.index(APP)).sessions.length >= 1, true);
  } finally { e.dispose(); }
});

test('B.F7, B.F13: a project folder that cannot be listed is marked, and the rest are listed; the count is of files', async () => {
  mkdirSync(path.join(root, '-locked'));
  chmodSync(path.join(root, '-locked'), 0o000);
  const e = new Engine({ root, env: childEnv(process.env) });
  try {
    const p = e.projects();
    assert.equal(p.projects.find((x) => x.name === APP).files, 2);
    assert.ok(p.projects.find((x) => x.name === '-locked').unreadable, 'marked');
    assert.deepEqual((await e.resolve(null, '11111111')).map((x) => x.file), [DEMO], 'and an address lookup over every project still works');
  } finally { e.dispose(); chmodSync(path.join(root, '-locked'), 0o755); rmSync(path.join(root, '-locked'), { recursive: true }); }
});

test("an agent's transcript at a project's top is found by its address prefix; a prefix is what ltms prints, matched whole", async () => {
  const e = new Engine({ root, env: childEnv(process.env) });
  try {
    assert.deepEqual((await e.resolve(APP, 'agent-a0123456')).map((x) => x.file), ['agent-a0123456789abcdef.jsonl']);
    assert.deepEqual(await e.resolve(APP, '1111'), [], 'a shorter prefix is only some file\'s whole prefix, not the start of one');
    await assert.rejects(() => e.resolve(APP, '111111111'), (err) => err instanceof Refusal && err.kind === 'bad-name');
  } finally { e.dispose(); }
});

test('B.F5, B.F6: two requests for one index share one run; a run that ends without its coverage line is a failure, never cached', async () => {
  // a runtime that counts its runs, then runs Node
  const counter = path.join(top, 'runs.txt'), counting = path.join(top, 'counting-node.sh');
  writeFileSync(counter, '');
  writeFileSync(counting, `#!/bin/sh\necho x >> ${JSON.stringify(counter)}\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 });
  const e = new Engine({ root, runtime: counting, env: childEnv(process.env) });
  try {
    const [a, b] = await Promise.all([e.index(APP), e.index(APP)]);
    assert.equal(a, b);
    assert.equal(execFileSync('wc', ['-l', counter], { encoding: 'utf8' }).trim().split(' ')[0], '1', 'one ltms run');
  } finally { e.dispose(); }
  // a runtime that prints nothing and exits: no coverage line
  const mute = path.join(top, 'mute.sh');
  writeFileSync(mute, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const m = new Engine({ root, runtime: mute, env: childEnv(process.env) });
  try {
    await assert.rejects(m.index(APP), (err) => err instanceof Refusal && err.kind === 'index-failed');
    await assert.rejects(m.index(APP), (err) => err instanceof Refusal && err.kind === 'index-failed', 'not served from a cache');
  } finally { m.dispose(); }
});

test('B.F15: the reading process refuses a file that is no longer in the folder that was checked', async () => {
  const e = new Engine({ root, env: childEnv(process.env) });
  try {
    await assert.rejects(e.helper.request('session', { file: path.join(root, APP, DEMO), dir: path.join(top, 'elsewhere'), name: DEMO }), (err) => err instanceof Refusal && err.kind === 'not-file' && /no longer in the folder/.test(err.message));
    assert.equal((await e.helper.request('session', { file: path.join(root, APP, DEMO), dir: path.join(root, APP), name: DEMO })).turns.length, 4);
  } finally { e.dispose(); }
});

test("C-05, C-06: the reading process skips a file by ltms's own rule, a tenth of its runtime's heap limit (and never past 480 MB)", async () => {
  const e = new Engine({ root, env: childEnv(process.env) });
  try {
    const hello = await e.helper.request('hello', {});
    const heap = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(require("v8").getHeapStatistics().heap_size_limit))'], { encoding: 'utf8' }));
    assert.equal(hello.maxFile, Math.min(480 * 1024 * 1024, Math.floor(heap / 10)));
  } finally { e.dispose(); }
});

test('a FIFO at a transcript\'s name is refused at once, never waited on (the open is non-blocking)', async () => {
  const fifo = path.join(root, APP, '99999999-fifo.jsonl');
  execFileSync('mkfifo', [fifo]);
  const e = new Engine({ root, env: childEnv(process.env) });
  try {
    const r = await Promise.race([e.helper.request('session', { file: fifo, dir: path.join(root, APP), name: path.basename(fifo) }).then(() => 'read', (err) => err.kind), new Promise((res) => setTimeout(() => res('blocked'), 3000))]);
    assert.equal(r, 'not-file');
  } finally { e.dispose(); rmSync(fifo, { force: true }); }
});

test('under a projects folder that is a link, a session asked for before the projects opens', async () => {
  const link = path.join(top, 'projects-link-2');
  symlinkSync(root, link);
  const e = new Engine({ root: link, env: childEnv(process.env) });
  try { assert.equal((await e.session(APP, DEMO)).turns.length, 4); } finally { e.dispose(); }
});

test('a reading process that never answers ends in a refusal that names the file, and is started again', async () => {
  const mute = path.join(top, 'never-answers.sh');
  writeFileSync(mute, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
  const e = new Engine({ root, runtime: mute, env: childEnv(process.env), timeoutMs: 400 });
  try {
    await assert.rejects(e.session(APP, DEMO), (err) => err instanceof Refusal && err.kind === 'timeout' && err.message.includes(DEMO));
    assert.equal(e.helper.child, null, 'the stuck process was stopped');
  } finally { e.dispose(); }
});
