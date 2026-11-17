// test/fixtures/large-turn.mjs — run by test/large.test.mjs in a process of its own, given no NODE_OPTIONS and no flag
// (R8b, round 8: in the test's own process, under NODE_OPTIONS=--max-old-space-size=100, the size rules refused the
// file, and with them set aside its parse ran that old space out). The transcript at the path given is read in this
// process, as the reader reads it; then the App opens it on a screen of 80 x 24, Enter opens its turn, End goes to the
// turn's last row. What it saw, as one JSON line on stdout: the session view's turns, the turn's calls and its first and
// last line, the session's error if any, the view on top after Enter and its rows, the selected row after End.
import { App } from '../../src/app.mjs';
import { readTranscript } from '../../src/reading.mjs';
import { FileSource } from '../../src/sources.mjs';
import { top } from '../../src/views.mjs';
import { KEY, keyboard, plainOf } from '../helpers.mjs';

const file = process.argv[2];
const d = readTranscript(file);
const turn = d.view.turns[0];
const seen = { turns: d.view.turns.length, calls: turn?.calls ?? null, from: turn?.from ?? null, to: turn?.to ?? null };
const source = new FileSource({ file });
const app = new App({ source, cols: 80, rows: 24, timeZone: 'UTC' });
const k = keyboard(app);
try {
  app.start(); await app.idle();
  seen.error = top(app.state).error ?? null;
  await k.press(KEY.enter);
  seen.kind = top(app.state).kind;
  seen.rows = top(app.state).rows?.length ?? null;
  await k.press(KEY.end);
  seen.selected = plainOf(app.lines()).find((l) => l.startsWith('> ')) ?? null;
} finally { app.dispose(); source.dispose(); }
process.stdout.write(`${JSON.stringify(seen)}\n`);
process.exit(0);
