// test/helpers.mjs — what the screen's tests share (not a test file: node --test runs only *.test.mjs here).
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, '..');
export const FX = path.join(HERE, 'fixtures', 'ltms');
export const OWN = path.join(HERE, 'fixtures');
export const BIN = path.join(ROOT, 'bin', 'ltms-reader.mjs');
/** ltms's CLI, by the package's name: a route to it that does not pass through the code under test. */
export const CLI = createRequire(import.meta.url).resolve('long-term-memory-structure/dist/cli.js');

/** ltms's JSON lines for these arguments (its exit status is not checked: a file with warnings exits 1). */
export function ltms(args) {
  let out;
  try { out = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = String(e.stdout ?? ''); }
  return out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export const DEMO = '11111111-1111-4111-8111-111111111111.jsonl';
export const COMP = '22222222-2222-4222-8222-222222222222.jsonl';
export const UNI = '33333333-3333-4333-8333-333333333333.jsonl';
export const HEB = '44444444-4444-4444-8444-444444444444.jsonl';

/** A folder of project folders, made of the fixtures, in a folder of the test's own (never the user's projects):
 *  -work-demo (demo, compacted, and demo's agent in its own folder), -work-other (unicode, and the Hebrew-English
 *  transcript). Returns { root, dispose }. */
export function makeRoot(prefix = 'ltms-reader-screen-') {
  const base = mkdtempSync(path.join(tmpdir(), prefix));
  const root = path.join(base, 'projects');
  const demo = path.join(root, '-work-demo'), other = path.join(root, '-work-other');
  mkdirSync(path.join(demo, DEMO.slice(0, -6), 'subagents'), { recursive: true });
  mkdirSync(other, { recursive: true });
  cpSync(path.join(FX, 'demo.jsonl'), path.join(demo, DEMO));
  cpSync(path.join(FX, 'compacted.jsonl'), path.join(demo, COMP));
  cpSync(path.join(FX, 'agent-a0123456789abcdef.jsonl'), path.join(demo, DEMO.slice(0, -6), 'subagents', 'agent-a0123456789abcdef.jsonl'));
  cpSync(path.join(FX, 'unicode.jsonl'), path.join(other, UNI));
  cpSync(path.join(OWN, 'hebrew-english.jsonl'), path.join(other, HEB));
  // the projects are listed newest file first: -work-demo, then -work-other, whatever the copies' own times
  for (const [dir, day] of [[demo, 10], [other, 9]]) for (const f of [DEMO, COMP, UNI, HEB]) { try { utimesSync(path.join(dir, f), new Date(Date.UTC(2026, 10, day)), new Date(Date.UTC(2026, 10, day))); } catch {} }
  return { base, root, dispose: () => rmSync(base, { recursive: true, force: true }) };
}

/** The bytes a terminal sends for each key. */
export const KEY = Object.freeze({
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', pageup: '\x1b[5~', pagedown: '\x1b[6~', home: '\x1b[H', end: '\x1b[F',
  enter: '\r', escape: '\x1b', backspace: '\x7f', ctrlc: '\x03', ctrlu: '\x15',
});

/** Keys into an App the way the screen gives them: bytes decoded by readline's emitKeypressEvents. */
export function keyboard(app) {
  const input = new PassThrough();
  readline.emitKeypressEvents(input, { escapeCodeTimeout: 20 });
  input.on('keypress', (str, k) => app.key(str, k ?? {}));
  return {
    /** Send bytes, let them be decoded (a lone ESC waits for the timeout), then wait until nothing is being read. */
    async press(bytes) {
      input.write(bytes);
      await new Promise((r) => setImmediate(r));
      if (bytes.endsWith('\x1b')) await new Promise((r) => setTimeout(r, 60));
      await app.idle();
    },
  };
}

export const plainOf = (lines) => lines.map((l) => l.map((s) => s.text).join(''));

/** Streams standing for a terminal, and a process standing for this one, for src/main.mjs's main(): everything written,
 *  in the order written. */
export function terminal({ cols = 80, rows = 24 } = {}) {
  const log = [];
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.raw = [];
  stdin.setRawMode = (on) => { stdin.raw.push(on); return stdin; };
  const sink = (name) => Object.assign(new Writable({ write(chunk, enc, cb) { log.push([name, String(chunk)]); cb(); } }), { isTTY: true, columns: cols, rows });
  const stdout = sink('out'), stderr = sink('err');
  const proc = Object.assign(new EventEmitter(), { pid: 4242, exits: [], exit(code) { this.exits.push(code); }, kills: [], kill(pid, signal) { this.kills.push([pid, signal]); } });
  return { stdin, stdout, stderr, proc, log, out: () => log.filter(([n]) => n === 'out').map(([, s]) => s).join(''), err: () => log.filter(([n]) => n === 'err').map(([, s]) => s).join('') };
}

/** A transcript like the checker's (make_deep.py): a prompt, a call, its result, a reply; the result's toolUseResult a
 *  list nested `depth` deep holding `leaves` ones. */
export function deepRecord(file, depth, leaves) {
  const base = { isSidechain: false, userType: 'external', cwd: '/work/d', sessionId: 'dddddddd-0000-4000-8000-000000000000', version: '2.0.0', gitBranch: 'main', entrypoint: 'cli' };
  const u = (n) => `dd000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const usage = { input_tokens: 1, output_tokens: 1 };
  let v = new Array(leaves).fill(1);
  for (let i = 0; i < depth; i++) v = [v];
  const recs = [
    { ...base, parentUuid: null, type: 'user', message: { role: 'user', content: 'DEEP-T1 read the nested file' }, uuid: u(1), timestamp: '2026-03-01T10:00:00.000Z', promptSource: 'typed' },
    { ...base, parentUuid: u(1), type: 'assistant', message: { id: 'msg_d1', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'toolu_d1', name: 'Bash', input: { command: 'cat nested.json' } }], stop_reason: 'tool_use', usage }, requestId: 'req_d1', uuid: u(2), timestamp: '2026-03-01T10:00:01.000Z' },
    { ...base, parentUuid: u(2), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_d1', content: 'nested', is_error: false }] }, uuid: u(3), timestamp: '2026-03-01T10:00:02.000Z', toolUseResult: { data: v } },
    { ...base, parentUuid: u(3), type: 'assistant', message: { id: 'msg_d2', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage }, requestId: 'req_d2', uuid: u(4), timestamp: '2026-03-01T10:00:03.000Z' },
  ];
  writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
