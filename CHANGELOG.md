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
  `j` shows a record's JSON, `?` the keys, `q` or Ctrl-C quits.
- The screen, with no library: raw mode, keypress events, the alternate screen, the cursor hidden, wrapping at the last
  column off, bracketed paste on (a paste is text, never keys); each frame drawn whole, each row erased first, again on
  a resize. The terminal is restored on every way out: `q` (exit 0),
  Ctrl-C and SIGINT (130), SIGHUP (129), SIGTERM (143), an uncaught error (1, printed after the restore by its kind and
  its place, not its message). `NO_COLOR` honoured.
- Text: every C0 and C1 control character and DEL shown as a visible escape (ESC as `␛`, the rest as `\xNN`), so a
  transcript's escape sequences (OSC 52 among them) never reach the terminal as such; and what reorders or hides text
  (bidirectional embeddings, overrides and isolates, the byte order mark, the line and paragraph separators, tag
  characters) as `\uXXXX`, while LRM, RLM and ALM are written as they are. Width by grapheme cluster, wide
  characters and emoji two columns, from a table generated from Unicode's `EastAsianWidth.txt` 17.0.0 (its sha256 in
  the table); lines cut by columns, never inside a cluster. Right to left: the text as written (the terminal lays it
  out); a measurement on the screens decides whether a reader-side layout is needed.
- A transcript is read in the reader's own process; one over a tenth of Node's memory limit is refused with its size
  and the `NODE_OPTIONS` that would let it be read, in the command that was run, the path given included. A record is
  refused the same way when its view would not fit beside the transcript in Node's memory, and its lines are laid out a
  page at a time. The screen runs in a process of its own: when it ends without restoring the terminal (Node's memory
  ran out), the command restores it, and exits with 128 and the signal's number.
- The view layer (`src/view.mjs`, `layout.mjs`, `engine.mjs`, `lines.mjs`, `helper.mjs`) moved here from the LTMS
  Reader extension, with its tests; the extension takes it from this package. Since the move, a prompt whose channel is
  an empty word reads `none`, as `ltms skeleton` prints it (the view layer gave an empty string; found by running the
  views over the core's own test transcripts, `test/fixtures/review/pb-labels.jsonl`); and a turn of more line numbers
  than a call takes arguments (about 31,000 tool calls in one turn, on Node 26) no longer stops its session's view with
  a RangeError.
