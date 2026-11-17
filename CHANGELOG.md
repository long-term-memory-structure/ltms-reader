# Changelog

## Unreleased (0.1.0)

The first version: a full-screen terminal reader of Claude Code transcripts, on ltms 0.3 (`long-term-memory-structure`
`^0.3.0`, its one runtime dependency).

- Three ways in: no argument (the projects under `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`), a folder of
  project folders (a project's own folder opens as that project), one `.jsonl` transcript. When stdin or stdout is not a
  terminal it reads nothing, exits 2, and names `ltms` as the command for lines.
- The views: Projects; Sessions (`ltms index`); a session (its turns and compactions); a turn (its prompt, replies,
  tool calls with their error classes from `ltms skeleton`, results, notes); a record (its text a page at a time, or its
  JSON on `j`); Search (`ltms search`, with what was searched and what was not); Open (`:` and an address, as ltms prints
  it). Every row starts with its address; the selected row's is on the last line.
- The keys: ↑ ↓ PgUp PgDn Home End move, Enter or → opens, Esc or ← goes back, `/` searches, `:` opens an address,
  `r` reads Projects or a project's Sessions again (the selection kept on its row), `j` shows a record's JSON, `?` the
  keys, `q` or Ctrl-C quits.
- The screen, with no library: raw mode, keypress events, the alternate screen, the cursor hidden, wrapping at the last
  column off, bracketed paste on (a paste is text, never keys); each frame drawn whole, each row erased first, again on
  a resize; from 20 x 5, the status line (the selected row's address, `? keys`, `q quits`) always the last line drawn;
  under it, the size it needs, wrapped over the lines there are.
  The terminal is restored on every way out: `q` (exit 0),
  Ctrl-C and SIGINT (130), SIGHUP (129), SIGTERM (143), an uncaught error (1, printed after the restore by its kind and
  its place, not its message). `NO_COLOR` honoured.
- Text: every C0 and C1 control character and DEL shown as a visible escape (ESC as `␛`, the rest as `\xNN`), so a
  transcript's escape sequences (OSC 52 among them) never reach the terminal as such; and what reorders or hides text
  (bidirectional embeddings, overrides and isolates, the byte order mark, the line and paragraph separators, tag
  characters) as `\uXXXX`, while LRM, RLM and ALM are written as they are. Width by grapheme cluster, wide characters
  and emoji two columns, from a table generated from Unicode's `EastAsianWidth.txt` 17.0.0 (its sha256 in the table);
  lines cut by columns, never inside a cluster, a space where a line breaks staying at the end of the line before (UAX
  #14), so that no line but a paragraph's first begins with one, nor, where UAX #14 gives no break before one, with a
  no-break space or a non-breaking hyphen; a message's space at a break hangs, and a message ends with its last word.
  Right to left, one layout for every terminal (measured on Alacritty, Konsole, tmux and VS Code's terminal): the
  reader lays out each line itself, by the Unicode Bidirectional Algorithm (UAX #9, written here from Unicode 17.0.0's
  data, generated and pinned as the width table is; a path or a URL laid out as one left-to-right unit; a paragraph
  wrapped into lines, a record's text line or a message, resolved once and each line reordered from its levels, whole,
  its spaces at either end too), and writes a line that holds right-to-left text inside a left-to-right override (LRO
  after its first grapheme cluster, PDF at its end), so that a terminal that lays text out itself keeps that order;
  `LTMS_READER_BIDI=terminal` writes the text as stored instead, with an RLM at the end of each right-to-left
  paragraph.
- A transcript is read in the reader's own process; one over a tenth of Node's memory limit is refused with its size
  and the `NODE_OPTIONS` that would let it be read, in the command that was run, the path given included. A record is
  refused the same way when its view would not fit beside the transcript in Node's memory, by its size and by the JSON
  its view would write (measured by walking the record, before any is written: a record nested deep writes JSON
  hundreds of times its size), and its lines are laid out a page at a time. The screen runs in a process of its own: when it ends without restoring the terminal (Node's memory
  ran out), the command restores it, and exits with 128 and the signal's number; an error in the command's own process
  ends the screen by its own way out first, and is printed after the restore (exit 1); when the command's own process
  is killed, the screen's process learns of it, restores the terminal and ends.
- The view layer (`src/view.mjs`, `layout.mjs`, `engine.mjs`, `lines.mjs`, `helper.mjs`) moved here from the LTMS
  Reader extension, with its tests; the extension takes it from this package. Since the move, a prompt whose channel is
  an empty word reads `none`, as `ltms skeleton` prints it (the view layer gave an empty string; found by running the
  views over the core's own test transcripts, `test/fixtures/review/pb-labels.jsonl`); and a turn of more line numbers
  than a call takes arguments (about 31,000 tool calls in one turn, on Node 26) no longer stops its session's view with
  a RangeError; and a text the view layer clips (a prompt, an input, a result, a reply) is cut where a grapheme cluster
  begins, never between a letter and its marks, and its row ends with … when the clip cut its first line.
