// src/main.mjs — the command: its arguments, the refusals made before anything is read, then the screen until a way
// out, and the terminal restored on each: q (exit 0), Ctrl-C (130), SIGINT (130), SIGHUP (129), SIGTERM (143), the
// command's process gone (129, as a hang-up: N5), and an uncaught error (1), which is printed after the restore. An error is printed by its kind and where it happened in this
// package, not by its message, which could quote a transcript (ltms's own rule); a refusal of this package's own (a file
// too large, a name refused) is printed whole: it holds paths and sizes, never a transcript's text.
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
  if (a.usage) { stderr.write(`ltms-reader: ${a.usage}\n${USAGE}`); return 2; }
  const tty = notTerminal(stdin, stdout);
  if (tty) { stderr.write(tty); return 2; }
  const rtl = rtlModeOf(env);
  if (rtl.refused) { stderr.write(visible(`ltms-reader: ${rtl.refused}; nothing was read\n`)); return 2; }
  const start = startOf(a.path, { env, home: homedir() });
  if (start.refused) { stderr.write(`ltms-reader: ${start.refused}\n`); return 2; }
  return { a, start, rtl: rtl.mode };
}

/**
 * Run the command. Returns the exit code when it ends before the screen (usage, a refusal); once the screen is open,
 * it returns { app, finish } and the process exits from the screen, through finish(). The streams and the process are
 * parameters so that the tests can run it whole on streams of their own. bin/ltms-reader.mjs runs this in a process of
 * its own (src/screen-process.mjs), and restores the terminal if that process ends without doing so (src/guard.mjs).
 */
export function main(argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env, proc = process } = {}) {
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
  // The channel is unref'd, so that it keeps nothing running; the exit puts back the terminal's modes as they were when
  // this process started, even where the shell has taken the terminal back (Node blocks SIGTTOU for that).
  if (proc.channel) { proc.on('disconnect', () => finish(129)); try { proc.channel.unref(); } catch {} }

  const draw = () => { if (screen && app) { const { cols, rows } = screen.size(); app.state.cols = cols; app.state.rows = rows; screen.draw(app.lines(), cols, rows); } };
  screen = openScreen({ input: stdin, output: stdout, colour: colourFrom(env), rtl, onKey: (str, k) => app?.key(str, k ?? {}), onResize: () => draw() });
  const { cols, rows } = screen.size();
  app = new App({ source, cols, rows, onChange: draw, onExit: (code) => finish(code) });
  app.start({ project: start.project ?? null });
  return { app, finish };
}
