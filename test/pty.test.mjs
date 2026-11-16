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
import { BIN, KEY, OWN, makeRoot } from './helpers.mjs';

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
stty -g > "$LTMS_T/after"
`;
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// the sequences, written out here rather than taken from the code under test: enter the alternate screen, hide the
// cursor, wrapping off; and back: styles reset, wrapping on, the cursor shown, the main screen
const ENTER = '\x1b[?1049h\x1b[?25l\x1b[?7l', LEAVE = '\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l';

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
