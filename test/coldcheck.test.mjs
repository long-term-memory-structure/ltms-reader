// test/coldcheck.test.mjs — the findings of S365's cold check (wf_7ac191b3-2dd: seat A read the code against ltms's walk,
// seat B every sentence against the code), each held by a test. Only what the extension exported before the repair is
// imported, so this file runs against the code before it too, and fails there on each defect.
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, childEnv, CLI } from '../src/engine.mjs';
import { walk, agentsOf, parentOf, transcriptAt } from '../src/layout.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'ltms');
const top = mkdtempSync(path.join(tmpdir(), 'ltms-reader-cold-'));
const root = path.join(top, 'projects');
mkdirSync(root);
test.after(() => rmSync(top, { recursive: true, force: true }));
const S = '11111111-1111-4111-8111-111111111111', DEMO = readFileSync(path.join(FX, 'demo.jsonl'), 'utf8');
const project = (name) => { const d = path.join(root, name); mkdirSync(d, { recursive: true }); return d; };
const put = (d, rel, text) => { const to = path.join(d, ...rel.split('/')); mkdirSync(path.dirname(to), { recursive: true }); writeFileSync(to, text); return to; };
const ltms = (...args) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
// a turn added to demo.jsonl: a prompt that holds the query, and its reply, chained to the file's last record
const withTurn = (text, word, n = 1) => {
  const recs = text.trim().split('\n').map((l) => JSON.parse(l)), last = recs.filter((r) => r.uuid).pop();
  const base = { isSidechain: false, userType: 'external', cwd: '/work/demo-project', sessionId: S, version: '2.0.0', gitBranch: 'main' };
  const u1 = `f000000${n}-0000-4000-8000-000000000001`, u2 = `f000000${n}-0000-4000-8000-000000000002`;   // each added turn its own ids
  return `${text.trimEnd()}\n${JSON.stringify({ ...base, parentUuid: last.uuid, type: 'user', message: { role: 'user', content: `please run npm test again, ${word}` }, uuid: u1, timestamp: '2026-01-05T12:00:00.000Z', promptSource: 'typed' })}\n${JSON.stringify({ ...base, parentUuid: u1, type: 'assistant', message: { id: 'msg_x', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } }, requestId: 'req_x', uuid: u2, timestamp: '2026-01-05T12:00:01.000Z' })}\n`;
};
// a runtime that runs ltms, then makes the mirror's copy byte for byte the live file: a file that changed while ltms read
const racing = (live, mirror) => {
  const sh = path.join(top, `race-${path.basename(path.dirname(live))}.sh`);
  writeFileSync(sh, `#!/bin/sh\nif [ "$2" = index ] || [ "$2" = search ]; then ${JSON.stringify(process.execPath)} "$@"; rc=$?; cp ${JSON.stringify(live)} ${JSON.stringify(mirror)}; exit $rc; fi\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 });
  return sh;
};

test('A1 (index): a copy whose line ltms read differently is not folded into the copy shown, even when their bytes agree now', async () => {
  const d = project('-race-index');
  const live = put(d, `${S}.jsonl`, withTurn(DEMO, 'live')), mirror = put(d, `raw/sessions/${S}.jsonl`, withTurn(withTurn(DEMO, 'live'), 'mirror', 2));
  // ltms reads the live file with 5 turns and the mirror with 6; then the mirror becomes the live file's bytes
  const e = new Engine({ root, runtime: racing(live, mirror), env: childEnv(process.env) });
  try {
    const ix = await e.index('-race-index', { fresh: true });
    const turns = ix.sessions.map((s) => [s.file, s.turns]).sort();
    assert.deepEqual(turns, [[`${S}.jsonl`, 5], [`raw/sessions/${S}.jsonl`, 6]], "both lines kept: the mirror's 6th turn is not lost");
    const m = ix.sessions.find((s) => s.file === `raw/sessions/${S}.jsonl`);
    assert.equal(m.copyOf, `${S}.jsonl`);
    assert.equal(ix.copies.files, 0);
  } finally { e.dispose(); }
});

test('A1 (search): a copy whose hits ltms read differently is not folded; the hit only it holds stays on the page', async () => {
  const d = project('-race-search');
  const live = put(d, `${S}.jsonl`, DEMO), mirror = put(d, `raw/sessions/${S}.jsonl`, withTurn(DEMO, 'mirror'));
  const e = new Engine({ root, runtime: racing(live, mirror), env: childEnv(process.env) });
  try {
    const s = await e.searchFor({ project: '-race-search', q: 'npm test', max: 50 });
    const tas = s.hits.map((h) => `${s.files.find((f) => f.f === h.f).file} ${h.ta}`).sort();
    assert.ok(tas.includes(`raw/sessions/${S}.jsonl 11111111:T005`), `the mirror's own hit stays: ${tas.join(' | ')}`);
    assert.equal(s.coverage.hits.turns, s.hits.length + s.folded.turns, "ltms's count = the turns shown + the turns folded");
  } finally { e.dispose(); }
});

test('A5: on a page without the copy shown first, one copy is kept (marked) and the others folded under it', async () => {
  const d = project('-three');
  for (const rel of [`${S}.jsonl`, `backup/${S}.jsonl`, `raw/sessions/${S}.jsonl`]) put(d, rel, DEMO);
  const e = new Engine({ root, env: childEnv(process.env) });
  try {
    // ltms prints the three copies' one hit each, top first: the second page of one-turn pages holds backup/ alone,
    // a page of two from the second holds backup/ and raw/
    const s = await e.searchFor({ project: '-three', q: 'npm test', skip: 1, max: 2 });
    assert.deepEqual(s.files.map((f) => [f.file, f.copyOf]), [[`backup/${S}.jsonl`, `${S}.jsonl`]]);
    assert.deepEqual([s.hits.length, s.folded], [1, { files: 1, turns: 1 }]);
  } finally { e.dispose(); }
});

test("A2: a session whose own folder is a symbolic link: its agents not known, as ltms index says (null)", () => {
  const d = project('-linked'), away = mkdtempSync(path.join(top, 'away-'));
  put(d, `${S}.jsonl`, DEMO);
  cpSync(path.join(FX, 'agent-a0123456789abcdef.jsonl'), path.join(mkdirSync(path.join(away, 'subagents'), { recursive: true }) ?? path.join(away, 'subagents'), 'agent-a0123456789abcdef.jsonl'));
  symlinkSync(away, path.join(d, S));
  const [line] = ltms('index', '--max', '0', '--', d).filter((l) => l.k === 'session');
  assert.equal(line.agents, null, 'ltms: not known');
  assert.equal(agentsOf(d, `${S}.jsonl`).known, false);
});

test('A3: the walk never lists a folder through a symbolic link, the folder given included', () => {
  const d = project('-walklink'), real = path.join(top, 'real-folder');
  put(real, 'x.jsonl', DEMO);
  symlinkSync(real, path.join(d, 'via'));
  const w = walk(path.join(d, 'via'));
  assert.deepEqual([w.files.length, w.links], [0, 1]);
});

test('A4: asked to read again while a run reads the folder and after a change it has not seen, a new run reads it', async () => {
  const d = project('-slow');
  const live = put(d, `${S}.jsonl`, DEMO);
  // a runtime whose ltms index reads, leaves a mark, then takes a second more to end: the change below comes after the
  // first run has read the file and before it answers
  const sh = path.join(top, 'slow.sh'), mark = path.join(top, 'read.mark');
  writeFileSync(sh, `#!/bin/sh\nif [ "$2" = index ]; then ${JSON.stringify(process.execPath)} "$@"; rc=$?; touch ${JSON.stringify(mark)}; sleep 1; exit $rc; fi\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 });
  const marked = async () => { for (let i = 0; i < 200 && !existsSync(mark); i++) await new Promise((r) => setTimeout(r, 25)); assert.ok(existsSync(mark), 'the first run read'); rmSync(mark); };
  const e = new Engine({ root, runtime: sh, env: childEnv(process.env) });
  try {
    const first = e.index('-slow', { fresh: true }).catch((x) => x);
    await marked();
    writeFileSync(live, withTurn(DEMO, 'later'));
    const again = await e.index('-slow', { fresh: true });
    assert.equal(again.sessions[0].turns, 5, 'the turn added after the first run started is read');
    await first;
    // a request that is not fresh, joining a run that started before a change, is told what changed
    const third = e.index('-slow', { fresh: true });
    await marked();
    appendFileSync(live, '\n');
    const joined = await e.index('-slow');
    await third;
    assert.ok(joined.changed && joined.changed.count === 1, JSON.stringify(joined.changed));
  } finally { e.dispose(); }
});

test("A6: the kept list's change test follows ltms index: a session's agent growing is no change, a link appearing is one", async () => {
  const d = project('-kept');
  put(d, `${S}.jsonl`, DEMO);
  const agent = put(d, `${S}/subagents/agent-a0123456789abcdef.jsonl`, readFileSync(path.join(FX, 'agent-a0123456789abcdef.jsonl'), 'utf8'));
  const e = new Engine({ root, env: childEnv(process.env) });
  try {
    const first = await e.index('-kept', { fresh: true });
    e.indexCache.get(d).value.ms = 60_000;
    appendFileSync(agent, '\n');
    assert.equal((await e.index('-kept')).changed, null, 'an agent transcript growing changes no line ltms index prints');
    symlinkSync(path.join(top, 'nowhere'), path.join(d, S, 'subagents', 'a-link'));
    const after = await e.index('-kept');
    assert.ok(after.changed && after.changed.count === 1, `a link in the own folder makes ltms count the agents as not known: ${JSON.stringify(after.changed)}`);
    assert.equal(first.sessions[0].agents, 1);
  } finally { e.dispose(); }
});

test("A10: an agent of a session set aside (no <session>.jsonl, a .orphaned- copy beside its folder) finds that copy", () => {
  const d = project('-orphan'), aside = `${S}.orphaned-1700000000000-abcd.jsonl`;
  put(d, aside, DEMO);
  put(d, `${S}/subagents/agent-a0123456789abcdef.jsonl`, readFileSync(path.join(FX, 'agent-a0123456789abcdef.jsonl'), 'utf8'));
  assert.equal(parentOf(d, `${S}/subagents/agent-a0123456789abcdef.jsonl`), aside);
  assert.deepEqual(agentsOf(d, aside).agents.map((a) => a.file), [`${S}/subagents/agent-a0123456789abcdef.jsonl`]);
});

test('A8: a name holding a backslash, legal on Linux and read by ltms, is a transcript the extension opens', { skip: process.platform === 'win32' }, () => {
  const d = project('-backslash');
  put(d, 'raw\\sessions\\x.jsonl', DEMO);
  assert.ok(transcriptAt(d, 'raw\\sessions\\x.jsonl').abs, 'opened');
  assert.deepEqual(walk(d).files.map((f) => f.rel), ['raw\\sessions\\x.jsonl']);
  const [cov] = ltms('search', '--count', '--', 'x', d);
  assert.equal(cov.files.found, 1);
});

test("B13: files whose name stands for no one transcript (a workflow's journal.jsonl in every run) are never one another's copies", async () => {
  const d = project('-journals');
  put(d, `${S}.jsonl`, DEMO);
  put(d, `${S}/subagents/workflows/wf_1/journal.jsonl`, '{"type":"started","run":"wf_1"}\n');
  put(d, `${S}/subagents/workflows/wf_2/journal.jsonl`, '{"type":"started","run":"wf_2"}\n');
  const e = new Engine({ root, env: childEnv(process.env) });
  try {
    const c = await e.copiesOf('-journals', `${S}/subagents/workflows/wf_1/journal.jsonl`);
    assert.deepEqual([c.copies, c.others], [[], []]);
  } finally { e.dispose(); }
});

test("B15: a row names the copies of its session that ltms does not list (here a copy taken before its first prompt)", async () => {
  const d = project('-unlisted');
  put(d, `${S}.jsonl`, DEMO);
  put(d, `raw/sessions/${S}.jsonl`, `${DEMO.split('\n')[0]}\n`);   // no turn: ltms index lists no session for it
  const e = new Engine({ root, env: childEnv(process.env) });
  try {
    const ix = await e.index('-unlisted', { fresh: true });
    assert.deepEqual(ix.sessions.map((s) => [s.file, s.others]), [[`${S}.jsonl`, [`raw/sessions/${S}.jsonl`]]]);
    assert.equal(e.ltmsLine('-unlisted', `${S}.jsonl`)?.turns, 4, "B3: ltms's own line for the session, kept with the list");
  } finally { e.dispose(); }
});
