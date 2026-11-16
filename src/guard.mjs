// src/guard.mjs — the reader's screen runs in a child process of the command (src/screen-process.mjs), on the same
// terminal, and the command waits for it. Every way out the screen knows of (q, Ctrl-C, SIGTERM, SIGHUP, SIGINT, an
// uncaught error) restores the terminal in that process (src/main.mjs). A way out it cannot know of ends it without the
// restore: V8's heap running out aborts the process (SIGABRT), and so does any other fatal error; SIGKILL ends it. Then
// this process writes the leave sequence, and Node puts the terminal's mode back as this process exits, to what it was
// when this process started (measured, R.F1: in a pseudo-terminal, a child that took raw mode and the alternate screen,
// then ran out of heap, left stty -g changed when it ran alone, and as it was before when it ran under a parent that
// wrote the leave sequence and exited; Node's own exit restores the terminal modes of its stdin, stdout and stderr).
//
// A signal sent to this process (SIGINT, SIGTERM, SIGHUP) is passed on to the screen's, whose own way out it is; this
// process then ends with the screen's exit code. What the screen's process writes to stderr is kept (its last 64 KB)
// and written after it ends: its own error report comes after its own restore, as before, and V8's report of a heap
// run out comes after this restore, on the main screen, instead of on the alternate screen that the restore takes away.
// The screen's process uses this process's Node, its flags (process.execArgv) and its environment (NODE_OPTIONS too).
//
// An error in this process itself (thrown and not caught, or a promise rejected with nothing to catch it: a module
// loaded through NODE_OPTIONS or --import that throws, say) ends the screen by its own way out, SIGTERM, on which the
// screen's process restores the terminal and exits; this process waits for that (STOP_WAIT at most; then SIGKILL, and
// the leave sequence is written here), writes what the screen's process wrote to stderr, then its own report, after the
// restore, by the error's kind and place, not its message (src/main.mjs errorReport), and ends with 1. N1 (S377): Node's
// own report of such an error, its message with it, was written on the alternate screen while the frame was up, and the
// screen's own report went to a pipe no one read. Everything this process writes to stderr is made visible.
//
// Nothing runs in this process when SIGKILL ends it: the screen's process learns of it by an IPC channel this process
// opens to it, which the kernel closes when this process is gone, and then restores the terminal and ends
// (src/main.mjs). N5 (S377): it lived on, raw, until the terminal hung up. Measured: the channel's disconnect, and the
// end of a socketpair on fd 3, each reached a child 3 to 4 ms after its parent's SIGKILL, on Node 26.13.1 and 20.20.2,
// and neither kept an idle child running once unref'd; the channel needs no flag to say it is there (process.channel).
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { constants } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import { errorReport } from './main.mjs';
import { LEAVE } from './screen.mjs';
import { againOf, parseArgs } from './start.mjs';
import { visible } from './text.mjs';

export const SCREEN_PROCESS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screen-process.mjs');
/** The end of the screen process's stderr kept to be written after it ends. */
const KEEP = 64 * 1024;
const MB = 1024 * 1024;
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP'];
/** How long the screen's process is given to end by its own way out (SIGTERM) when this process has failed itself. */
export const STOP_WAIT = 2000;

/** What this process says when the screen's process ended by a signal: the signal, the restore, and, when what it wrote
 *  says V8's heap ran out, the setting that gives it more (twice this process's heap limit, the same flags as the
 *  screen's process had). */
export function endedBy(signal, said, argv, heapLimit = getHeapStatistics().heap_size_limit) {
  const heap = /heap out of memory/.test(said);
  const more = Math.ceil((2 * heapLimit) / MB / 256) * 256;
  return `ltms-reader: the screen's process ended by ${signal}, without restoring the terminal; this command restored it.${heap ? ` Node's heap ran out, as it says above: to give it more memory, NODE_OPTIONS=--max-old-space-size=${more} ${againOf(parseArgs(argv).path ?? null)}` : ''}\n`;
}

/**
 * Run the screen (src/main.mjs's main, in src/screen-process.mjs) in a child process on this terminal, with `argv`;
 * resolves to the exit code this command ends with: the screen's own, or 128 + the signal's number when a signal ended
 * it, after the restore; 1 when this process failed itself (its uncaughtException or unhandledRejection, on `proc`).
 * `out` and `err` write to this process's stdout and stderr; `proc` receives the signals passed on and this process's
 * own errors; the rest are parameters so that a test can run it with a screen of its own (onChild: given the child
 * process; stopWait: STOP_WAIT).
 */
export function guard(argv, { execPath = process.execPath, execArgv = process.execArgv, env = process.env, proc = process, entry = SCREEN_PROCESS, out = (s) => writeSync(1, s), err = (s) => writeSync(2, s), onChild = null, stopWait = STOP_WAIT } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(execPath, [...execArgv, entry, ...argv], { stdio: ['inherit', 'inherit', 'pipe', 'ipc'], env }); }
    catch (e) { try { err(`ltms-reader: the screen's process could not start (${visible(e?.code ?? e?.name ?? 'error')}); nothing was read\n`); } catch {} resolve(1); return; }
    onChild?.(child);
    let said = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { said = (said + d).slice(-KEEP); });
    const pass = Object.fromEntries(FORWARDED.map((sig) => [sig, () => { try { child.kill(sig); } catch {} }]));
    for (const sig of FORWARDED) proc.on(sig, pass[sig]);
    // an error of this process's own: the first is kept, and the screen's process is ended by its own way out
    let failed = null, stopping = null;
    const fail = (e) => {
      if (failed) return;
      failed = { e, killed: false };
      try { child.kill('SIGTERM'); } catch {}
      stopping = setTimeout(() => { failed.killed = true; try { child.kill('SIGKILL'); } catch {} }, stopWait);
    };
    proc.on('uncaughtException', fail);
    proc.on('unhandledRejection', fail);
    let started = true;
    child.on('error', (e) => {
      // it could not start (it has no pid): the terminal was never taken; a signal that could not be sent is not that
      if (child.pid !== undefined) return;
      started = false;
      try { err(`ltms-reader: the screen's process could not start (${visible(e?.code ?? e?.name ?? 'error')}); nothing was read\n`); } catch {}
    });
    child.on('close', (code, signal) => {
      clearTimeout(stopping);
      for (const sig of FORWARDED) proc.off(sig, pass[sig]);
      proc.off('uncaughtException', fail);
      proc.off('unhandledRejection', fail);
      const own = () => { if (failed) { try { err(errorReport(failed.e, "the command's process")); } catch {} } };
      if (!started) { own(); resolve(1); return; }
      if (signal) { try { out(LEAVE); } catch {} }
      if (said) { try { err(visible(said)); } catch {} }
      if (failed) {
        if (signal) { try { err(failed.killed && signal === 'SIGKILL' ? `ltms-reader: the screen's process did not end within ${stopWait} ms of SIGTERM; this command ended it (SIGKILL) and restored the terminal.\n` : visible(endedBy(signal, said, argv))); } catch {} }
        own();
        resolve(1);
        return;
      }
      if (signal) {
        try { err(visible(endedBy(signal, said, argv))); } catch {}
        resolve(128 + (constants.signals[signal] ?? 0));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
