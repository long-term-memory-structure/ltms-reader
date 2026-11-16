#!/usr/bin/env node
// bin/ltms-reader.mjs — the reader's command (src/main.mjs): a full-screen reader of Claude Code transcripts, on a
// terminal only. Before the screen opens, it exits with the code main() returns; once open, it exits from the screen.
import { main } from '../src/main.mjs';

const code = main(process.argv.slice(2));
if (typeof code === 'number') process.exitCode = code;
