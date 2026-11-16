#!/usr/bin/env node
// bin/ltms-reader.mjs — the reader's command: a full-screen reader of Claude Code transcripts, on a terminal only. What
// it does before the screen opens (the help, the version, a usage error, the refusals) it does here (src/main.mjs's
// before); the screen runs in a process of its own, which this one waits for, and the terminal is restored here when
// that process ends without restoring it, as a heap run out ends it (src/guard.mjs). The exit code is the screen's.
import { isatty } from 'node:tty';
import { guard } from '../src/guard.mjs';
import { before } from '../src/main.mjs';

const argv = process.argv.slice(2);
// only whether they are terminals is read of stdin and stdout here: this process never reads the terminal
const b = before(argv, { stdin: { isTTY: isatty(0) }, stdout: process.stdout, stderr: process.stderr, env: process.env });
if (typeof b === 'number') process.exitCode = b;
else process.exitCode = await guard(argv);
