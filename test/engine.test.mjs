// test/engine.test.mjs — the engine on a root of projects built from ltms's fixtures: what it lists, what it reads, the
// known answers ltms's README prints for test/fixtures/demo.jsonl, and every name it must refuse.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Refusal, childEnv } from '../src/engine.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'ltms');
const root = mkdtempSync(path.join(tmpdir(), 'ltms-reader-root-'));
const DEMO = '11111111-1111-4111-8111-111111111111.jsonl', COMP = '22222222-2222-4222-8222-222222222222.jsonl', SID = DEMO.slice(0, -6);
mkdirSync(path.join(root, '-home-me-app', SID, 'subagents'), { recursive: true });
cpSync(path.join(FX, 'demo.jsonl'), path.join(root, '-home-me-app', DEMO));
cpSync(path.join(FX, 'compacted.jsonl'), path.join(root, '-home-me-app', COMP));
cpSync(path.join(FX, 'agent-a0123456789abcdef.jsonl'), path.join(root, '-home-me-app', SID, 'subagents', 'agent-a0123456789abcdef.jsonl'));
mkdirSync(path.join(root, '-home-me-other'));
cpSync(path.join(FX, 'unicode.jsonl'), path.join(root, '-home-me-other', '33333333-3333-4333-8333-333333333333.jsonl'));
symlinkSync(path.join(root, '-home-me-app'), path.join(root, '-home-me-link'));                         // a project that is a link
symlinkSync(path.join(root, '-home-me-other', '33333333-3333-4333-8333-333333333333.jsonl'), path.join(root, '-home-me-app', '44444444-4444-4444-8444-444444444444.jsonl'));   // a session that is a link
writeFileSync(path.join(root, 'stray.jsonl'), '');                                                     // a file at the root, in no project

const engine = new Engine({ root, env: childEnv(process.env), idleMs: 60_000 });
test.after(() => { engine.dispose(); rmSync(root, { recursive: true, force: true }); });

const refused = async (f, kind) => { await assert.rejects(async () => f(), (e) => e instanceof Refusal && e.kind === kind, `expected a refusal of kind ${kind}`); };

test('projects: the two folders, newest first, each with its count of transcript files; links counted, not entered', () => {
  const p = engine.projects();
  assert.equal(p.state, 'dir');
  assert.deepEqual(p.projects.map((x) => x.name).sort(), ['-home-me-app', '-home-me-other']);
  assert.equal(p.projects.find((x) => x.name === '-home-me-app').files, 2, 'two regular files; the link is not counted');
  assert.equal(p.links, 1, 'the linked project is counted as a link');
});

test("index: ltms's lines, each with its file name; the README's counts for demo.jsonl", async () => {
  const ix = await engine.index('-home-me-app');
  assert.equal(ix.sessions.length, 2);
  const demo = ix.sessions.find((s) => s.file === DEMO);
  // README, `ltms index`: demo.jsonl has 4 turns, 12 calls, 5 failures, firstPrompt L2, lastPrompt L33, lastReply L36
  assert.deepEqual([demo.turns, demo.calls, demo.failures], [4, 12, 5]);
  assert.deepEqual([demo.firstPrompt, demo.lastPrompt, demo.lastReply], ['11111111:L2', '11111111:L33', '11111111:L36']);
  assert.equal(demo.agents, 1, 'the agent transcript in its own directory');
  assert.equal(ix.coverage.files.symlinks, 1, 'the linked session is met and not read');
  const comp = ix.sessions.find((s) => s.file === COMP);
  assert.deepEqual(comp.compactions, [{ boundary: '22222222:L9', summary: '22222222:L10' }]);
  assert.equal(await engine.index('-home-me-app'), ix, 'the second call is answered from the cache');
});

test('session: the turns and calls; T003 as the README shows it', async () => {
  const v = await engine.session('-home-me-app', DEMO);
  assert.equal(v.turns.length, 4);
  const t3 = v.turns[2];
  assert.equal(t3.ta, '11111111:T003'); assert.equal(t3.a, '11111111:L20'); assert.equal(t3.ch, 'typed');
  const calls = t3.items.filter((x) => x.kind === 'call');
  assert.deepEqual(calls.map((c) => [c.a, c.tool, c.ok, c.r]), [
    ['11111111:L22', 'Bash', false, '11111111:L23'], ['11111111:L24', 'Bash', false, '11111111:L25'],
    ['11111111:L26', 'Bash', false, '11111111:L27'], ['11111111:L28', 'Edit', true, '11111111:L29'], ['11111111:L30', 'Bash', true, '11111111:L31']]);
  assert.equal(calls[1].input.key, 'command');
});

test('an agent transcript: listed under its session, read by its own prefix', async () => {
  const { agents: a, known } = engine.agents('-home-me-app', DEMO);
  assert.deepEqual(a.map((x) => [x.file, x.group]), [[`${SID}/subagents/agent-a0123456789abcdef.jsonl`, 'subagents']]);
  assert.equal(known, true);
  assert.equal(engine.parent('-home-me-app', a[0].file), DEMO, 'the session whose own folder holds it');
  const v = await engine.session('-home-me-app', a[0].file);
  assert.equal(v.prefix, 'agent-a0123456');
  assert.ok(v.turns.length >= 1);
  assert.equal(v.turns[0].ch, 'parent');
});

test('record and window: the line, and the text around a hit, as the README prints them', async () => {
  const r = await engine.record('-home-me-app', DEMO, 22);
  assert.equal(r.a, '11111111:L22'); assert.equal(r.type, 'assistant');
  assert.ok(r.reading.some((p) => p.kind === 'tool_use' && p.label === 'tool call: Bash'));
  const w = await engine.window('-home-me-app', DEMO, 25, ['message', 'content', 0, 'content'], 17);
  assert.equal(w.text, 'Exit code 1\nFAIL test/add.test.js\n  expected 4, received 5');
  await refused(() => engine.record('-home-me-app', DEMO, 999), 'no-record');
  const again = await engine.record('-home-me-app', DEMO, 2);
  assert.equal(again.line, 2, 'the helper answers after a refusal');
});

test("search: ltms's coverage and hits; files named by project and file; one project or all", async () => {
  const s = await engine.searchFor({ project: '-home-me-app', q: 'npm test' });
  assert.equal(s.coverage.hits.turns, 1);
  assert.deepEqual(s.files.map((f) => [f.project, f.file]), [['-home-me-app', DEMO]]);
  assert.equal(s.hits[0].ta, '11111111:T003');
  const all = await engine.searchFor({ project: null, q: 'npm test' });
  assert.deepEqual(all.files.map((f) => [f.project, f.file]), [['-home-me-app', DEMO]], 'over the root: the same file, under its project');
  const dash = await engine.searchFor({ project: '-home-me-app', q: '-v' });
  assert.equal(dash.code, 0, 'a query that starts with - is a query, not an option');
});

test('a new search cancels the one running', async () => {
  // a runtime that waits a second before it runs Node: the first search is surely still running when the second starts
  const slow = path.join(root, '..', `slow-node-${process.pid}.sh`);
  writeFileSync(slow, `#!/bin/sh\nsleep 1\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 });
  const e2 = new Engine({ root, runtime: slow, env: childEnv(process.env) });
  try {
    const first = e2.searchFor({ project: null, q: 'npm test' });
    await new Promise((r) => setTimeout(r, 100));
    const second = e2.searchFor({ project: null, q: 'npm test' });
    const [a, b] = await Promise.allSettled([first, second]);
    assert.equal(a.status, 'rejected', 'the first search was not cancelled');
    assert.equal(a.reason.kind, 'cancelled');
    assert.equal(b.status, 'fulfilled');
    assert.equal(b.value.coverage.hits.turns, 1);
  } finally { e2.dispose(); rmSync(slow, { force: true }); }
});

test('every name that is not a listed project or session is refused', async () => {
  for (const p of ['..', '.', '', 'a/b', 'a\\b', 'x\0y', '-home-me-link', '-home-me-none', 42, null]) await refused(() => engine.projectDir(p), typeof p === 'string' && p.startsWith('-home-me-') ? 'no-project' : 'bad-name');
  for (const f of ['../-home-me-other/33333333-3333-4333-8333-333333333333.jsonl', `${SID}/subagents/../../${DEMO}`, `${SID}//x.jsonl`, 'README.md', `${DEMO}\0`, '', null])
    await refused(() => engine.sessionFile('-home-me-app', f), 'bad-name');
  // a path of plain names is a transcript's only where a real folder and a regular file are (any depth, as ltms reads)
  await refused(() => engine.sessionFile('-home-me-app', `${SID}/x/agent-a.jsonl`), 'no-session');
  await refused(() => engine.sessionFile('-home-me-app', '44444444-4444-4444-8444-444444444444.jsonl'), 'no-session');
  await refused(() => engine.sessionFile('-home-me-app', '55555555-5555-4555-8555-555555555555.jsonl'), 'no-session');
  await refused(() => engine.searchFor({ project: '-home-me-app', q: '' }), 'bad-query');
  await refused(() => engine.searchFor({ project: '-home-me-app', q: 'x', max: 0 }), 'bad-query');
  await refused(() => engine.searchFor({ project: '-home-me-app', q: 'x', kinds: ['input,all'] }), 'bad-query');
});

test('the helper comes back after it is killed', async () => {
  await engine.session('-home-me-app', DEMO);
  engine.helper.child.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 200));
  const v = await engine.session('-home-me-app', COMP);
  assert.equal(v.turns.length, 2);
});

// The editor runs both processes with its own binary as Node (ELECTRON_RUN_AS_NODE=1). LTMS_GUI_ELECTRON names one;
// else the first of the usual places that exists.
const ELECTRON = process.env.LTMS_GUI_ELECTRON || ['/usr/lib/electron43/electron', '/usr/share/code/code', '/usr/lib/electron/electron'].find((p) => existsSync(p));
test(`the editor's own runtime runs the CLI and the reading process as Node (${ELECTRON ?? 'none found; set LTMS_GUI_ELECTRON'})`, { skip: ELECTRON ? false : 'no Electron binary found' }, async () => {
  const e3 = new Engine({ root, runtime: ELECTRON, env: childEnv(process.env) });
  try {
    const hello = await e3.helper.request('hello', {});
    // the version of the core installed beside this package, read here by the package's own name (not through #ltms)
    assert.equal(hello.ltms, createRequire(import.meta.url)('long-term-memory-structure/package.json').version); assert.match(hello.node, /^\d+\./);
    assert.equal((await e3.index('-home-me-app')).sessions.length, 2);
    assert.equal((await e3.session('-home-me-app', DEMO)).turns.length, 4);
    assert.equal((await e3.searchFor({ project: '-home-me-app', q: 'npm test' })).coverage.hits.turns, 1);
  } finally { e3.dispose(); }
});

test('the root as the page shows it: the home folder as ~, nothing else rewritten', () => {
  const h = homedir();
  assert.equal(new Engine({ root: path.join(h, '.claude', 'projects') }).rootShown(), `~${path.sep}.claude${path.sep}projects`);
  assert.equal(new Engine({ root: h }).rootShown(), '~');
  assert.equal(new Engine({ root: `${h}2${path.sep}projects` }).rootShown(), `${h}2${path.sep}projects`, 'a folder whose name only starts like home is not home');
  // a folder outside the home folder by construction (N7: the temporary folder is inside it when TMPDIR is, and was
  // then shown, rightly, as ~/...); the temporary folder as the rule shows it, wherever TMPDIR is
  const outside = path.join(path.parse(h).root, `not-${path.basename(h) || 'home'}`, 'x');
  assert.ok(outside !== h && !outside.startsWith(`${h}${path.sep}`), `${outside} is outside ${h}`);
  assert.equal(new Engine({ root: outside }).rootShown(), outside);
  const t = path.join(tmpdir(), 'x');
  assert.equal(new Engine({ root: t }).rootShown(), t.startsWith(`${h}${path.sep}`) ? `~${t.slice(h.length)}` : t);
});

test("the reading process refuses a symbolic link itself, whatever reached it (the engine refuses one first)", async () => {
  const link = path.join(root, '-home-me-app', '44444444-4444-4444-8444-444444444444.jsonl');
  await assert.rejects(engine.helper.request('session', { file: link, name: path.basename(link) }), (e) => e instanceof Refusal && e.kind === 'not-file' && /symbolic link/.test(e.message), 'refused, and the message says why');
  await assert.rejects(engine.helper.request('session', { file: path.join(root, 'nothing-here.jsonl'), name: 'nothing-here.jsonl' }), (e) => e instanceof Refusal && e.kind === 'missing');
  await assert.rejects(engine.helper.request('session', { file: path.join(root, '-home-me-app'), name: 'x.jsonl' }), (e) => e instanceof Refusal && e.kind === 'not-file');
});

// U+2028 and U+2029 end a line for Node's readline, and JSON.stringify leaves them unescaped: a session whose text holds
// one never opened ("Reading…" forever). Both directions and both processes are read by src/lines.mjs, at "\n" only.
test('a transcript or a folder name holding U+2028 or U+2029 is read whole, by the reading process and by ltms', async () => {
  const LS = String.fromCodePoint(0x2028), PS = String.fromCodePoint(0x2029);
  const proj = `-home-me-sep${LS}x`, file = '77777777-7777-4777-8777-777777777777.jsonl';
  mkdirSync(path.join(root, proj));
  const base = { isSidechain: false, userType: 'external', cwd: '/work/x', sessionId: file.slice(0, -6), version: '2.0.0', gitBranch: 'main', entrypoint: 'cli' };
  const recs = [
    { ...base, parentUuid: null, type: 'user', message: { role: 'user', content: `first${LS}second${PS}third` }, uuid: 'd0000000-0000-4000-8000-000000000001', timestamp: '2026-01-07T10:00:00.000Z', promptSource: 'typed' },
    { ...base, parentUuid: 'd0000000-0000-4000-8000-000000000001', type: 'assistant', message: { id: 'msg_s1', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: `reply${LS}with${PS}separators` }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }, requestId: 'req_s1', uuid: 'd0000000-0000-4000-8000-000000000002', timestamp: '2026-01-07T10:00:01.000Z' },
  ];
  writeFileSync(path.join(root, proj, file), `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const v = await Promise.race([engine.session(proj, file), new Promise((_, rej) => setTimeout(() => rej(new Error('no answer in 10 s')), 10_000))]);
  assert.equal(v.turns.length, 1);
  assert.equal(v.turns[0].prompt.text, `first${LS}second${PS}third`);
  assert.equal(v.turns[0].items[0].text, `reply${LS}with${PS}separators`);
  const r = await engine.record(proj, file, 2);
  assert.ok(r.raw.text.includes(`with${PS}separators`) || r.raw.text.includes('with\\u2029separators'));
  const ix = await engine.index(proj);
  assert.equal(ix.sessions.length, 1, 'ltms index printed a path holding U+2028, read whole');
  const s = await engine.searchFor({ project: proj, q: 'second' });
  assert.equal(s.coverage.hits.turns, 1);
  assert.deepEqual(s.files.map((f) => f.project), [proj]);
});
