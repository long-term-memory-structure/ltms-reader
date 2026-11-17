// test/reading.test.mjs — a transcript read in the reader's own process (src/reading.mjs): the session view of what ltms
// skeleton prints; a link at the last step, a folder, a FIFO and a file too large for this process's memory refused
// before anything is parsed, the last with its size and the NODE_OPTIONS that would let it be read.
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getHeapStatistics } from 'node:v8';
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
    // node --max-old-space-size=16: an old space of 16 MB, so a transcript over 1.6 MB is refused, on every Node line (Z1,
    // round 7: by a tenth of the heap's limit, 112 MB on Node 26, refused over 11.2 MB; 208 MB on Node 24, where this
    // transcript was read, and its parse ran the old space out)
    mkdirSync(path.join(own, 'projects', '-work-big'), { recursive: true });
    bigTranscript(path.join(own, 'big.jsonl'), 12 * MB);
    bigTranscript(path.join(own, 'projects', '-work-big', '99999999-9999-4999-8999-999999999999.jsonl'), 12 * MB);
    const run = (args, keys = []) => {
      const r = spawnSync(process.execPath, ['--max-old-space-size=16', path.join(OWN, 'frame-once.mjs'), ...args], { cwd: own, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: own, CLAUDE_CONFIG_DIR: own, TZ: 'UTC', LTMS_COLS: '400', LTMS_ROWS: '12', LTMS_KEYS: JSON.stringify(keys) }, timeout: 100_000 });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout.trim().split('\n').pop()).map((l) => l.trimEnd());
    };
    // the refusal, on the lines under the view's second, to the first blank one, joined as the screen wrapped it (by
    // words: R5, a long TMPDIR put the path's last word on a line of its own)
    const refusal = (lines) => { const out = []; for (const l of lines.slice(2)) { if (l.trim() === '') break; out.push(l.trim()); } return out.join(' '); };
    const file = run(['big.jsonl']);
    assert.equal(file[1], 'this transcript could not be read', JSON.stringify(file));
    assert.match(refusal(file), /is not read: it is 13 MB, .* NODE_OPTIONS=--max-old-space-size=\d+ npx ltms-reader big\.jsonl$/);
    const root = run(['projects'], ['\r', '\r']);
    assert.equal(root[1], 'this transcript could not be read', JSON.stringify(root));
    assert.match(refusal(root), /is not read: it is 13 MB, .* NODE_OPTIONS=--max-old-space-size=\d+ npx ltms-reader projects$/);
  } finally { rmSync(own, { recursive: true, force: true }); }
});

// Z1 (round 7): R.F14 failed on Node 24 (Box B's 24.18.0, and 24.22.3 in docker: 3 of 3 each), the reader under test
// dying of V8's heap run out in the parse (TextEncoder's encoding of the transcript's line, ltms's byte count) instead of
// refusing. The size rules read a tenth of Node's heap limit; a heap limit is the old space and the young generation's
// reserve, and the reserve is sized from the machine's memory, not from the old space set: measured with
// --max-old-space-size=16, the heap limit is 64 MB on Node 20.20.2 and 22.23.3, 208 MB on 24.22.3 and 112 MB on 26.13.1.
// A transcript's text and what its parse makes of it live in the old space, so that under an old space of 16 MB a
// transcript of 8 to 20 MB was read on Node 24 and ran it out, and one of 10 or 11 MB on Node 26 (round 7's probe,
// admit.mjs). Now the rules read the old space's limit where Node's flags set it.
const MiB = 1024 * 1024;
test('Z1: the memory limit the size rules read: the heap limit, or the old space where Node\'s flags set it (--max-old-space-size, the command line\'s over NODE_OPTIONS\'; --max-old-space-size-percentage, of the memory Node reads, over both), as measured on Node 22.23.3 and 24.22.3', async () => {
  const { memoryLimit, recordTooLarge, tooLarge } = await import('../src/reading.mjs');
  assert.equal(typeof memoryLimit, 'function', 'src/reading.mjs gives the memory limit its rules read');
  const at = (o) => memoryLimit({ heap: 208 * MiB, execArgv: [], nodeOptions: '', memory: 3072 * MiB, ...o });
  assert.equal(at({}), 208 * MiB, 'no flag: the heap limit');
  // R8b (round 8): none is an empty NODE_OPTIONS. Given as undefined, it was this process's (memoryLimit's default), so
  // that under NODE_OPTIONS=--max-old-space-size=128 'no flag' read 128 MB and this test failed (round 7's check)
  const ownOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--max-old-space-size=16';
  try {
    assert.equal(at({}), 208 * MiB, "this process's NODE_OPTIONS is not read where the test gives none");
    assert.equal(memoryLimit({ heap: 208 * MiB, execArgv: [], memory: 3072 * MiB }), 16 * MiB, 'and it is read where none is given');
  } finally {
    if (ownOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = ownOptions;
  }
  assert.equal(at({ execArgv: ['--max-old-space-size=16'] }), 16 * MiB, 'node --max-old-space-size=16: 16 MB, not the heap limit of 208');
  assert.equal(at({ nodeOptions: '--max-old-space-size=16' }), 16 * MiB);
  assert.equal(at({ nodeOptions: '--max_old_space_size=16' }), 16 * MiB, 'V8 reads the flag with underscores too');
  assert.equal(at({ execArgv: ['--max_old_space_size=16'] }), 16 * MiB);
  assert.equal(at({ nodeOptions: '--max-old-space-size=64', execArgv: ['--max-old-space-size=16'] }), 16 * MiB, 'the command line over NODE_OPTIONS (measured: a heap of 208 MB)');
  assert.equal(at({ heap: 256 * MiB, nodeOptions: '--max-old-space-size=16', execArgv: ['--max-old-space-size=64'] }), 64 * MiB, 'and the other way (measured: 256 MB)');
  assert.equal(at({ execArgv: ['--max-old-space-size=32', '--max-old-space-size=16'] }), 16 * MiB, 'the last given');
  assert.equal(at({ execArgv: ['--max-old-space-size=0'] }), 208 * MiB, '0 sets none (measured: the default heap)');
  assert.equal(at({ nodeOptions: '--require "/a b/c.js" --max-old-space-size=32' }), 32 * MiB, 'NODE_OPTIONS read as Node reads it, a quoted word holding a space');
  assert.equal(at({ nodeOptions: '--require "/a --max-old-space-size=1/c.js"' }), 208 * MiB, 'a flag inside a quoted word is not one');
  // the percentage: of the memory Node reads (a constraint's, 3,072 MB in docker --memory 3g, measured: 307 MB at 10 %)
  assert.equal(at({ heap: 499 * MiB, execArgv: ['--max-old-space-size-percentage=10'] }), 307 * MiB);
  assert.equal(at({ heap: 499 * MiB, nodeOptions: '--max-old-space-size-percentage=10', execArgv: ['--max-old-space-size=16'] }), 307 * MiB, 'over --max-old-space-size, wherever each is given (measured: a heap of 499 MB)');
  assert.equal(at({ heap: 499 * MiB, execArgv: ['--max-old-space-size=16', '--max-old-space-size-percentage=10'] }), 307 * MiB);
  assert.equal(at({ heap: 499 * MiB, execArgv: ['--max-old-space-size-percentage=12.5'], memory: 1000 * MiB }), 125 * MiB);
  // the rules read it when they are given no limit; this process's own is its heap limit or less
  assert.ok(memoryLimit() <= getHeapStatistics().heap_size_limit);
  assert.equal(tooLarge(300 * MiB), tooLarge(300 * MiB, memoryLimit()));
  assert.equal(recordTooLarge(30 * MiB, 40 * MiB), recordTooLarge(30 * MiB, 40 * MiB, memoryLimit()));
  assert.equal(tooLarge(2 * MiB, 208 * MiB), null);
  assert.match(tooLarge(2 * MiB, at({ execArgv: ['--max-old-space-size=16'] })), /^it is 2 MB, and this process reads a transcript of up to 2 MB .* NODE_OPTIONS=--max-old-space-size=256 npx ltms-reader$/);
});

// R8c (round 8): Node reads NODE_OPTIONS as its ParseNodeOptionsEnvVar does, a double-quoted stretch part of a word, and
// applies a --max-old-space-size quoted, whole or in part (measured, round 8's probe quoteflags.sh, on Node 20.20.2,
// 22.23.3, 24.22.3 and 26.13.1: quoted whole, its value quoted, a part of its name quoted, quoted with underscores, each
// gave the heap limit the flag unquoted gives, 64, 64, 208 and 112 MB at 16; of two quoted, the last given; a quoted 16
// then a plain 64, the 64's). memoryLimit reads the words so (nodeOptionWords), but no test pinned it: read as a word
// with its quotes kept, the flag was not one, the heap limit was read instead (208 MB on Node 24), and there R.F14's
// transcript was read and ran the old space out (round 7's check: its mutant z1-words-no-quote passed the whole suite).
test('R8c: a --max-old-space-size quoted in NODE_OPTIONS, which Node applies, is read as Node reads it: quoted whole, its value quoted, a part of its name quoted', async () => {
  const { memoryLimit } = await import('../src/reading.mjs');
  const at = (o) => memoryLimit({ heap: 208 * MiB, execArgv: [], nodeOptions: '', memory: 3072 * MiB, ...o });
  assert.equal(at({ nodeOptions: '"--max-old-space-size=16"' }), 16 * MiB, 'quoted whole');
  assert.equal(at({ nodeOptions: '--max-old-space-size="16"' }), 16 * MiB, 'its value quoted');
  assert.equal(at({ nodeOptions: '--max-old-"space"-size=16' }), 16 * MiB, 'a part of its name quoted');
  assert.equal(at({ nodeOptions: '"--max_old_space_size=16"' }), 16 * MiB, 'quoted, with underscores');
  assert.equal(at({ nodeOptions: '"--max-old-space-size=16" --no-warnings' }), 16 * MiB, 'quoted, another flag after it');
  assert.equal(at({ nodeOptions: '"--max-old-space-size=64" "--max-old-space-size=16"' }), 16 * MiB, 'of two quoted, the last given');
  assert.equal(at({ heap: 256 * MiB, nodeOptions: '"--max-old-space-size=16" --max-old-space-size=64' }), 64 * MiB, 'a quoted 16, then a plain 64: the 64 (measured: the heap limit of 64)');
});

test('R8c: under NODE_OPTIONS="--max-old-space-size=16" quoted whole, a transcript of 4 MB is refused, in a process of its own, on every Node line (read as no flag, it was read by a tenth of the heap limit: 6.4 MB on Node 20 and 22, 20.8 on 24, 11.2 on 26)', { timeout: 120_000 }, () => {
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-quoted-'));
  try {
    bigTranscript(path.join(own, 'big4.jsonl'), 4 * MB);
    const r = spawnSync(process.execPath, [path.join(OWN, 'frame-once.mjs'), 'big4.jsonl'], { cwd: own, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: own, CLAUDE_CONFIG_DIR: own, TZ: 'UTC', LTMS_COLS: '400', LTMS_ROWS: '12', LTMS_KEYS: '[]', NODE_OPTIONS: '"--max-old-space-size=16"' }, timeout: 100_000 });
    assert.equal(r.status, 0, `status ${r.status}, signal ${r.signal}: ${r.stderr.slice(-600)}`);
    const lines = JSON.parse(r.stdout.trim().split('\n').pop()).map((l) => l.trimEnd());
    assert.equal(lines[1], 'this transcript could not be read', JSON.stringify(lines.slice(0, 4)));
    assert.match(lines.slice(2).join(' '), /is not read: it is 5 MB, and this process reads a transcript of up to /);
  } finally { rmSync(own, { recursive: true, force: true }); }
});

test('Z1: under an old space of 16 MB, transcripts of 10 and 4 MB are refused, on every Node line: by a tenth of the heap\'s limit Node 24 and 26 read both, and the first ran their old space out, and Node 20 and 22 read the second', { timeout: 120_000 }, () => {
  const own = mkdtempSync(path.join(tmpdir(), 'ltms-reader-old-'));
  try {
    for (const mb of [10, 4]) {
      bigTranscript(path.join(own, `big${mb}.jsonl`), mb * MB);
      const r = spawnSync(process.execPath, ['--max-old-space-size=16', path.join(OWN, 'frame-once.mjs'), `big${mb}.jsonl`], { cwd: own, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: own, CLAUDE_CONFIG_DIR: own, TZ: 'UTC', LTMS_COLS: '400', LTMS_ROWS: '12', LTMS_KEYS: '[]' }, timeout: 100_000 });
      assert.equal(r.status, 0, `${mb} MB: status ${r.status}, signal ${r.signal}: ${r.stderr.slice(-600)}`);
      const lines = JSON.parse(r.stdout.trim().split('\n').pop()).map((l) => l.trimEnd());
      assert.equal(lines[1], 'this transcript could not be read', `${mb} MB: ${JSON.stringify(lines.slice(0, 4))}`);
      assert.match(lines.slice(2).join(' '), new RegExp(`is not read: it is ${mb + 1} MB, and this process reads a transcript of up to 2 MB `), `${mb} MB`);
    }
  } finally { rmSync(own, { recursive: true, force: true }); }
});
