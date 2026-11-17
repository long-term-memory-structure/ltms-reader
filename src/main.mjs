// src/main.mjs — the command: its arguments, the refusals made before anything is read, then the screen until a way
// out, and the terminal restored on each: q (exit 0), Ctrl-C (130), SIGINT (130), SIGHUP (129), SIGTERM (143), the
// command's process gone (N5; R3: then this process ends by SIGKILL, no one waiting for its code), and an uncaught error
// (1), which is printed after the restore. An error is printed by its kind and where it happened in this package, not by
// its message, which could quote a transcript (ltms's own rule); a refusal of this package's own (a file too large, a
// name refused) is printed whole: it holds paths and sizes, never a transcript's text.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from './app.mjs';
import { openScreen, colourFrom } from './screen.mjs';
import { FileSource, RootSource } from './sources.mjs';
import { USAGE, againOf, notTerminal, parseArgs, startOf } from './start.mjs';
import { rtlModeOf, visible } from './text.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const version = () => JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/** What is printed of an error after the terminal is restored: its kind, and the lines of its stack that are in this
 *  package or in Node; its message only when it is a refusal of this package's own (it has a kind). `where`: the
 *  process it happened in, when it is not the screen's (src/guard.mjs: "the command's process"). */
export function errorReport(e, where = null) {
  const kind = typeof e?.name === 'string' ? e.name : typeof e;
  const own = e instanceof Error && typeof e.kind === 'string';
  const frames = String(e?.stack ?? '').split('\n').filter((l) => /^\s+at /.test(l) && (l.includes(ROOT) || /\(node:|at node:/.test(l))).slice(0, 12);
  return visible(`ltms-reader: ${own ? e.message : `an internal error (${kind})${where ? ` in ${where}` : ''} ended it`}; the terminal was restored.\n${frames.length ? `${frames.join('\n')}\n` : ''}${own ? '' : 'Its message is not printed: it could quote a transcript.\n'}`);
}

/**
 * What the command does before its screen opens: the help, the version, a usage error, and the refusals (stdin or
 * stdout not a terminal, LTMS_READER_BIDI set to a mode there is not, a path that is none of the three ways in), each
 * written, and its exit code returned; or, when the screen is to open, { a: the arguments, start: what to open, rtl: the
 * right-to-left mode }. Only isTTY is read of stdin and stdout.
 */
export function before(argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  const a = parseArgs(argv);
  if (a.help) { stdout.write(USAGE); return 0; }
  if (a.version) { stdout.write(`ltms-reader ${version()}\n`); return 0; }
  if (a.usage) { stderr.write(`${visible(`ltms-reader: ${a.usage}\n`)}${USAGE}`); return 2; }
  const tty = notTerminal(stdin, stdout);
  if (tty) { stderr.write(tty); return 2; }
  const rtl = rtlModeOf(env);
  if (rtl.refused) { stderr.write(visible(`ltms-reader: ${rtl.refused}; nothing was read\n`)); return 2; }
  const start = startOf(a.path, { env, home: homedir() });
  if (start.refused) { stderr.write(visible(`ltms-reader: ${start.refused}\n`)); return 2; }
  return { a, start, rtl: rtl.mode };
}

/** Who has the terminal now, by /proc/self/stat (Linux): { ours: whether this process's group is the terminal's
 *  foreground group, group: the foreground group }; null where that cannot be read (another system, no terminal). */
export function terminalOwner(stat = () => readFileSync('/proc/self/stat', 'utf8')) {
  try {
    const s = stat(), f = s.slice(s.lastIndexOf(')') + 2).split(' ');
    const pgrp = Number(f[2]), tpgid = Number(f[5]);
    if (!(pgrp > 0) || !(tpgid > 0)) return null;
    return { ours: tpgid === pgrp, group: tpgid };
  } catch { return null; }
}

/** The terminal's modes as `stty -g` gives them, read on this process's stdin; null when stty cannot say. */
export function terminalModes() {
  try {
    const r = spawnSync('stty', ['-g'], { stdio: [0, 'pipe', 'ignore'], encoding: 'utf8', timeout: 2000 });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch { return null; }
}

/**
 * Run the command. Returns the exit code when it ends before the screen (usage, a refusal); once the screen is open,
 * it returns { app, finish } and the process exits from the screen, through finish(). The streams and the process are
 * parameters so that the tests can run it whole on streams of their own. bin/ltms-reader.mjs runs this in a process of
 * its own (src/screen-process.mjs), and restores the terminal if that process ends without doing so (src/guard.mjs).
 */
export function main(argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env, proc = process, owner = terminalOwner, modes = terminalModes } = {}) {
  const b = before(argv, { stdin, stdout, stderr, env });
  if (typeof b === 'number') return b;
  const { a, start, rtl } = b;

  // a refusal of a transcript too large names the command that was run, with what it was given
  const again = againOf(a.path);
  const source = start.kind === 'file' ? new FileSource({ file: start.file, again }) : new RootSource({ root: start.root, only: start.project ?? null, again });
  let screen = null, app = null, finished = false;
  const finish = (code, err = null) => {
    if (finished) return;
    finished = true;
    try { app?.dispose(); } catch {}
    try { screen?.restore(); } catch {}
    try { source.dispose(); } catch {}
    if (err !== null) { try { stderr.write(errorReport(err)); } catch {} }
    proc.exit(code);
  };
  proc.on('SIGTERM', () => finish(143));
  proc.on('SIGHUP', () => finish(129));
  proc.on('SIGINT', () => finish(130));
  proc.on('uncaughtException', (e) => finish(1, e));
  proc.on('unhandledRejection', (e) => finish(1, e));
  proc.on('exit', () => { try { screen?.restore(); } catch {} });
  // run by the command (src/guard.mjs), this process has an IPC channel to it, which closes when the command's process
  // is gone, by SIGKILL too, which nothing there can answer (N5): the terminal is restored here, and this process ends.
  // The channel is unref'd, so that it keeps nothing running.
  //
  // R3: a shell with job control that waited for the command takes the terminal back as soon as the command is gone
  // (measured: bash, zsh and fish wrote their prompt 4 to 6 ms after its SIGKILL, this process 4 to 5 ms after), and
  // sets its own modes (bash and fish set theirs; zsh builds its line editor's on the modes it finds). This process's
  // group is then a background one, orphaned, so that the kernel refuses it the terminal's modes (EIO), but where SIGTTOU
  // is blocked, as Node's own exit blocks it to put back the modes this process started with: that put them back over
  // the shell's (the terminal echoed what was typed twice). So the leave sequence is written at once (the screen), and
  // when the terminal is no longer this process group's, the modes are left to the shell, but if they are still the
  // screen's raw ones (`stty -g`, read when the screen opened): a shell that sets none (as dash's job control sets none)
  // gets them back by Node's own exit; otherwise this process ends by SIGKILL, without that exit.
  const commandGone = () => {
    if (finished) return;
    finished = true;
    try { app?.dispose(); } catch {}
    const who = owner(), back = who !== null && !who.ours;
    try { screen?.restore({ modes: !back }); } catch {}
    try { source.dispose(); } catch {}
    if (back && (rawModes === null || modes() === rawModes)) { proc.exit(129); return; }
    proc.kill(proc.pid, 'SIGKILL');
  };
  if (proc.channel) { proc.on('disconnect', commandGone); try { proc.channel.unref(); } catch {} }

  const draw = () => { if (screen && app) { const { cols, rows } = screen.size(); app.state.cols = cols; app.state.rows = rows; screen.draw(app.lines(), cols, rows); } };
  screen = openScreen({ input: stdin, output: stdout, colour: colourFrom(env), rtl, onKey: (str, k) => app?.key(str, k ?? {}), onResize: () => draw() });
  // the screen's raw modes, by stty, to tell after the command's end whether a shell has set its own since (R3)
  const rawModes = proc.channel ? modes() : null;
  const { cols, rows } = screen.size();
  app = new App({ source, cols, rows, onChange: draw, onExit: (code) => finish(code) });
  app.start({ project: start.project ?? null });
  return { app, finish };
}
