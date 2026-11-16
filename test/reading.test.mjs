// test/reading.test.mjs — a transcript read in the reader's own process (src/reading.mjs): the session view of what ltms
// skeleton prints; a link at the last step, a folder, a FIFO and a file too large for this process's memory refused
// before anything is parsed, the last with its size and the NODE_OPTIONS that would let it be read.
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MB, Refusal, STRING_MAX, readTranscript, sizeLimit, tooLarge } from '../src/reading.mjs';
import { FX, OWN, ltms } from './helpers.mjs';

test('a transcript read here: its turns are the ones ltms skeleton prints', () => {
  const file = path.join(FX, 'demo.jsonl');
  const d = readTranscript(file);
  assert.equal(d.name, 'demo.jsonl');
  assert.equal(d.prefix, 'demo.jso');
  assert.equal(d.size, 25299, 'the size ltms records gives the file');
  assert.deepEqual(d.view.turns.map((t) => t.ta), ltms(['skeleton', '--', file]).filter((l) => l.k === 'turn').map((l) => l.ta));
});

test('too large: refused with its size and the NODE_OPTIONS that would let it be read; past the string limit, no setting does', () => {
  const heap = 4096 * MB;
  assert.equal(sizeLimit(heap), Math.floor(heap / 10));
  assert.equal(tooLarge(400 * MB, heap), null);
  const why = tooLarge(300 * MB - 1, 2048 * MB);
  assert.match(why, /^it is 300 MB, and this process reads a transcript of up to 205 MB \(a tenth of its memory limit, as ltms reads; parsing takes 5 to 8 times a file's size\)\. To read it, give Node more memory: NODE_OPTIONS=--max-old-space-size=3072 npx ltms-reader$/);
  // the setting named is enough by the same rule: a tenth of it holds the file
  const need = Number(/--max-old-space-size=(\d+)/.exec(why)[1]) * MB;
  assert.equal(tooLarge(300 * MB - 1, need), null);
  assert.match(tooLarge(STRING_MAX + 1, 64 * 1024 * MB), /no memory setting lets it be read/);
});

test('the file itself: a link, a folder, a FIFO, a missing file and a file too large are refused, each by its kind', () => {
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-reading-'));
  try {
    const big = path.join(own, 'big.jsonl');
    writeFileSync(big, `${'x'.repeat(2048)}\n`);
    symlinkSync(path.join(FX, 'demo.jsonl'), path.join(own, 'link.jsonl'));
    execFileSync('mkfifo', [path.join(own, 'fifo.jsonl')]);
    const kind = (f, o) => { try { readTranscript(f, o); return 'read'; } catch (e) { assert.ok(e instanceof Refusal, e.stack); return `${e.kind}: ${e.message}`; } };
    assert.match(kind(path.join(own, 'link.jsonl')), /^not-file: .* is a symbolic link; a transcript is read only as a regular file$/);
    assert.match(kind(own), /^not-file: .* is not a regular file$/);
    assert.match(kind(path.join(own, 'fifo.jsonl')), /^not-file: .* is not a regular file$/);
    assert.match(kind(path.join(own, 'gone.jsonl')), /^missing: no file at /);
    assert.match(kind(big, { heapLimit: 10_000 }), /^too-large: .*big\.jsonl is not read: it is 1 MB, and this process reads a transcript of up to 1 MB .*NODE_OPTIONS=--max-old-space-size=256 npx ltms-reader$/);
    assert.equal(kind(big), 'read');
  } finally { rmSync(own, { recursive: true, force: true }); }
});

// R.F14: the command a refusal gives to read a transcript too large is the one that was run, with what it was given:
// without the path, it opens the default projects folder instead.
test('R.F14: the command to run again is the one that was run, with the argument given, quoted for a shell where it needs to be', async () => {
  const { againOf } = await import('../src/start.mjs');
  assert.equal(typeof againOf, 'function', 'src/start.mjs makes the command to run again');
  assert.equal(againOf(null), 'npx ltms-reader');
  assert.equal(againOf('big.jsonl'), 'npx ltms-reader big.jsonl');
  assert.equal(againOf('/srv/a b/x.jsonl'), "npx ltms-reader '/srv/a b/x.jsonl'");
  assert.equal(againOf("it's.jsonl"), "npx ltms-reader 'it'\\''s.jsonl'");
  assert.equal(againOf('-x.jsonl'), 'npx ltms-reader -- -x.jsonl');
  assert.equal(againOf('~/x.jsonl'), "npx ltms-reader '~/x.jsonl'", 'a tilde as typed after the shell expanded it is a name, not home');
});

test('R.F14: too large: the NODE_OPTIONS given with the command that was run, the path included', () => {
  const why = tooLarge(300 * MB - 1, 2048 * MB, "npx ltms-reader 'my big.jsonl'");
  assert.match(why, /To read it, give Node more memory: NODE_OPTIONS=--max-old-space-size=3072 npx ltms-reader 'my big\.jsonl'$/);
});

/** A transcript of `bytes` bytes or a little more: one typed prompt of ASCII letters. */
function bigTranscript(file, bytes) {
  const rec = (text) => JSON.stringify({ parentUuid: null, isSidechain: false, userType: 'external', cwd: '/work/big', sessionId: '99999999-9999-4999-8999-999999999999', version: '2.0.0', type: 'user', message: { role: 'user', content: text }, uuid: '99999999-0000-4000-8000-000000000001', timestamp: '2026-11-15T09:00:00.000Z', promptSource: 'typed' });
  const fd = openSync(file, 'w');
  try { writeSync(fd, `${rec(`a big prompt ${'x'.repeat(bytes)}`)}\n`); } finally { closeSync(fd); }
}

test('R.F14: the reader refused a transcript too large, on its screen, with the command to read it: the path given in it, both ways in', { timeout: 120_000 }, () => {
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-again-'));
  try {
    // node --max-old-space-size=16: a heap limit of 112 MB here, so a transcript over 11.2 MB is refused
    mkdirSync(path.join(own, 'projects', '-work-big'), { recursive: true });
    bigTranscript(path.join(own, 'big.jsonl'), 12 * MB);
    bigTranscript(path.join(own, 'projects', '-work-big', '99999999-9999-4999-8999-999999999999.jsonl'), 12 * MB);
    const run = (args, keys = []) => {
      const r = spawnSync(process.execPath, ['--max-old-space-size=16', path.join(OWN, 'frame-once.mjs'), ...args], { cwd: own, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: own, CLAUDE_CONFIG_DIR: own, TZ: 'UTC', LTMS_COLS: '400', LTMS_ROWS: '12', LTMS_KEYS: JSON.stringify(keys) }, timeout: 100_000 });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout.trim().split('\n').pop()).map((l) => l.trimEnd());
    };
    const file = run(['big.jsonl']);
    assert.equal(file[1], 'this transcript could not be read', JSON.stringify(file));
    assert.match(file[2], /is not read: it is 13 MB, .* NODE_OPTIONS=--max-old-space-size=\d+ npx ltms-reader big\.jsonl$/);
    const root = run(['projects'], ['\r', '\r']);
    assert.equal(root[1], 'this transcript could not be read', JSON.stringify(root));
    assert.match(root[2], /is not read: it is 13 MB, .* NODE_OPTIONS=--max-old-space-size=\d+ npx ltms-reader projects$/);
  } finally { rmSync(own, { recursive: true, force: true }); }
});
