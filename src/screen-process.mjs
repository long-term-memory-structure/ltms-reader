// src/screen-process.mjs — the reader's screen in a process of its own: bin/ltms-reader.mjs starts it (src/guard.mjs)
// on its own terminal, with its own arguments, and restores the terminal when this process ends without doing so.
import { main } from './main.mjs';

const code = main(process.argv.slice(2));
if (typeof code === 'number') process.exitCode = code;
