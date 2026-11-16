// test/layout.test.mjs — a project laid out as a long-lived one is (S365, measured on our own corpus): sessions at the
// project's top with their agents in workflow folders; a mirror of pinned sessions kept inside the project (raw/sessions/,
// byte-identical copies of live sessions, and sessions that survive only there); a copy that differs; a symbolic link.
// ltms's own output is the reference: every file `ltms search` reads is one the GUI can open, every session `ltms index`
// lists opens, and each session's agents are the ones `ltms index` counts. ltms's fixtures and the demo corpus hold every
// session at the top and no workflow, which is why the defects these tests hold (D-1, D-2) went unseen before.
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Refusal, childEnv, changes, CLI } from '../src/engine.mjs';
import { walk, agentsOf, parentOf, transcriptAt, byPlace } from '../src/layout.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'ltms');
const root = mkdtempSync(path.join(tmpdir(), 'ltms-reader-layout-'));
const P = '-home-me-long', dir = path.join(root, P);
const S1 = '11111111-1111-4111-8111-111111111111', S2 = '22222222-2222-4222-8222-222222222222', S3 = '33333333-3333-4333-8333-333333333333';
const AG = 'agent-a0123456789abcdef.jsonl', WA = 'agent-ab000000000000001.jsonl', RA = 'agent-ac000000000000002.jsonl';
const put = (rel, from) => { const to = path.join(dir, ...rel.split('/')); mkdirSync(path.dirname(to), { recursive: true }); cpSync(from, to); return to; };
// live: S1 with a direct agent and a workflow's agent and journal; S3
put(`${S1}.jsonl`, path.join(FX, 'demo.jsonl'));
put(`${S1}/subagents/${AG}`, path.join(FX, AG));
put(`${S1}/subagents/workflows/wf_1/${WA}`, path.join(FX, AG));
writeFileSync(path.join(dir, S1, 'subagents', 'workflows', 'wf_1', 'journal.jsonl'), '{"type":"started","run":"wf_1"}\n');
put(`${S3}.jsonl`, path.join(FX, 'unicode.jsonl'));
// the mirror: S1 and its agents byte for byte; S2 only here, with a workflow agent; S3 as it was some lines ago
for (const rel of [`${S1}.jsonl`, `${S1}/subagents/${AG}`, `${S1}/subagents/workflows/wf_1/${WA}`, `${S1}/subagents/workflows/wf_1/journal.jsonl`]) put(`raw/sessions/${rel}`, path.join(dir, ...rel.split('/')));
put(`raw/sessions/${S2}.jsonl`, path.join(FX, 'compacted.jsonl'));
put(`raw/sessions/${S2}/subagents/workflows/wf_2/${RA}`, path.join(FX, AG));
const s3lines = readFileSync(path.join(FX, 'unicode.jsonl'), 'utf8').split('\n');
writeFileSync(path.join(dir, 'raw', 'sessions', `${S3}.jsonl`), `${s3lines.slice(0, Math.max(2, s3lines.length - 3)).join('\n')}\n`);
// a link inside the project (to the mirror): counted, never followed; and one that leads out of the projects folder,
// to a folder that holds a transcript of its own (followed, the walk would list a file outside the project)
symlinkSync(path.join(dir, 'raw'), path.join(dir, 'mirror-link'));
const outside = mkdtempSync(path.join(tmpdir(), 'ltms-reader-outside-'));
cpSync(path.join(FX, 'demo.jsonl'), path.join(outside, '99999999-9999-4999-8999-999999999999.jsonl'));
symlinkSync(outside, path.join(dir, 'outside-link'));
for (const f of [`${S1}.jsonl`, `raw/sessions/${S1}.jsonl`]) utimesSync(path.join(dir, ...f.split('/')), new Date('2026-03-01'), new Date('2026-03-01'));

const ltms = (...args) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const engine = new Engine({ root, env: childEnv(process.env) });
test.after(() => { engine.dispose(); rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
const rel = (abs) => path.relative(dir, abs).split(path.sep).join('/');

test('the walk is what ltms search reads: every regular .jsonl at any depth, the link counted and not followed', () => {
  const w = walk(dir);
  assert.deepEqual(w.files.map((f) => f.rel), [
    `${S1}.jsonl`, `${S1}/subagents/${AG}`, `${S1}/subagents/workflows/wf_1/${WA}`, `${S1}/subagents/workflows/wf_1/journal.jsonl`, `${S3}.jsonl`,
    `raw/sessions/${S1}.jsonl`, `raw/sessions/${S1}/subagents/${AG}`, `raw/sessions/${S1}/subagents/workflows/wf_1/${WA}`, `raw/sessions/${S1}/subagents/workflows/wf_1/journal.jsonl`,
    `raw/sessions/${S2}.jsonl`, `raw/sessions/${S2}/subagents/workflows/wf_2/${RA}`, `raw/sessions/${S3}.jsonl`,
  ].sort());
  assert.equal(w.links, 2, 'the link to the mirror and the link out of the project, counted');
  const [cov] = ltms('search', '--count', '--', 'x', dir);
  assert.equal(cov.files.found, w.files.length, "the same count as ltms search's own walk");
  assert.equal(cov.files.symlinks, w.links);
});

test('D-1: every session ltms index lists opens, at any depth (the mirror\'s too); its agents are the ones ltms counts (D-2)', async () => {
  const lines = ltms('index', '--max', '0', '--', dir).filter((l) => l.k === 'session');
  assert.deepEqual(lines.map((l) => rel(l.path)).sort(), [`${S1}.jsonl`, `${S3}.jsonl`, `raw/sessions/${S1}.jsonl`, `raw/sessions/${S2}.jsonl`, `raw/sessions/${S3}.jsonl`].sort());
  for (const l of lines) {
    const f = rel(l.path);
    const v = await engine.session(P, f);
    assert.equal(v.turns.length, l.turns, `${f}: the turns ltms index counts`);
    const a = engine.agents(P, f);
    if (l.agents !== null) assert.equal(a.agents.length, l.agents, `${f}: the agents ltms index counts`);
    assert.equal(a.known, l.agents !== null, `${f}: known exactly when ltms knows the count`);
  }
  const s1 = engine.agents(P, `${S1}.jsonl`).agents;
  assert.deepEqual(s1.map((x) => [x.file, x.group]).sort(), [[`${S1}/subagents/${AG}`, 'subagents'], [`${S1}/subagents/workflows/wf_1/${WA}`, 'subagents/workflows/wf_1']]);
  assert.deepEqual(engine.agents(P, `raw/sessions/${S2}.jsonl`).agents.map((x) => x.file), [`raw/sessions/${S2}/subagents/workflows/wf_2/${RA}`]);
});

test("an agent's session is the one whose own folder holds it, wherever that is", () => {
  assert.equal(parentOf(dir, `${S1}/subagents/workflows/wf_1/${WA}`), `${S1}.jsonl`);
  assert.equal(parentOf(dir, `raw/sessions/${S2}/subagents/workflows/wf_2/${RA}`), `raw/sessions/${S2}.jsonl`);
  assert.equal(parentOf(dir, `${S1}.jsonl`), null, 'a session at the top has none');
  assert.equal(engine.parent(P, `raw/sessions/${S1}/subagents/${AG}`), `raw/sessions/${S1}.jsonl`);
});

test('names: any depth of plain names; never through a link, never "..", never a folder', async () => {
  assert.ok(transcriptAt(dir, `raw/sessions/${S2}/subagents/workflows/wf_2/${RA}`).abs);
  for (const [f, kind] of [[`mirror-link/sessions/${S2}.jsonl`, 'no-session'], ['outside-link/99999999-9999-4999-8999-999999999999.jsonl', 'no-session'], [`raw/../${S1}.jsonl`, 'bad-name'], ['raw/sessions', 'bad-name'], [`raw/sessions/${S1}`, 'bad-name'], [`raw//sessions/${S2}.jsonl`, 'bad-name'], [`raw/sessions/${S2}.jsonl/x.jsonl`, 'no-session']])
    await assert.rejects(async () => engine.sessionFile(P, f), (e) => e instanceof Refusal && e.kind === kind, `${f}: ${kind}`);
});

test('copies: one row per content, the copy Claude Code keeps shown, the identical one named, the differing one apart', async () => {
  const ix = await engine.index(P, { fresh: true });
  const rows = new Map(ix.sessions.map((s) => [s.file, s]));
  assert.deepEqual([...rows.keys()].sort(), [`${S1}.jsonl`, `${S3}.jsonl`, `raw/sessions/${S2}.jsonl`, `raw/sessions/${S3}.jsonl`].sort());
  assert.deepEqual(rows.get(`${S1}.jsonl`).copies, [`raw/sessions/${S1}.jsonl`]);
  assert.deepEqual([rows.get(`${S3}.jsonl`).others, rows.get(`raw/sessions/${S3}.jsonl`).others], [[`raw/sessions/${S3}.jsonl`], [`${S3}.jsonl`]]);
  assert.deepEqual(rows.get(`raw/sessions/${S2}.jsonl`).copies, []);
  assert.equal(ix.copies.files, 1);
  assert.equal(ix.coverage.sessions, 5, "ltms's own coverage is kept as it printed it");
  // an address: one target, its copy named; the session only the mirror holds is found (D-1)
  assert.deepEqual(await engine.resolve(P, '11111111'), [{ project: P, file: `${S1}.jsonl`, copies: [`raw/sessions/${S1}.jsonl`], others: [] }]);
  assert.deepEqual((await engine.resolve(null, '22222222')).map((x) => x.file), [`raw/sessions/${S2}.jsonl`]);
  assert.deepEqual((await engine.resolve(P, 'agent-ac000000')).map((x) => x.file), [`raw/sessions/${S2}/subagents/workflows/wf_2/${RA}`]);
  assert.deepEqual((await engine.resolve(P, '33333333')).map((x) => x.file), [`${S3}.jsonl`, `raw/sessions/${S3}.jsonl`], 'two versions: both, the live one first');
  assert.deepEqual(await engine.copiesOf(P, `raw/sessions/${S1}.jsonl`), { shown: `${S1}.jsonl`, copies: [`${S1}.jsonl`], others: [] });
});

test("search: an identical copy's hits are shown once, under the copy Claude Code keeps; its count said", async () => {
  const s = await engine.searchFor({ project: P, q: 'npm test', max: 500 });
  const files = s.files.map((f) => f.file);
  assert.ok(files.includes(`${S1}.jsonl`) && !files.includes(`raw/sessions/${S1}.jsonl`), 'the copy folded');
  assert.deepEqual(s.files.find((f) => f.file === `${S1}.jsonl`).copies, [`raw/sessions/${S1}.jsonl`]);
  const all = s.coverage.hits.turns, shown = s.hits.length;
  assert.equal(all, shown + s.folded.turns, "ltms's count = the turns shown + the copies' turns");
  assert.ok(s.folded.files >= 1);
  // a page that holds the copy without the copy shown first keeps it, marked: the page of one turn that ltms's own order
  // gives to the mirror's copy of S1
  const order = ltms('search', '--max', '0', '--', 'npm test', dir);
  const fOf = new Map(order.filter((l) => l.k === 'file').map((l) => [l.f, rel(l.path)]));
  const at = order.filter((l) => l.k === 'hit').findIndex((l) => fOf.get(l.f) === `raw/sessions/${S1}.jsonl`);
  assert.ok(at > 0, "ltms prints a hit of the mirror's copy after the live one's");
  const one = await engine.searchFor({ project: P, q: 'npm test', max: 1, skip: at });
  assert.deepEqual(one.files.map((f) => [f.file, f.copyOf, f.copies]), [[`raw/sessions/${S1}.jsonl`, `${S1}.jsonl`, [`${S1}.jsonl`]]]);
  assert.deepEqual([one.hits.length, one.folded], [1, { files: 0, turns: 0 }]);
  assert.deepEqual(engine.scope(P), { files: walk(dir).files.length, bytes: walk(dir).files.reduce((n, f) => n + f.size, 0), cut: false });
});

test('a list read again only when something changed; a slow one kept and the change said; fresh reads again', async () => {
  const first = await engine.index(P, { fresh: true });
  assert.equal(await engine.index(P), first, 'nothing changed: the same answer, not a new run');
  appendFileSync(path.join(dir, `${S3}.jsonl`), '\n');
  const fast = await engine.index(P);
  assert.notEqual(fast, first, 'a fast list is read again');
  engine.indexCache.get(dir).value.ms = 60_000;   // as if it had taken a minute, like our own project
  appendFileSync(path.join(dir, `${S3}.jsonl`), '\n');
  const kept = await engine.index(P);
  assert.equal(kept.at, fast.at, 'kept');
  assert.deepEqual([kept.changed.count, kept.changed.changed], [1, [`${S3}.jsonl`]]);
  const again = await engine.index(P, { fresh: true });
  assert.ok(again.at >= fast.at && again.changed === null, 'read again');
  assert.deepEqual(changes(new Map([['a', '1:1'], ['b', '2:2']]), new Map([['b', '2:3'], ['c', '1:1']])).counts, { changed: 1, added: 1, removed: 1 });
  assert.equal(changes(new Map([['a', '1:1']]), new Map([['a', '1:1']])), null);
});

test('byPlace: the fewest folders first, then by path', () => {
  assert.deepEqual(['raw/sessions/a.jsonl', 'a.jsonl', 'b/a.jsonl'].sort(byPlace), ['a.jsonl', 'b/a.jsonl', 'raw/sessions/a.jsonl']);
  assert.deepEqual(agentsOf(dir, `${S3}.jsonl`), { agents: [], known: true, folder: null }, 'a session with no own folder has no agents');
});

// ---- the copies' edge: same name and size, other bytes past the first MiB; a time-only change; a file rewritten in place
test('copies are told apart by every byte, not by name and size, nor by their first MiB; a rewrite in place is seen', async () => {
  const T = '-home-me-twins', tdir = path.join(root, T), S5 = '55555555-5555-4555-8555-555555555555';
  mkdirSync(path.join(tdir, 'raw', 'sessions'), { recursive: true });
  mkdirSync(path.join(tdir, 'raw2'), { recursive: true });
  // a transcript over 2 MiB: demo.jsonl, then lines of filler text (records with no uuid, outside the tree)
  const filler = Array.from({ length: 40 }, (_, i) => JSON.stringify({ type: 'filler', i, text: 'a'.repeat(60_000) })).join('\n');
  const body = `${readFileSync(path.join(FX, 'demo.jsonl'), 'utf8').trimEnd()}\n${filler}\n`;
  const at = Buffer.byteLength(body) - 100_000;   // inside the last filler's text, past the first MiB
  assert.ok(at > (1 << 20) + 1000 && body[at] === 'a');
  const other = `${body.slice(0, at)}b${body.slice(at + 1)}`;
  assert.equal(Buffer.byteLength(other), Buffer.byteLength(body));
  writeFileSync(path.join(tdir, `${S5}.jsonl`), body);
  writeFileSync(path.join(tdir, 'raw2', `${S5}.jsonl`), body);                       // identical
  writeFileSync(path.join(tdir, 'raw', 'sessions', `${S5}.jsonl`), other);           // same size, one byte other, at ~2 MiB
  const g = await engine.groupsOf(T, [`${S5}.jsonl`, `raw/sessions/${S5}.jsonl`, `raw2/${S5}.jsonl`]);
  assert.deepEqual(g.get(`${S5}.jsonl`), { rep: `${S5}.jsonl`, copies: [`raw2/${S5}.jsonl`], others: [`raw/sessions/${S5}.jsonl`] });
  assert.deepEqual(g.get(`raw/sessions/${S5}.jsonl`), { rep: `raw/sessions/${S5}.jsonl`, copies: [], others: [`${S5}.jsonl`] });
  // rewritten in place, same size, the same bytes as the others now: the digest kept for its old time is not used
  writeFileSync(path.join(tdir, 'raw', 'sessions', `${S5}.jsonl`), body);
  utimesSync(path.join(tdir, 'raw', 'sessions', `${S5}.jsonl`), new Date('2026-04-01'), new Date('2026-04-01'));
  const g2 = await engine.groupsOf(T, [`${S5}.jsonl`, `raw/sessions/${S5}.jsonl`, `raw2/${S5}.jsonl`]);
  assert.deepEqual(g2.get(`raw/sessions/${S5}.jsonl`), { rep: `${S5}.jsonl`, copies: [`raw2/${S5}.jsonl`, `raw/sessions/${S5}.jsonl`], others: [] }, 'the copies by place: the fewest folders first');
  // a change of time alone is a change: a slow list kept says it
  await engine.index(T, { fresh: true });
  engine.indexCache.get(tdir).value.ms = 60_000;
  utimesSync(path.join(tdir, 'raw2', `${S5}.jsonl`), new Date('2026-05-01'), new Date('2026-05-01'));
  const kept = await engine.index(T);
  assert.deepEqual([kept.changed?.count, kept.changed?.changed], [1, [`raw2/${S5}.jsonl`]]);
});

test("A.F16: each project's working directory, from its newest transcript's first whole records; ~ for home; null when none says", async () => {
  const H = '-home-me-paths', hdir = path.join(root, H);
  mkdirSync(hdir, { recursive: true });
  const { homedir } = await import('node:os');
  // the newest file says a directory under home; an older one says another (not read)
  writeFileSync(path.join(hdir, 'old.jsonl'), `${JSON.stringify({ type: 'user', cwd: '/elsewhere' })}\n`);
  writeFileSync(path.join(hdir, 'new.jsonl'), `${JSON.stringify({ type: 'summary' })}\n${JSON.stringify({ type: 'user', cwd: path.join(homedir(), 'work', 'app') })}\n`);
  utimesSync(path.join(hdir, 'old.jsonl'), new Date('2025-01-01'), new Date('2025-01-01'));
  const list = engine.projects().projects;
  const paths = await engine.projectPaths(list);
  assert.equal(paths[H], `~${path.sep}work${path.sep}app`);
  assert.equal(paths[P], '/work/demo-project', "the long project's newest transcript (demo.jsonl's records)");
  // a first line longer than what is read: no whole line, so no path (never a guess from a cut line)
  writeFileSync(path.join(hdir, 'new.jsonl'), `${JSON.stringify({ type: 'user', text: 'x'.repeat(70_000), cwd: '/cut' })}\n`);
  assert.equal((await engine.projectPaths(engine.projects().projects))[H], null);
  // a project whose transcripts never say one
  writeFileSync(path.join(hdir, 'new.jsonl'), `${JSON.stringify({ type: 'user' })}\n`);
  assert.equal((await engine.projectPaths(engine.projects().projects))[H], null);
  rmSync(hdir, { recursive: true, force: true });
});
