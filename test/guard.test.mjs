// test/guard.test.mjs — the command's guard (src/guard.mjs, R.F1): the screen runs in a child process; when that
// process ends by a signal (V8's heap run out aborts it, SIGKILL ends it), the command writes the leave sequence, then
// what the process wrote to stderr, then what happened, and ends with 128 + the signal's number; when it ends by
// itself, its stderr and its exit code pass through and nothing else is written; a signal sent to the command reaches
// it. The screen's process is a stand-in here (test/fixtures/guard/); test/pty.test.mjs runs the reader itself.
import { EventEmitter } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { endedBy, guard } from '../src/guard.mjs';
import { OWN } from './helpers.mjs';

// written out here, not taken from the code under test
const LEAVE = '\x1b[?2004l\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l';
async function run(fixture, argv, { proc = new EventEmitter(), onChild = null, stopWait = undefined } = {}) {
  const out = [], err = [];
  // Node through a script that keeps no core of a process a signal ends (the planted aborts)
  const code = await guard(argv, { execPath: path.join(OWN, 'guard', 'no-core.sh'), env: { ...process.env, LTMS_NODE: process.execPath }, entry: path.join(OWN, 'guard', fixture), execArgv: [], proc, onChild, out: (s) => out.push(s), err: (s) => err.push(s), stopWait });
  return { code, out: out.join(''), err: err.join(''), proc };
}

for (const [signal, code] of [['SIGKILL', 137], ['SIGABRT', 134], ['SIGSEGV', 139]]) {
  test(`a screen's process ended by ${signal}: the leave sequence, then its stderr, then what happened; exit ${code}`, async () => {
    const r = await run('killed.mjs', [signal]);
    assert.equal(r.code, code);
    assert.equal(r.out, LEAVE, 'the leave sequence, once, and nothing else on stdout');
    assert.equal(r.err, `FATAL ERROR: planted - JavaScript heap out of memory\nltms-reader: the screen's process ended by ${signal}, without restoring the terminal; this command restored it. Node's heap ran out, as it says above: to give it more memory, NODE_OPTIONS=--max-old-space-size=${/--max-old-space-size=(\d+)/.exec(r.err)?.[1]} npx ltms-reader ${signal}\n`);
    assert.ok(Number(/--max-old-space-size=(\d+)/.exec(r.err)[1]) % 256 === 0);
  });
}

test("a screen's process that ends by itself: its stderr and its exit code, and nothing else", async () => {
  for (const code of [0, 1, 2, 129, 130, 143]) {
    const r = await run('exits.mjs', [String(code)]);
    assert.equal(r.code, code);
    assert.equal(r.out, '', `${code}: nothing on stdout from the command`);
    assert.equal(r.err, `ended by itself, ${code}\n`);
  }
});

test("a signal sent to the command reaches the screen's process, which ends by its own way out", async () => {
  for (const [signal, code] of [['SIGTERM', 143], ['SIGHUP', 129], ['SIGINT', 130]]) {
    const proc = new EventEmitter();
    const r = await run('waits.mjs', [], { proc, onChild: (c) => c.stderr.on('data', (d) => { if (String(d).includes('waiting')) proc.emit(signal); }) });
    assert.equal(r.code, code, signal);
    assert.equal(r.out, '', `${signal}: no leave sequence from the command (the screen restored the terminal itself)`);
    assert.equal(r.err, `waiting\ngot ${signal}\n`);
    assert.equal(proc.listenerCount(signal), 0, `${signal}: the command's listener is gone once the screen's process ended`);
  }
});

test('what the command says of a signal: the heap only when the screen\'s process said so; the command to run again with what it was given', () => {
  assert.equal(endedBy('SIGKILL', 'killed\n', ['x.jsonl'], 512 * 1024 * 1024), "ltms-reader: the screen's process ended by SIGKILL, without restoring the terminal; this command restored it.\n");
  assert.equal(endedBy('SIGABRT', 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n', ['my big.jsonl'], 2144 * 1024 * 1024), "ltms-reader: the screen's process ended by SIGABRT, without restoring the terminal; this command restored it. Node's heap ran out, as it says above: to give it more memory, NODE_OPTIONS=--max-old-space-size=4352 npx ltms-reader 'my big.jsonl'\n");
  assert.match(endedBy('SIGABRT', 'JavaScript heap out of memory', [], 100 * 1024 * 1024), /NODE_OPTIONS=--max-old-space-size=256 npx ltms-reader\n$/);
});

// ---- N1 (S377): an error in the command's own process ------------------------------------------------------------------
// R's P1 planted errors (a timer that throws, a rejection, a thrown string) through node --import, which the command
// passes to the screen's process too: the command's own process printed Node's report, the planted message with it, on
// the alternate screen while the frame was up, and the screen's report went to a pipe no one read. Now the command stops
// the screen by its own way out, waits for it, and writes its own report after the restore, by its kind, not its message.
const PLANTED = 'PLANTED-SECRET';
const OWN_REPORT = (kind) => `ltms-reader: an internal error (${kind}) in the command's process ended it; the terminal was restored.\n`;
for (const [what, event, value, kind] of [
  ['an Error thrown', 'uncaughtException', new TypeError(`${PLANTED} error`), 'TypeError'],
  ['a promise rejected with nothing to catch it', 'unhandledRejection', new RangeError(`${PLANTED} reject`), 'RangeError'],
  ['a string thrown', 'uncaughtException', `${PLANTED} string`, 'string'],
]) {
  test(`N1: ${what} in the command's own process: the screen's process ended by its own way out (SIGTERM), its stderr, then the command's report, without the message; exit 1`, async () => {
    const proc = new EventEmitter();
    const r = await run('waits.mjs', [], { proc, onChild: (c) => c.stderr.on('data', (d) => { if (String(d).includes('waiting')) proc.emit(event, value, Promise.resolve()); }) });
    assert.ok(r.err.startsWith(`waiting\ngot SIGTERM\n${OWN_REPORT(kind)}`), `the screen's process stopped by SIGTERM, then the command's report: ${JSON.stringify(r.err)}`);
    assert.ok(r.err.endsWith('Its message is not printed: it could quote a transcript.\n'), JSON.stringify(r.err));
    assert.ok(!r.err.includes(PLANTED) && !r.out.includes(PLANTED), 'the message is nowhere');
    assert.equal(r.out, '', 'no leave sequence from the command: the screen restored the terminal itself');
    assert.equal(r.code, 1, 'exit 1');
    for (const e of ['uncaughtException', 'unhandledRejection', 'SIGTERM']) assert.equal(proc.listenerCount(e), 0, `${e}: the command's listener is gone once the screen's process ended`);
  });
}

test("N1: a screen's process that does not end on SIGTERM is killed when the wait is over; the command writes the leave sequence, says so, then its report; exit 1", async () => {
  const proc = new EventEmitter();
  const r = await run('deaf.mjs', [], { proc, stopWait: 300, onChild: (c) => c.stderr.on('data', (d) => { if (String(d).includes('waiting')) proc.emit('uncaughtException', new TypeError(`${PLANTED} error`)); }) });
  assert.equal(r.err.split('\n').slice(0, 3).join('\n'), "waiting\nignored SIGTERM\nltms-reader: the screen's process did not end within 300 ms of SIGTERM; this command ended it (SIGKILL) and restored the terminal.", JSON.stringify(r.err));
  assert.ok(r.err.includes(`\n${OWN_REPORT('TypeError')}`), JSON.stringify(r.err));
  assert.ok(!r.err.includes(PLANTED), 'the message is nowhere');
  assert.equal(r.out, LEAVE, 'the leave sequence, once, and nothing else on stdout');
  assert.equal(r.code, 1, 'exit 1');
});

test("N1: what the command writes of the screen's end is made visible, the path it was given in its advice too", async () => {
  const r = await run('aborts.mjs', ['x\x1b]0;TITLE\x07.jsonl']);
  assert.equal(r.code, 134);
  assert.ok(!/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(r.err), `no control character but the new line: ${JSON.stringify(r.err)}`);
  assert.ok(r.err.includes("npx ltms-reader 'x␛]0;TITLE\\x07.jsonl'\n"), JSON.stringify(r.err));
});

test("a screen's process that cannot start: the command says so, by the error's code, and ends with 1; nothing is written to stdout", async () => {
  const proc = new EventEmitter();
  const out = [], err = [];
  const code = await guard([], { execPath: path.join(OWN, 'guard', 'no-such-node'), execArgv: [], proc, entry: path.join(OWN, 'guard', 'exits.mjs'), out: (s) => out.push(s), err: (s) => err.push(s) });
  assert.equal(code, 1);
  assert.equal(err.join(''), "ltms-reader: the screen's process could not start (ENOENT); nothing was read\n");
  assert.equal(out.join(''), '');
  for (const e of ['uncaughtException', 'unhandledRejection', 'SIGTERM']) assert.equal(proc.listenerCount(e), 0, e);
});

test("a signal that could not be sent (Node's ChildProcess emits 'error' for it) is not a screen that never started: its end is read as before", async () => {
  const proc = new EventEmitter();
  const r = await run('waits.mjs', [], { proc, onChild: (c) => c.stderr.on('data', (d) => { if (String(d).includes('waiting')) { c.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM', syscall: 'kill' })); proc.emit('SIGTERM'); } }) });
  assert.equal(r.code, 143, "the screen's own exit code");
  assert.equal(r.err, 'waiting\ngot SIGTERM\n', 'and nothing said of a start that failed');
});
