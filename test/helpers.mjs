// test/helpers.mjs — what the screen's tests share (not a test file: node --test runs only *.test.mjs here).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
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
