// test/fixtures/frame-once.mjs — run by tests in a process of their own, so that the reader runs under a heap limit of
// the test's choosing (node --max-old-space-size=…): the command (src/main.mjs's main) with these arguments, on streams
// standing for a terminal of LTMS_COLS x LTMS_ROWS (80 x 24); each key of LTMS_KEYS (a JSON array of the bytes a terminal
// sends) pressed in turn, each once nothing is being read; then the screen's lines, as one JSON array on stdout, and q.
import { main } from '../../src/main.mjs';
import { plainOf, terminal } from '../helpers.mjs';

const cols = Number(process.env.LTMS_COLS) || 80, rows = Number(process.env.LTMS_ROWS) || 24;
const keys = JSON.parse(process.env.LTMS_KEYS ?? '[]');
const t = terminal({ cols, rows });
const h = main(process.argv.slice(2), { stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, env: process.env, proc: t.proc });
if (typeof h !== 'object') { process.stdout.write(`${JSON.stringify({ exit: h, stderr: t.err() })}\n`); process.exit(0); }
const settle = async () => { await new Promise((r) => setTimeout(r, 20)); await h.app.idle(); };
await settle();
for (const k of keys) { t.stdin.write(k); await settle(); }
process.stdout.write(`${JSON.stringify(plainOf(h.app.lines()))}\n`);
t.stdin.write('q');
await settle();
process.exit(0);
