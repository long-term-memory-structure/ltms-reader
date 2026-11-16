// src/start.mjs — what the reader opens, from its command line, and what it refuses before it reads anything.
//
//   ltms-reader                      the projects under ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects)
//   ltms-reader <projects folder>    another folder of project folders
//   ltms-reader <file.jsonl>         one transcript
//
// It shows transcripts on a terminal's screen and nowhere else, so it is refused at once when stdin or stdout is not a
// terminal: ltms is the command for lines (to read, or to pipe). A folder whose top holds transcripts and whose folders
// hold none at theirs is one project's own folder (given where its parent was meant): it is opened as that project.
import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export const USAGE = `usage: ltms-reader                      the projects under ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects)
       ltms-reader <projects folder>    another folder of project folders
       ltms-reader <file.jsonl>         one transcript

A full-screen reader of your Claude Code sessions, on this terminal's alternate screen: the projects, a project's
sessions, a session's turns, a turn's tool calls, a record's text. Read-only, local, no network.
Keys: arrows, PgUp PgDn, Home End move; Enter opens; Esc goes back; / searches; : opens an address; ? the keys; q quits.
For lines to read or to pipe, ltms is the command (npx long-term-memory-structure).
`;

/** The arguments: { help } | { version } | { path } (null for none) | { usage: what is wrong }. */
export function parseArgs(argv) {
  const rest = [];
  let ended = false;
  for (const a of argv) {
    if (!ended && a === '--') { ended = true; continue; }
    if (!ended && (a === '--help' || a === '-h')) return { help: true };
    if (!ended && (a === '--version' || a === '-v')) return { version: true };
    if (!ended && a.startsWith('-') && a !== '-') return { usage: `no option ${JSON.stringify(a)}` };
    rest.push(a);
  }
  if (rest.length > 1) return { usage: `one folder or one file, not ${rest.length} arguments` };
  return { path: rest[0] ?? null };
}

/** Why the reader does not run on these streams, or null when stdin and stdout are both terminals. */
export function notTerminal(stdin, stdout) {
  const inTty = stdin?.isTTY === true, outTty = stdout?.isTTY === true;
  if (inTty && outTty) return null;
  const which = !inTty && !outTty ? 'stdin and stdout are not terminals' : !outTty ? 'stdout is not a terminal' : 'stdin is not a terminal';
  return `ltms-reader: ${which}, so nothing was read.
ltms-reader shows transcripts on a terminal's screen only: none of their text goes to a pipe, a file or a log.
For lines to read or to pipe, ltms is the command (npx long-term-memory-structure, the package ltms-reader is built on):
  ltms index <projects folder>/<project>    the sessions, newest first
  ltms search '<words>' <folder>             the turns that hold the words, by address
  ltms skeleton <file.jsonl>                 a session's turns and tool calls, with their addresses
`;
}

const isJsonl = (name) => name.endsWith('.jsonl');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a folder is one project's own: transcripts at its top, and none at the top of any folder in it that is not
 *  a session's own (named by a UUID, or as a transcript beside it). */
function isProjectFolder(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  const files = new Set(entries.filter((e) => e.isFile() && isJsonl(e.name)).map((e) => e.name));
  if (!files.size) return false;
  for (const e of entries) {
    if (!e.isDirectory() || UUID.test(e.name) || files.has(`${e.name}.jsonl`)) continue;
    try { if (readdirSync(path.join(dir, e.name), { withFileTypes: true }).some((f) => f.isFile() && isJsonl(f.name))) return false; } catch {}
  }
  return true;
}

/**
 * What to open: { kind: 'root', root, from } (a folder of project folders; from: 'argument', 'CLAUDE_CONFIG_DIR' or
 * 'default'), { kind: 'root', root, project } (one project's own folder, under root), { kind: 'file', file } (one
 * transcript, its real path), or { refused: why }.
 */
export function startOf(arg, { env = process.env, home }) {
  if (arg === null) {
    const conf = typeof env.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR !== '' ? env.CLAUDE_CONFIG_DIR : null;
    const root = conf ? path.resolve(conf, 'projects') : path.join(home, '.claude', 'projects');
    let st = null;
    try { st = statSync(root); } catch {}
    if (!st?.isDirectory()) return { refused: `no folder at ${root}: ${conf ? 'CLAUDE_CONFIG_DIR names' : 'Claude Code keeps'} its projects there${conf ? '' : ' (CLAUDE_CONFIG_DIR moves them)'}. Give a folder of project folders, or one transcript (a .jsonl file).` };
    return { kind: 'root', root, from: conf ? 'CLAUDE_CONFIG_DIR' : 'default' };
  }
  const abs = path.resolve(arg);
  let st;
  try { st = statSync(abs); } catch (e) {
    let link = false;
    try { link = lstatSync(abs).isSymbolicLink(); } catch {}
    return { refused: link ? `${arg} is a symbolic link to nothing` : `no file or folder at ${arg}` };
  }
  if (st.isDirectory()) {
    if (isProjectFolder(abs)) {
      const real = realpathSync(abs);
      return { kind: 'root', root: path.dirname(real), project: path.basename(real), from: 'argument' };
    }
    return { kind: 'root', root: abs, from: 'argument' };
  }
  if (st.isFile()) {
    if (!isJsonl(abs)) return { refused: `${arg} is not a transcript: a transcript is a .jsonl file` };
    return { kind: 'file', file: realpathSync(abs) };
  }
  return { refused: `${arg} is neither a folder nor a regular file` };
}
