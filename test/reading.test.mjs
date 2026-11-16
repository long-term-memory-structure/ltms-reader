// test/reading.test.mjs — a transcript read in the reader's own process (src/reading.mjs): the session view of what ltms
// skeleton prints; a link at the last step, a folder, a FIFO and a file too large for this process's memory refused
// before anything is parsed, the last with its size and the NODE_OPTIONS that would let it be read.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MB, Refusal, STRING_MAX, readTranscript, sizeLimit, tooLarge } from '../src/reading.mjs';
import { FX, ltms } from './helpers.mjs';

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
