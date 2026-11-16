// test/pty.test.mjs — the reader run end to end in a pseudo-terminal (Linux's `script`, no dependency): open, move,
// search, open an address, quit; and the terminal restored, read by `stty -g` in the same terminal before the reader
// starts and after it ends (the two must be the same), on every way out: q, Ctrl-C, SIGTERM, SIGHUP, SIGINT, and an
// uncaught error (a module loaded with node --import throws on the key x), whose report comes after the restore.
// The folder of projects is the test's own (makeRoot), and so are HOME and CLAUDE_CONFIG_DIR. Skipped where there is no
// `script` (not Linux, or util-linux missing).
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BIN, KEY, OWN, makeRoot } from './helpers.mjs';

const SCRIPT = process.platform === 'linux' && spawnSync('script', ['--version'], { encoding: 'utf8' }).status === 0;
const skip = SCRIPT ? false : 'no `script` here (util-linux, Linux)';
const RUN = `#!/bin/sh
stty cols 80 rows 24
stty -g > "$LTMS_T/before"
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
 * what the terminal received since the step before, then sends its bytes or acts. Returns { out, exit, pid, before,
 * after }.
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
      if (Date.now() - t0 > wait) return reject(new Error(`no ${want} within ${wait} ms; the terminal received, last: ${JSON.stringify(out.slice(-600))}${err ? `; script said ${err}` : ''}`));
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
        else if (typeof s.act === 'function') s.act({ pid: pidOf() });
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
