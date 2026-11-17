# Changelog

## 0.1.0 (2026-11-17)

The first version: a full-screen terminal reader of Claude Code transcripts, on ltms 0.3 (`long-term-memory-structure`
`^0.3.0`, its one runtime dependency).

- Three ways in: no argument (the projects under `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`), a folder of
  project folders (a project's own folder opens as that project), one `.jsonl` transcript. When stdin or stdout is not a
  terminal it reads nothing, exits 2, and names `ltms` as the command for lines. What it refuses before the screen
  opens (a path, `CLAUDE_CONFIG_DIR`, an option) is written with its control characters shown, as on the screen.
- The views: Projects; Sessions (`ltms index`); a session (its turns and compactions); a turn (its prompt, replies, tool
  calls with their error classes from `ltms skeleton`, results, notes); a record (its text a page at a time, or its JSON
  on `j`); Search (`ltms search`, with what was searched and what was not, on one line that a narrow screen cuts); Open
  (`:` and an address, as ltms prints it). Every row but Search's lines of coverage and of more turns starts with its
  address (cut with … on a screen narrower than it); the selected row's is on the last line.
- The keys: ↑ ↓ PgUp PgDn Home End move, Enter or → opens, Esc or ← goes back, `/` searches, `:` opens an address,
  `r` reads Projects or a project's Sessions again (the selection kept on its row), `j` shows a record's JSON, `?` the
  keys, `q` or Ctrl-C quits.
- The screen, with no library: raw mode, keypress events, the alternate screen, the cursor hidden, wrapping at the last
  column off, bracketed paste on (a paste is text, never keys, but for a Ctrl-C character in it, which quits); each
  frame drawn whole, each row erased first, again on a resize; from 20 x 5, the status line (the selected row's address,
  then `? keys` and `q quits` as far as they fit) or a message in its place always the last line drawn; under it, the
  size it needs, wrapped over the lines there are. The terminal is restored on every way out: `q` (exit 0), Ctrl-C and
  SIGINT (130), SIGHUP (129), SIGTERM (143), an uncaught error (1, printed after the restore by its kind and its place,
  not its message). `NO_COLOR` honoured.
- Text: every C0 and C1 control character and DEL shown as a visible escape (ESC as `␛`, the rest as `\xNN`), so a
  transcript's escape sequences (OSC 52 among them) never reach the terminal as such; and what reorders or hides text
  (bidirectional embeddings, overrides and isolates, the byte order mark, the line and paragraph separators, tag
  characters) as `\uXXXX` (past U+FFFF, as the tag characters are, `\u{XXXXX}`), while LRM, RLM and ALM are written as
  they are. Width by grapheme cluster, wide characters and emoji two columns, from a table generated from Unicode's
  `EastAsianWidth.txt` 17.0.0 (its sha256 in the table); lines cut by columns, never inside a cluster, a space where a
  line breaks staying at the end of the line before (UAX #14), so that no line but a paragraph's first begins with one,
  nor, where UAX #14 gives no break before one, with a no-break space or a non-breaking hyphen (the figure space among
  them, and after a Hebrew letter's hyphen-minus, what UAX #14's LB9 folds into the letter or the hyphen passed over,
  LRM, RLM, ALM and ZWNJ among it: LB21a), but where moving the character before it would leave a line empty or the next
  too wide, as in a run of them longer than the line; a message's space at a break hangs, and a message ends with its
  last word. Right to left, one layout for every terminal (measured on Alacritty, Konsole, tmux and VS Code's terminal):
  the reader lays out each line itself, by the Unicode Bidirectional Algorithm (UAX #9, written here from Unicode
  17.0.0's data, generated and pinned as the width table is; a letter's marks kept after it, a mark after a soft hyphen,
  ZWSP or WJ too; a path or a URL laid out as one left-to-right unit; a paragraph wrapped into lines, a record's text
  line or a message, resolved once and each line reordered from its levels, whole, its spaces at either end too), and
  writes a line that holds right-to-left text inside a left-to-right override (LRO after its first grapheme cluster that
  takes a column, never at the line's first column; PDF at its end), so that a terminal that lays text out itself keeps
  that order; `LTMS_READER_BIDI=terminal` writes the text as stored instead, with an RLM at the end of each
  right-to-left paragraph.
- A transcript is read in the reader's own process; one over a tenth of Node's memory limit (its heap's, or the old
  space's where `--max-old-space-size` or `--max-old-space-size-percentage` sets one) is refused with its size and the
  `NODE_OPTIONS` that would let it be read, in the command `npx ltms-reader` with the path given (so too when it was
  started as `ltms-reader`). A record is refused the same way when its view would not fit beside the transcript in
  Node's memory, by its size and by the JSON its view would write (measured by walking the record, before any is
  written: a record nested deep writes JSON hundreds of times its size), and its lines are laid out a page at a time.
  The screen runs in a process of its own: when it ends without restoring the terminal (Node's memory ran out), the
  command restores it, and exits with 128 and the signal's number; an error in the command's own process ends the screen
  by its own way out first, and is printed after the restore (exit 1); when the command's own process is killed, the
  screen's process learns of it, restores the terminal and ends.
- The view layer (`src/view.mjs`, `layout.mjs`, `engine.mjs`, `lines.mjs`, `helper.mjs`) moved here from the LTMS
  Reader extension, with its tests; the extension takes it from this package. Since the move, a prompt whose channel is
  an empty word reads `none`, as `ltms skeleton` prints it (the view layer gave an empty string; found by running the
  views over the core's own test transcripts, `test/fixtures/review/pb-labels.jsonl`); and a turn of more line numbers
  than a call takes arguments (about 31,000 tool calls in one turn, on Node 26) no longer stops its session's view with
  a RangeError; and a text the view layer clips (a prompt, an input, a result, a reply) is cut where a grapheme cluster
  begins, never between a letter and its marks, and its row ends with … when the clip cut its first line.
- Tests: 435 (Node 26.13.1: 435 passing; Node 24.22.3, 22.23.3 and 20.20.2 in docker: 428 passing, 0 failing,
  7 skipped, as their images have no GNU FriBidi and no Electron).

### Known limits

Each was run on 2026-11-17 with a synthetic input, on this release's code before its last fix (of the refusals before
the screen opens, which touches none of them). Most need characters a transcript seldom holds, records nested hundreds
deep, or an old space set small (`--max-old-space-size`, in `NODE_OPTIONS` or on node's command line); the first does
not.

- A line whose first cluster that takes a column is right to left keeps that cluster outside the left-to-right
  override, and a terminal that lays each line out with a left-to-right base would move that cluster to the line's
  other end: the record row of the prompt `שלום עולם ומלואו` is written ו, LRO, the rest, PDF (read back from a
  pseudo-terminal, Node 26.13.1, 80 x 24), and GNU FriBidi 1.0.18 with a left-to-right base (`fribidi --ltr`),
  standing for such a terminal, puts the ו at the right end. Konsole itself was not run (the README's Right to left
  says so too).
- A no-break space that does not fit after a hyphen of UAX #14's class HH (U+2010, U+2013, U+058A, U+05BE) or a
  character of class BA that is not a space (U+0F0B, U+1361, U+2027) takes that character with it to the next line,
  where UAX #14 (LB12a) breaks before the no-break space: 'ab', U+2013, U+00A0, 'x' at 3 columns is cut into 'ab' and
  U+2013 U+00A0 'x', where ICU 78.3's line breaker (Unicode 17.0) breaks at 0, 3 and 5; so for each of the seven, in a
  record's text and in a message (Node 26.13.1).
- After ZWSP or WJ before a no-break space, the line is cut before the ZWSP or WJ: 'אב-', U+200B, U+00A0, 'x' at 3
  columns is cut into 'אב-' and U+200B U+00A0 'x', where ICU 78.3 breaks only after the ZWSP (0, 4, 6); with U+2060,
  around which ICU gives no break (0, 6), the next line begins with the WJ and the no-break space; so too after a Latin
  letter's hyphen and after a space (Node 26.13.1).
- After a space of class BA that hangs at a break (U+3000), what UAX #14's LB9 folds into that space (ALM, LRM, RLM)
  begins the next line, before a no-break space: 'ab', U+3000, U+061C, U+00A0, 'x' at 3 columns is cut into 'ab' and
  U+061C U+00A0 'x', where ICU 78.3 breaks after the U+061C (0, 4, 6); with ZWNJ, which joins the space's grapheme
  cluster, the next line begins with the U+3000 itself (Node 26.13.1).
- Of UAX #14's class GL (41 code points in ICU 78.3) the reader keeps four with the character before them (U+00A0,
  U+2007, U+202F, U+2011); the class's Tibetan marks that take a column (U+0F08, U+0F0C, U+0F12, U+0FD9, U+0FDA) begin a
  line where UAX #14 gives no break: 'abc', U+0F08, 'def' at 3 columns is cut into 'abc', U+0F08 'de' and 'f', where
  ICU 78.3 gives no break in it (Node 26.13.1).
- In a line whose first cluster that takes a column is a letter followed by WJ and a mark, which the reader keeps with
  the letter, the LRO is written between the letter and the WJ: 'שלום', U+2060, U+05B7 in a cell is written U+05DD,
  U+202D, U+2060, U+05B7, the rest, U+202C (Node 26.13.1). Whether a terminal then draws the mark on the letter's cell
  was not measured.
- Under an old space set by `NODE_OPTIONS` or a flag, the Sessions list (`ltms index`, which the reader runs without
  its `NODE_OPTIONS`) lists transcripts the reader then refuses: with `NODE_OPTIONS=--max-old-space-size=16` on Node
  26.13.1, a project's transcript of 4,001,388 bytes was listed and, opened, refused ("it is 4 MB, and this process
  reads a transcript of up to 1 MB"); on Node 24.22.3 under `--max-old-space-size=16` the list read one of 10,001,388
  bytes, which `ltms index` under that flag does not survive.
- A transcript whose parse takes more than the 8 times its size the size rules allow for can be admitted and run Node's
  memory out, and so can a record of it that the record rule shows: under `--max-old-space-size=64`, where the
  transcript rule admits up to 6,710,886 bytes, a tool result of empty objects (3 bytes an object) of 1,000,000 objects
  (3,001,951 bytes) ended the screen's process by SIGABRT as the transcript was read, and one of 700,000 (2,101,951
  bytes) when its record was opened, on Node 26.13.1, 24.22.3 and 20.20.2 (400,000 objects: shown).
- A record of tabs that the record rule shows can run Node's memory out when it is opened: under
  `--max-old-space-size=64`, a tool result of 1,100,000 tabs (a line of 2,200,433 bytes) ended the screen's process by
  SIGABRT when its record was opened, on Node 26.13.1, 24.22.3 and 20.20.2 (600,000 tabs: shown); run as the command in
  a pseudo-terminal on Node 26, it restored the terminal, said Node's heap ran out, named
  `NODE_OPTIONS=--max-old-space-size=512`, and exited 134.
- The record rule is one rule for every Node line, writing a record's JSON taken to need 1.5 times its size (Node 20's
  measure), so that on Node 22 to 26 a record nested deep is refused at old spaces where it would open: a list nested
  200 deep of 1,000,000 ones (a file of 2,002,359 bytes, 613,124,378 bytes of JSON) is refused at `--max-old-space-size`
  600 to 1004 (as tried) and shown at 1005, and with the size rules set aside it opened as JSON at 640 on Node 26.13.1
  (at 600 Node's heap ran out).
- On Node 20 the old space a deep record's JSON view needs is not the same from run to run: with the size rules set
  aside, a list nested 600 deep of 60,000 four-letter Hebrew strings (663,159 bytes, 220,943,956 bytes of JSON) opened
  at `--max-old-space-size=240` once and ran out at 240 once, ran out at 242 (twice), 246 and 252, and opened at 300
  (Node 20.20.2). The record rule refuses it at 240 to 360 and shows it at 400, where it opened on Node 20.
- ltms's own commands (`long-term-memory-structure` 0.3.1, the dependency) read a file of up to a tenth of Node's heap
  limit, not of the old space set: `ltms index` under `--max-old-space-size=16` on Node 24.22.3 read a 4 MB transcript,
  ended by SIGABRT on 10 and 18 MB ones ("Reached heap limit"), and skipped one of 22 MB. The reader's own lists, under
  the same flag, read the 10 MB one.
- `src/helper.mjs`, the reading process the LTMS Reader extension takes from this package, reads a transcript of up to a
  tenth of Node's heap limit, not of the old space set: under `--max-old-space-size=16` on Node 24.22.3 it gave its
  limit as 21,810,380 bytes, and a transcript of 10,001,388 bytes ended it by SIGABRT ("Reached heap limit"), where the
  reader refuses it. Not run under the extension's own runtime.
- The rest are in the README's Limits, each run again on this code: the transcript rule (a tenth of Node's memory limit:
  under `--max-old-space-size=16` on Node 26.13.1, transcripts of 2 to 10 MB were refused that opened with the rule set
  aside), the first frame of a long right-to-left paragraph (158 to 188 ms on Node 26.13.1 for one of 200,000 paths),
  and the rows wider than a narrow screen (at 25 columns: the loading line, 38 columns, and the search line, 26).
