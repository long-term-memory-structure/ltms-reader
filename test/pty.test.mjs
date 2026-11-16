// test/pty.test.mjs — the reader run end to end in a pseudo-terminal (Linux's `script`, no dependency): open, move,
// search, open an address, quit; and the terminal restored, read by `stty -g` in the same terminal before the reader
// starts and after it ends (the two must be the same), on every way out: q, Ctrl-C, SIGTERM, SIGHUP, SIGINT, and an
// uncaught error (a module loaded with node --import throws on the key x), whose report comes after the restore.
// The folder of projects is the test's own (makeRoot), and so are HOME and CLAUDE_CONFIG_DIR. Skipped where there is no
// `script` (not Linux, or util-linux missing).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BIN, KEY, OWN, deepRecord, makeRoot } from './helpers.mjs';

const SCRIPT = process.platform === 'linux' && spawnSync('script', ['--version'], { encoding: 'utf8' }).status === 0;
const skip = SCRIPT ? false : 'no `script` here (util-linux, Linux)';
// no core is kept of a run that aborts (the heap's tests abort on purpose): ulimit -c 0
const RUN = `#!/bin/sh
stty cols 80 rows 24
stty -g > "$LTMS_T/before"
ulimit -c 0
echo "<<tty=$(tty)>>"
sh -c 'echo "<<pid=$$>>"; exec "$@"' sh "$LTMS_NODE" $LTMS_NODE_ARGS "$LTMS_BIN" "$@"
echo "<<exit=$?>>"
[ -z "$LTMS_GO" ] || while [ ! -e "$LTMS_T/go" ]; do sleep 0.05; done
stty -g > "$LTMS_T/after"
`;
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// the sequences, written out here rather than taken from the code under test: enter the alternate screen, hide the
// cursor, wrapping off, bracketed paste on; and back: bracketed paste off, styles reset, wrapping on, the cursor shown,
// the main screen
const ENTER = '\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h', LEAVE = '\x1b[?2004l\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l';

/**
 * Run the reader in a pseudo-terminal of 80 x 24: each step waits for its text (a string, or a regular expression) in
 * what the terminal received since the step before, then sends its bytes or acts ({ pid, tty }: the command's process,
 * and the terminal's device, whose size stty -F changes). A step whose text has not come when the reader has ended
 * fails at once. Returns { out, exit, pid, before, after }.
 */
function ptyRun(r, { args, steps, nodeArgs = '', env = {}, wait = 20_000 }) {
  const run = path.join(r.base, 'run.sh');
  writeFileSync(run, RUN);
  chmodSync(run, 0o755);
  const child = spawn('script', ['-q', '-e', '-c', `${q(run)} ${args.map(q).join(' ')}`, '/dev/null'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, LANG: 'C.UTF-8', TERM: 'xterm-256color', HOME: r.base, CLAUDE_CONFIG_DIR: r.base, TZ: 'UTC', ...env, LTMS_T: r.base, LTMS_NODE: process.execPath, LTMS_BIN: BIN, LTMS_NODE_ARGS: nodeArgs },
  });
  let out = '', mark = 0, err = '';
  const pidOf = () => Number(/<<pid=(\d+)>>/.exec(out)?.[1] ?? 0);
  const ttyOf = () => /<<tty=([^>]+)>>/.exec(out)?.[1] ?? null;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  // what the screen says: the received bytes without the reader's escape sequences, which split a styled row
  const said = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  const until = (want, since) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const look = () => {
      const s = said(out.slice(since));
      if (typeof want === 'string' ? s.includes(want) : want.test(s)) return resolve();
      const ended = /<<exit=\d+>>/.exec(out);
      if (ended || Date.now() - t0 > wait) return reject(new Error(`no ${want} ${ended ? `before the reader ended (${ended[0]})` : `within ${wait} ms`}; the terminal received, last: ${JSON.stringify(out.slice(-600))}${err ? `; script said ${err}` : ''}`));
      setTimeout(look, 20);
    };
    look();
  });
  const done = new Promise((resolve) => child.on('close', resolve));
  return (async () => {
    try {
      for (const s of steps) {
        await until(s.until, mark);
        mark = out.length;
        if (typeof s.send === 'string') child.stdin.write(s.send);
        else if (typeof s.act === 'function') s.act({ pid: pidOf(), tty: ttyOf() });
      }
      await until(/<<exit=\d+>>/, 0);
      await done;
    } catch (e) { child.kill('SIGKILL'); await done; throw e; }
    finally { child.stdin.end(); }
    return { out, exit: Number(/<<exit=(\d+)>>/.exec(out)[1]), pid: pidOf(), before: readFileSync(path.join(r.base, 'before'), 'utf8'), after: readFileSync(path.join(r.base, 'after'), 'utf8') };
  })();
}

/** What the terminal received from the reader: from its first ENTER to the <<exit=…>> line. */
const readerPart = (out) => out.slice(out.indexOf(ENTER), out.indexOf('<<exit='));
/** The restore is the last thing the reader wrote to the screen: no frame after its last LEAVE. */
function restoredLast(out, what) {
  const part = readerPart(out), at = part.lastIndexOf(LEAVE);
  assert.ok(part.startsWith(ENTER), `${what}: the alternate screen entered`);
  assert.ok(at > 0, `${what}: the terminal restored`);
  assert.ok(!/\x1b\[\d+;1H/.test(part.slice(at)), `${what}: no frame drawn after the restore`);
  return part.slice(at + LEAVE.length);
}

test('end to end: open, move, search, open an address, quit; the terminal as it was', { skip, timeout: 120_000 }, async () => {
  const r = makeRoot('ltms-reader-pty-');
  try {
    const res = await ptyRun(r, {
      args: [r.root],
      steps: [
        { until: 'Projects', send: KEY.down },
        { until: '> -work-other', send: KEY.up },
        { until: '> -work-demo', send: KEY.enter },
        { until: '> 22222222', send: KEY.down },
        { until: '> 11111111', send: KEY.enter },
        { until: '> 11111111:T001', send: '/' },
        { until: '/ search in -work-demo:', send: 'npm test' },
        { until: 'npm test', send: KEY.enter },
        { until: '11111111:T003', send: ':' },
        { until: ': address:', send: '11111111:L22' },
        { until: '11111111:L22', send: KEY.enter },
        { until: 'Record 11111111:L22', send: 'q' },
      ],
    });
    assert.equal(res.exit, 0, 'q quits with 0');
    assert.equal(res.after, res.before, 'stty -g after = before');
    const rest = restoredLast(res.out, 'q');
    assert.equal(rest.replace(/\r?\n/g, ''), '', 'nothing after the restore');
    const part = readerPart(res.out);
    for (const seen of ['Sessions  -work-demo', 'Session 11111111', 'Search "npm test"  in -work-demo', 'Record 11111111:L22', '"command": "rm -rf ./build"']) assert.ok(part.includes(seen), `drawn: ${seen}`);
  } finally { r.dispose(); }
});

for (const [what, step, code] of [
  ['Ctrl-C', { send: KEY.ctrlc }, 130],
  ['SIGTERM', { act: ({ pid }) => process.kill(pid, 'SIGTERM') }, 143],
  ['SIGHUP', { act: ({ pid }) => process.kill(pid, 'SIGHUP') }, 129],
  ['SIGINT', { act: ({ pid }) => process.kill(pid, 'SIGINT') }, 130],
]) {
  test(`${what}: the terminal restored, exit ${code}`, { skip, timeout: 60_000 }, async () => {
    const r = makeRoot('ltms-reader-pty-');
    try {
      const res = await ptyRun(r, { args: [path.join(OWN, 'hebrew-english.jsonl')], steps: [{ until: '> hebrew-e:T001', send: KEY.enter }, { until: 'Turn hebrew-e:T001', ...step }] });
      assert.equal(res.exit, code);
      assert.equal(res.after, res.before, 'stty -g after = before');
      assert.equal(restoredLast(res.out, what).replace(/\r?\n/g, ''), '');
    } finally { r.dispose(); }
  });
}

test('an uncaught error: the terminal restored first, then the error, by its kind and place, not its message', { skip, timeout: 60_000 }, async () => {
  const r = makeRoot('ltms-reader-pty-');
  try {
    const res = await ptyRun(r, { args: [path.join(OWN, 'hebrew-english.jsonl')], nodeArgs: `--import ${path.join(OWN, 'throw-on-key.mjs')}`, steps: [{ until: '> hebrew-e:T001', send: 'x' }] });
    assert.equal(res.exit, 1);
    assert.equal(res.after, res.before, 'stty -g after = before');
    const rest = restoredLast(res.out, 'the error').replace(/\r\n/g, '\n');
    assert.match(rest, /^ltms-reader: an internal error \(Error\) ended it; the terminal was restored\.\n/);
    assert.match(rest, /throw-on-key\.mjs:\d+:\d+/, 'where it happened');
    assert.match(rest, /Its message is not printed: it could quote a transcript\.\n$/);
    assert.ok(!res.out.includes('a secret'), 'the message is nowhere');
  } finally { r.dispose(); }
});

// ---- N1 (S377): an error in the command's own process, while the frame is up ---------------------------------------------
// R's P1 planted it with node --import (a timer that throws, a rejection, a thrown string); here a module loaded the same
// way into both processes fails in the one that gets SIGUSR2, and the test sends it to the command's process only.
for (const [what, plant, kind] of [['an Error thrown', 'error', 'TypeError'], ['a promise rejected with nothing to catch it', 'reject', 'RangeError'], ['a string thrown', 'string', 'string'], ['an Error thrown again every 20 ms', 'interval', 'TypeError']]) {
  test(`N1: ${what} in the command's own process: the screen restores the terminal, then the command's report, by its kind, not its message; exit 1`, { skip, timeout: 60_000 }, async () => {
    const r = makeRoot('ltms-reader-pty-');
    try {
      const res = await ptyRun(r, { args: [path.join(OWN, 'hebrew-english.jsonl')], nodeArgs: `--import ${path.join(OWN, 'throw-on-signal.mjs')}`, env: { LTMS_PLANT: plant }, steps: [{ until: '> hebrew-e:T001', act: ({ pid }) => process.kill(pid, 'SIGUSR2') }] });
      assert.ok(!res.out.includes('PLANTED'), `the planted message is nowhere; the terminal received, last: ${JSON.stringify(res.out.slice(-700))}`);
      assert.equal(res.after, res.before, 'stty -g after = before');
      const rest = restoredLast(res.out, what).replace(/\r\n/g, '\n');
      assert.match(rest, new RegExp(`^ltms-reader: an internal error \\(${kind}\\) in the command's process ended it; the terminal was restored\\.\\n`), JSON.stringify(rest));
      assert.match(rest, /Its message is not printed: it could quote a transcript\.\n$/);
      assert.equal(res.exit, 1);
    } finally { r.dispose(); }
  });
}

// ---- N5 (S377): the command's own process killed (SIGKILL) --------------------------------------------------------------
// Nothing can run in a process SIGKILL ends: the screen's process must notice that the command's is gone. Here the shell
// takes stty -g "after" only once the screen's process has ended (LTMS_GO: it waits for the file go, which the test
// writes then, or after 5 s): before the repair it lived on, raw, until the terminal hung up.
const childrenOf = (pid) => { try { return readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').split(/\s+/).filter(Boolean).map(Number); } catch { return []; } };
/** Whether a process runs (a zombie, ended and not yet reaped, does not). */
const running = (pid) => { try { return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; } };

test("N5: SIGKILL to the command's own process: the screen's process notices, restores the terminal and ends", { skip, timeout: 60_000 }, async () => {
  const r = makeRoot('ltms-reader-pty-');
  let screen = 0, gone = Promise.resolve(null);
  try {
    const res = await ptyRun(r, {
      args: [path.join(OWN, 'hebrew-english.jsonl')], env: { LTMS_GO: '1' },
      steps: [{ until: '> hebrew-e:T001', act: ({ pid }) => {
        [screen = 0] = childrenOf(pid);
        process.kill(pid, 'SIGKILL');
        gone = (async () => {
          const t0 = Date.now();
          while (screen && running(screen) && Date.now() - t0 < 5000) await new Promise((x) => setTimeout(x, 10));
          const ms = screen && !running(screen) ? Date.now() - t0 : null;
          writeFileSync(path.join(r.base, 'go'), '');
          return ms;
        })();
      } }],
    });
    const ms = await gone;
    assert.ok(screen > 0, "the screen's process, a child of the command's");
    assert.notEqual(ms, null, "the screen's process ended within 5 s of the command's SIGKILL");
    assert.equal(res.exit, 137, 'the shell saw SIGKILL: 128 + 9');
    assert.equal(res.after, res.before, 'stty -g after = before');
    const at = res.out.lastIndexOf(LEAVE);
    assert.ok(at > res.out.indexOf(ENTER), 'the terminal restored');
    assert.ok(!/\x1b\[\d+;1H/.test(res.out.slice(at)), 'no frame drawn after the restore');
  } finally { if (screen && running(screen)) process.kill(screen, 'SIGKILL'); r.dispose(); }
});

// ---- R.F1: no transcript leaves the terminal raw ------------------------------------------------------------------------
/** R's transcript (R.F1): a prompt, a call, its result of 4,000,000 Hebrew characters with Claude Code's structured copy
 *  of it, and a reply; 14,000,514 bytes on the result's line. */
function hebrewRecord(file) {
  const base = { isSidechain: false, userType: 'external', cwd: '/work/r', sessionId: 'oooooooo-0000-4000-8000-000000000000', version: '2.0.0', gitBranch: 'main', entrypoint: 'cli' };
  const u = (n) => `oo000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const usage = { input_tokens: 1, output_tokens: 1 };
  const big = 'אבג '.repeat(1_000_000);
  const recs = [
    { ...base, parentUuid: null, type: 'user', message: { role: 'user', content: 'OOM-T1 read the big file' }, uuid: u(1), timestamp: '2026-03-01T10:00:00.000Z', promptSource: 'typed' },
    { ...base, parentUuid: u(1), type: 'assistant', message: { id: 'msg_o1', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'toolu_o1', name: 'Bash', input: { command: 'cat big.txt' } }], stop_reason: 'tool_use', usage }, requestId: 'req_o1', uuid: u(2), timestamp: '2026-03-01T10:00:01.000Z' },
    { ...base, parentUuid: u(2), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_o1', content: big, is_error: false }] }, uuid: u(3), timestamp: '2026-03-01T10:00:02.000Z', toolUseResult: { stdout: big, stderr: '' } },
    { ...base, parentUuid: u(3), type: 'assistant', message: { id: 'msg_o2', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage }, requestId: 'req_o2', uuid: u(4), timestamp: '2026-03-01T10:00:03.000Z' },
  ];
  const fd = openSync(file, 'w');
  try { for (const r of recs) writeSync(fd, `${JSON.stringify(r)}\n`); } finally { closeSync(fd); }
}
const OOM = 'oooooooo-0000-4000-8000-000000000000.jsonl';
const resize = (cols) => ({ act: ({ tty }) => execFileSync('stty', ['-F', tty, 'cols', String(cols), 'rows', '24']) });
const toTheRecord = [
  { until: '> oooooooo:T001', send: KEY.enter },
  { until: 'Turn oooooooo:T001', send: KEY.down + KEY.down },
  { until: /> oooooooo:L3 +result/, send: KEY.enter },
];

test('R.F1: R\'s record of 4,000,000 Hebrew characters, at a heap of 512 MB: shown, then as JSON, the window widened three times, q; the terminal as it was', { skip, timeout: 300_000 }, async () => {
  const r = makeRoot('ltms-reader-pty-');
  try {
    const file = path.join(r.base, OOM);
    hebrewRecord(file);
    const res = await ptyRun(r, {
      args: [file], env: { NODE_OPTIONS: '--max-old-space-size=512' }, wait: 120_000,
      steps: [...toTheRecord, { until: 'Record oooooooo:L3', send: 'j' }, { until: 'as JSON', ...resize(87) }, { until: 'Record oooooooo:L3', ...resize(94) }, { until: 'Record oooooooo:L3', ...resize(101) }, { until: 'Record oooooooo:L3', send: 'q' }],
    });
    assert.equal(res.exit, 0, `q quits with 0; the terminal received, last: ${JSON.stringify(res.out.slice(-400))}`);
    assert.equal(res.after, res.before, 'stty -g after = before');
    assert.equal(restoredLast(res.out, 'q').replace(/\r?\n/g, ''), '', 'nothing after the restore');
  } finally { r.dispose(); }
});

test('R.F1: the same record at a heap of 128 MB: refused before it is drawn, with its size and the NODE_OPTIONS that would show it, the path given in the command; q, and the terminal as it was', { skip, timeout: 300_000 }, async () => {
  const r = makeRoot('ltms-reader-pty-');
  try {
    const file = path.join(r.base, OOM);
    hebrewRecord(file);
    const res = await ptyRun(r, { args: [file], env: { NODE_OPTIONS: '--max-old-space-size=128' }, wait: 120_000, steps: [...toTheRecord, { until: 'this record is not shown', send: 'q' }] });
    assert.equal(res.exit, 0, `q quits with 0; the terminal received, last: ${JSON.stringify(res.out.slice(-400))}`);
    assert.equal(res.after, res.before, 'stty -g after = before');
    // the refusal's lines, read without the screen's own sequences and spaces (it is wrapped at 78 columns)
    const shown = readerPart(res.out).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\s+/g, '');
    assert.ok(shown.includes('oooooooo:L3isnotshown:itis14MB,andinatranscriptof14MBthisprocessshowsarecordofupto'), 'its size, and the record this process shows');
    assert.ok(shown.includes(`NODE_OPTIONS=--max-old-space-size=512npxltms-reader${file}`.replace(/\s+/g, '')), 'the setting that shows it, with the path given');
    assert.equal(restoredLast(res.out, 'q').replace(/\r?\n/g, ''), '', 'nothing after the restore');
  } finally { r.dispose(); }
});

test('R.F1: the heap run out all the same (planted): the terminal restored by the command, V8\'s report and what happened after it, exit 134', { skip, timeout: 120_000 }, async () => {
  const r = makeRoot('ltms-reader-pty-');
  try {
    const res = await ptyRun(r, { args: [path.join(OWN, 'hebrew-english.jsonl')], nodeArgs: `--max-old-space-size=64 --import ${path.join(OWN, 'heap-out-on-key.mjs')}`, wait: 60_000, steps: [{ until: '> hebrew-e:T001', send: 'x' }] });
    assert.equal(res.exit, 134, 'SIGABRT: 128 + 6');
    assert.equal(res.after, res.before, 'stty -g after = before');
    const rest = restoredLast(res.out, 'the abort').replace(/\r\n/g, '\n');
    assert.match(rest, /FATAL ERROR: .*JavaScript heap out of memory/, "V8's report, after the restore");
    assert.match(rest, /ltms-reader: the screen's process ended by SIGABRT, without restoring the terminal; this command restored it\. Node's heap ran out, as it says above: to give it more memory, NODE_OPTIONS=--max-old-space-size=\d+ npx ltms-reader \S+hebrew-english\.jsonl\n$/);
  } finally { r.dispose(); }
});

// ---- N3 (S377): a record nested deep, at a small heap -------------------------------------------------------------------
test("N3: the checker's record nested 990 deep (a line of 0.8 MB) at --max-old-space-size=256: refused before it is drawn, with the setting that shows it; j does nothing; at that setting it is shown, as JSON too", { skip, timeout: 300_000 }, async () => {
  const r = makeRoot('ltms-reader-pty-');
  try {
    const file = path.join(r.base, 'dddddddd-0000-4000-8000-000000000000.jsonl');
    deepRecord(file, 990, 400_000);
    const toResult = [{ until: '> dddddddd:T001', send: KEY.enter }, { until: 'Turn dddddddd:T001', send: KEY.down + KEY.down }, { until: /> dddddddd:L3 +result/, send: KEY.enter }];
    const res = await ptyRun(r, { args: [file], env: { NODE_OPTIONS: '--max-old-space-size=256' }, wait: 120_000, steps: [...toResult, { until: /this record is not shown|Record dddddddd:L3/, send: 'j' }, { until: /this record is not shown|as JSON/, send: 'q' }] });
    assert.equal(res.exit, 0, `q quits with 0; the terminal received, last: ${JSON.stringify(res.out.slice(-400))}`);
    assert.equal(res.after, res.before, 'stty -g after = before');
    const shown = readerPart(res.out).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\s+/g, '');
    assert.ok(shown.includes('dddddddd:L3isnotshown:itis784KB,anditsviewwouldwrite'), 'its size, and what its view would write');
    const need = /NODE_OPTIONS=--max-old-space-size=(\d+)npxltms-reader(\S+?)ltms-reader/.exec(shown) ?? /NODE_OPTIONS=--max-old-space-size=(\d+)npxltms-reader/.exec(shown);
    assert.ok(need, 'the setting that shows it');
    assert.ok(shown.includes(`NODE_OPTIONS=--max-old-space-size=${need[1]}npxltms-reader${file}`), 'with the path given');
    assert.equal(restoredLast(res.out, 'q').replace(/\r?\n/g, ''), '', 'nothing after the restore');
    const again = await ptyRun(r, { args: [file], env: { NODE_OPTIONS: `--max-old-space-size=${need[1]}` }, wait: 120_000, steps: [...toResult, { until: 'Record dddddddd:L3', send: 'j' }, { until: 'as JSON', send: 'q' }] });
    assert.equal(again.exit, 0, `at ${need[1]}: shown, as JSON, and q quits with 0`);
    assert.equal(again.after, again.before, 'stty -g after = before');
  } finally { r.dispose(); }
});

// ---- R1 (S377, round 3): right to left, end to end ------------------------------------------------------------------------
// The Hebrew fixture's first prompt, opened as a record, as the terminal receives it: laid out by the reader by default
// (every terminal but Konsole), as stored with an RLM after it under Konsole (KONSOLE_VERSION), LTMS_READER_BIDI over
// both; a value LTMS_READER_BIDI does not take is refused before the screen opens. The two forms are spelled out with
// escapes here, the visual one as test/bidi.test.mjs's oracles give it.
const STORED = '\u05d1\u05b0\u05bc\u05e8\u05b5\u05d0\u05e9\u05b4\u05c1\u05d9\u05ea: read src/\u05de\u05d5\u05d3\u05d5\u05dc.ts (line 12) and fix [the bug] in \u05e4\u05d5\u05e0\u05e7\u05e6\u05d9\u05d4() \u2014 3.14 > 2';
const LAID_OUT = '2 < 3.14 \u2014 ()\u05d4\u05d9\u05e6\u05e7\u05e0\u05d5\u05e4 read src/\u05dc\u05d5\u05d3\u05d5\u05de.ts (line 12) and fix [the bug] in :\u05ea\u05d9\u05e9\u05b4\u05c1\u05d0\u05e8\u05b5\u05d1\u05b0\u05bc';
for (const [what, env, want] of [
  ['by default (no Konsole): laid out by the reader', {}, LAID_OUT],
  ['under Konsole (KONSOLE_VERSION): as stored, with an RLM after it', { KONSOLE_VERSION: '260803' }, `${STORED}\u200f`],
  ['under Konsole with LTMS_READER_BIDI=reader: laid out by the reader', { KONSOLE_VERSION: '260803', LTMS_READER_BIDI: 'reader' }, LAID_OUT],
  ['LTMS_READER_BIDI=terminal: as stored, with an RLM after it', { LTMS_READER_BIDI: 'terminal' }, `${STORED}\u200f`],
]) {
  test(`R1: a Hebrew record ${what}; q, and the terminal as it was`, { skip, timeout: 60_000 }, async () => {
    const r = makeRoot('ltms-reader-pty-');
    try {
      const res = await ptyRun(r, { args: [path.join(OWN, 'hebrew-english.jsonl')], env, steps: [{ until: '> hebrew-e:T001', send: KEY.enter }, { until: 'Turn hebrew-e:T001', send: KEY.enter }, { until: 'Record hebrew-e:L1', send: 'q' }] });
      assert.equal(res.exit, 0);
      assert.equal(res.after, res.before, 'stty -g after = before');
      const shown = readerPart(res.out).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
      assert.ok(shown.includes(want), `the record's line as the terminal received it: ${JSON.stringify(shown.slice(shown.indexOf('Record hebrew-e:L1'), shown.indexOf('Record hebrew-e:L1') + 400))}`);
      const other = want === LAID_OUT ? STORED : LAID_OUT;
      assert.ok(!shown.includes(other), 'and not in the other form');
    } finally { r.dispose(); }
  });
}

test('R1: LTMS_READER_BIDI set to a mode there is not: refused before the screen opens, exit 2, the terminal as it was', { skip, timeout: 60_000 }, async () => {
  const r = makeRoot('ltms-reader-pty-');
  try {
    const res = await ptyRun(r, { args: [path.join(OWN, 'hebrew-english.jsonl')], env: { LTMS_READER_BIDI: 'auto' }, steps: [] });
    assert.equal(res.exit, 2);
    assert.equal(res.after, res.before, 'stty -g after = before');
    assert.ok(!res.out.includes(ENTER), 'the screen never opened');
    assert.match(res.out.replace(/\r\n/g, '\n'), /ltms-reader: LTMS_READER_BIDI is "auto": it takes "reader" .* or "terminal" .*; nothing was read\n/);
  } finally { r.dispose(); }
});
