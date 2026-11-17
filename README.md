# ltms-reader

A full-screen reader of your own Claude Code sessions, in the terminal: the projects, a project's sessions, a
session's turns, a turn's prompt, replies and tool calls, and the text behind every address. Read-only, local, no
network. It is built on [ltms](https://github.com/long-term-memory-structure/long-term-memory-structure)
(`long-term-memory-structure`), its one dependency: the lists it draws are the lines `ltms index`, `ltms search` and
`ltms skeleton` print, so an address on its screen is one an agent can be given as it is.

## Run it

Node.js 20 or newer, and a terminal.

```sh
npx ltms-reader                      # the projects under ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects)
npx ltms-reader <projects folder>    # another folder of project folders
npx ltms-reader <file.jsonl>         # one transcript
```

A project's own folder (one of those under `~/.claude/projects`) given where its parent was meant opens as that
project. Or install it once: `npm install -g ltms-reader`, which gives the command `ltms-reader`.

It runs on a terminal only: when stdin or stdout is not one (a pipe, a file), it reads nothing and says so. For lines to
read, to pipe or to give an agent, `ltms` is the command (`npx long-term-memory-structure index|search|skeleton ...`;
installing `ltms-reader` does not put `ltms` on the PATH, `npm install -g long-term-memory-structure` does).

## What it shows

| view | its rows | from |
|---|---|---|
| Projects | each project folder, with the count of transcripts `ltms index` reads in it, newest first | ltms's walk of the folder |
| Sessions | one per session, newest first: when it started, its turns, calls, failed calls, compactions, agents | `ltms index` |
| A session | its turns: the channel, the prompt's first line, calls, failed calls; each compaction a row of its own, with its summary's address | the library, as `ltms skeleton` |
| A turn | its prompt, replies, tool calls (ok, or failed and the error class `ltms skeleton` gives), results, the harness's own notes, each with its address | the library, as `ltms skeleton` |
| A record | its text, a page at a time, part by part (text, thinking, a tool call's input, a result); its address, kind, time, length and place in the file; `j` shows it as JSON | the transcript's line |
| Search | a query, then the matching turns by session, with what was searched and what was not; Enter opens the turn at its first match | `ltms search` |
| Open | `:` and an address, as ltms prints it: `<prefix>:L<line>` opens that record (above the turn that holds it), `<prefix>:T<turn>` that turn | the address rule |

A row's address is always on screen, at the start of the row, and the selected row's on the last line: a session's
prefix (the first 8 characters of its file's name; `agent-` and 8 for an agent's), a turn's id (`1a2b3c4d:T003`), a
record's line (`1a2b3c4d:L120`). Search covers the project on screen, or every project from Projects. An agent's
transcript is opened by its address, or from a search.

It draws from 20 columns and 5 rows. The last line is always the status line (the selected row's address, `? keys`,
`q quits`), or a message in its place: on a screen too low for every line, the line of details above it gives way
first, then a list's column headings. Under 20 x 5 it says the size it needs, wrapped over the lines it has (on a
screen too small for all of it, its first lines), and `q` still quits.

## Keys

| key | does |
|---|---|
| ↑ ↓ | move one row (in a record, one line) |
| PgUp PgDn | move one page |
| Home End | the first row, the last |
| Enter or → | open the row |
| Esc or ← | go back |
| `/` | search: type the words, Enter runs `ltms search` |
| `:` | open an address |
| `r` | in Projects and in a project's Sessions: read the list again, the selection kept on the same row while it is there |
| `j` | in a record: its JSON, and back |
| `?` | the keys |
| `q` or Ctrl-C | quit |

While a line is typed: Backspace, Ctrl-U to clear it, Enter, Esc to leave it. A paste is text (the reader turns on
the terminal's bracketed paste): pasted into a line, its new lines become spaces and do not run it; elsewhere, nothing
pasted acts as a key.

## Your transcripts, and who sees them

- **It shows their text**, prompts, replies, tool inputs and outputs included, to you, on this terminal's alternate
  screen. Nothing it shows is written to stdout, a pipe or a log, and nothing stays on the screen when it quits. (ltms
  itself prints no content of a transcript; this reader is for the person whose transcripts they are.)
- **It writes no file and uses no network.** It reads the transcripts under the folder it is given, and runs ltms's
  commands (`index`, `search`, `skeleton`) as local processes, which read the same files and write only to the reader.
  Run through `npx`, npm writes files of its own: a log of each run under `~/.npm/_logs`, which names the folder or file
  given, and a compile cache under `$TMPDIR`; installed (`npm install -g ltms-reader`, then `ltms-reader`), it runs
  without npm, and without them.
- An error inside it, in the screen's process or in the command's own, is printed after the terminal is restored, by
  its kind and where in this package it happened, not by its message, which could quote a transcript.

## Text on the screen

- **Control characters are shown, never sent.** A transcript can hold escape sequences (colours, cursor moves, a
  window's title, OSC 52, which writes the clipboard). Every C0 and C1 control character and DEL is shown as a visible
  escape: ESC as `␛`, the others as `\x07`, `\x9b` and so on; tabs become spaces and new lines become lines. Nothing a
  transcript holds can move the cursor, set the title, write the clipboard or leave the terminal in another mode.
- **So is what reorders or hides text:** the bidirectional embeddings, overrides and isolates (U+202A to U+202E, U+2066
  to U+2069), the byte order mark (U+FEFF), the line and paragraph separators (U+2028, U+2029) and the tag characters
  (U+E0000 to U+E007F), as `\u202e`, `\u{e0041}` and so on: an override in a transcript cannot reorder the rest of its
  row. The light marks Hebrew and Arabic text use (U+200E, U+200F, U+061C) are written as they are.
- **Width by grapheme cluster** (`Intl.Segmenter`): combining marks, niqqud and cantillation take no column of their
  own; East Asian wide characters and emoji take two. A line is cut by columns, never inside a cluster, and a space
  where it is cut stays at the end of the line before; a no-break space or a non-breaking hyphen (U+00A0, U+202F,
  U+2011: UAX #14's class GL) where it would be cut goes to the next line with the character before it, as UAX #14 gives
  no break before one but after a space or a hyphen (where that would leave the line before empty, or the next too
  wide, as on a line of one column, it begins the line all the same). The wide characters come from a table generated
  from Unicode's `EastAsianWidth.txt`, version 17.0.0 (`src/width-table.mjs`, which names the file's sha256;
  `scripts/width-table.mjs` writes it). Characters of ambiguous width take one column.
- **Right to left** (Hebrew, Arabic): one layout for every terminal. The reader lays out each line itself (mode
  `reader`, the default), by the Unicode Bidirectional Algorithm (UAX #9, Unicode 17.0.0, written in this package: the
  implicit algorithm with paired brackets, its lines reordered and mirrored, a paragraph's direction from its first
  strong character), and writes it in visual order. A line that holds right-to-left text (a character of UAX #9's class
  R, AL or AN) is written inside a left-to-right override, U+202D (LRO) right after its first grapheme cluster and
  U+202C (PDF) at its end, so that a terminal that lays bidirectional text out itself keeps the reader's order instead
  of reordering it a second time; nothing else is written (no isolate), and a line without right-to-left text is
  written as it is. No terminal is detected.
  - Measured on four terminals (S378): Alacritty 0.17.0, Konsole 26.08.3, tmux 3.6 and VS Code 1.146.0's terminal
    (xterm.js 6.1.0-beta.304). There, after a line's first column, LRO and PDF take no column. Konsole lays text out
    itself, with a left-to-right base for each line, and applies the override from a line's second column on; at the
    first column an LRO is not applied by Konsole, dropped by tmux and given a column of its own by xterm.js (hence
    after the first cluster), and xterm.js gives an isolate (LRI, RLI, PDI) a column anywhere. Alacritty and xterm.js
    draw the text in the order it is written; tmux passes it on. No other terminal was measured (kitty, VTE's, as in
    GNOME Terminal, mlterm, WezTerm, foot, iTerm2, Windows Terminal, GNU screen and the rest are not): one that gives
    LRO or PDF a column shifts such a line by it. Not measured either: how Konsole joins Arabic letters that come to it
    in visual order under the override; and a line whose first cluster is itself right to left, which the override
    leaves out (laid out by UAX #9 with a left-to-right base, as Konsole lays a line out, that cluster would go to the
    line's other end).
  - `LTMS_READER_BIDI=terminal` writes the text as stored instead (mode `terminal`), with a right-to-left mark (RLM) at
    the end of each right-to-left paragraph, for a terminal that lays bidirectional text out itself (on Konsole the RLM
    puts the paragraph's end punctuation where it belongs, though its brackets are not mirrored); `LTMS_READER_BIDI=reader`
    is the default; a value it does not take is refused. Konsole is not detected: it gets the reader's layout, as
    every terminal does, over ssh too, where `KONSOLE_VERSION` does not reach the reader.

  A paragraph is a cell of a list, the reader's own words before a transcript's text being a paragraph of their own, or
  a text wrapped into lines: a line of a record's text (its lines share its direction), a message, an error. A wrapped
  paragraph's levels are resolved once, and each of its lines is reordered from them, as UAX #9 lays out a paragraph
  broken into lines (its section 3.4): a line reads as its words do in the whole paragraph, the comma that ends a line
  where the sentence has it. Each such line is laid out whole, its spaces at either end with the rest: a space that
  ends a line takes the paragraph's direction (L1), so that in a right-to-left paragraph it is drawn at the line's
  left. A record's text is cut into lines by columns: the whitespace where a line breaks stays at the end of the line
  before, as UAX #14 has it, drawn there where the line has room for it, and past the screen's edge, not drawn, where
  it does not. A message is broken at its spaces, and the space where a line breaks hangs, as UAX #14 has the
  whitespace at a break: it is in no line, and is not drawn, though the line has room for it; whitespace that ends a
  message after a break hangs too, and makes no line of its own. Either way no line but a paragraph's first begins with
  whitespace. A long line of a list is cut in logical order, its beginning kept, then laid out by itself, the spaces at
  its ends (a cell's padding) where they are.
  A path or a URL in a line (`/home/...`, `~/...`, `src/...`, `https://...`) is laid out as one left-to-right unit, its
  parts in order and a Hebrew name in it reading right (UAX #9's higher-level protocol HL4), in pieces where a line
  breaks inside it, as an isolate is. Each cluster is kept whole, its marks after its letter, as a terminal draws them;
  the text is aligned left, so the columns stay. Checked against Unicode's conformance test (BidiCharacterTest.txt:
  every case without an explicit formatting character, which the reader shows as an escape and never applies) and
  against GNU FriBidi: its command for a line, its library for a paragraph wrapped into lines.
- Colour follows [NO_COLOR](https://no-color.org): set, there is none; the selected row is still drawn in reverse.

## Limits

- A transcript is read into memory whole, in the reader's own process. One over a tenth of Node's memory limit is
  refused with its size and the `NODE_OPTIONS=--max-old-space-size=...` that would let it be read (the rule ltms's
  commands follow, so the lists and the reader agree on which files can be read); one over 480 MB cannot be read at all.
  Node's memory limit is its heap's, or, where `--max-old-space-size` or `--max-old-space-size-percentage` sets the old
  space (in `NODE_OPTIONS` or on node's command line), the old space's: a transcript's parse is kept there, and the
  heap's limit holds beside it a reserve for new objects that is sized from the machine's memory, not from the old space
  (with `--max-old-space-size=16`, measured: a heap limit of 64 MB on Node 20 and 22, 208 MB on Node 24, 112 MB on Node
  26). By the heap's limit, under an old space of 16 MB, Node 24 read a transcript of 12 MB and ran out of memory.
- A record is shown when its view (up to 16 times the record's size) fits beside the transcript's (up to 8 times the
  file's) in nine tenths of Node's memory limit, and so does the JSON the view writes of it, with 96 MB beside it: JSON
  is indented once more at each level a value is nested in, so that a record nested deep writes JSON hundreds of times
  its size (a list nested 990 deep, on a line of 0.8 MB: 381 MB). That JSON is measured by walking the record, before
  any of it is written. A record that does not fit is refused before it is drawn, with its size and the `NODE_OPTIONS`
  that would show it. Its lines are laid out a page at a time.
- The screen runs in a process of its own, which the command waits for. If that process ends without restoring the
  terminal (Node's memory running out aborts it), the command restores it, then prints what Node said and what happened.
  An error in the command's own process (a module loaded through `NODE_OPTIONS` or `--import` that throws, say) ends the
  screen by its own way out (SIGTERM; if it has not ended within 2 s, SIGKILL, and the command restores the terminal),
  then is printed after the restore, and the command exits with 1. If the command's own process is killed (SIGKILL),
  the screen's process learns of it (an IPC channel between the two closes), restores the terminal and ends; if both
  are killed at once (a whole cgroup, as systemd-oomd does), nothing is left to restore it.
- Under an interactive shell with job control, that shell takes the terminal back as soon as the command's process is
  killed, racing the screen's process. The screen's process then writes the leave sequence and leaves the terminal's
  modes to the shell (it puts back the modes it started with only where they are still the screen's raw ones, as
  under a shell that sets none).
  Measured on 2026-11-16 with round 3's check's probe, `shellkill.py`, and its stand-in for a job-control shell that
  sets no modes, `standin.py`: a pseudo-terminal of 80 x 24, the shell at its prompt, the reader started from it,
  SIGKILL to the command's process once its frame is up; 10 runs for each of bash 5.3.20, zsh 5.9.2 (`-f`, and `-f`
  with `ttyctl -f` typed first), fish 4.9.3 and the stand-in. The modes 1.5 s after were the shell's own, as at its
  prompt, 10 of 10 for bash, zsh with `ttyctl -f`, fish and the stand-in; a line typed then came back once, 10 of 10,
  for bash, both zsh and the stand-in. What stays: bash, both zsh and the stand-in wrote their prompt before the leave
  sequence, 10 of 10 each (fish 0 of 10), on the alternate screen, where it is not seen (bash 4.0 to 4.9 ms after the
  kill, zsh 4.1 to 9.2, zsh with `ttyctl -f` 3.9 to 5.1, the stand-in 3.7 to 5.1): the shell waits at it, and the next
  line given to it brings a prompt back. And zsh without `ttyctl -f` took the modes the killed command left as its own
  (10 of 10: its iflag and lflag not those at its prompt), so that the commands it ran next had the keyboard's signals
  (Ctrl-C) and flow control off, `-isig -ixon`, 10 of 10; with `ttyctl -f` (in `.zshrc`) they had them on, 10 of 10.
- A list of sessions waits for `ltms index` to read every transcript of the project (on one machine, 39 s for a project
  of 385 sessions), and a search for `ltms search`; the screen says what is being read and for how long. A list that
  took 3 s or more is kept: opened again after its files changed, it is shown as it was read, and says when that was
  and how many files changed since; `r` reads it again (as it reads Projects again), and so does `ltms-reader` started
  again.
- Some clusters are drawn wider by some terminals than by the cluster rule (an Indic conjunct, an emoji sequence a
  terminal does not join); a row then ends early, at the screen's edge.
- A paragraph's levels are resolved once, when a line of it is first drawn, and kept for the last two drawn of 4,096
  characters or more. For R's record (one paragraph of 4,000,000 Hebrew characters), measured on 2026-11-16 on one
  machine, its first frame took 150 to 239 ms on Node 26.13.1 (11 runs), where it took 12 to 23 ms before (11 runs);
  the levels alone 137 to 147 ms (6 runs), and 143 to 145 on Node 20.20.2 (2 runs); the frames after it as before (a
  page at 200 x 60: 9.4 to 14.4 ms in 7 runs, 10.4 to 14.2 before). A line finds the paths in it by a binary search of
  its paragraph's: in a right-to-left paragraph of 200,000 paths (3,200,004 characters), measured on 2026-11-17 (2 runs
  each), the first frame took 163 to 171 ms (21 to 22 when each line was laid out by itself), and a page at its start,
  its middle and its end 5.8 to 6.4 ms at 200 x 60 (13.6 to 16.5 before), 1.1 to 1.7 at 80 x 24 (2.1 to 2.8 before).
- On Node 20, a long line of text that is not ASCII is laid out about three times slower than on Node 26: Node 20's
  grapheme segmenter is slower, and walked over one long string it costs more at each cluster the longer the string is
  (3.4 us a cluster at 10,000 units, 115 at 80,000), so the reader walks a long line 256 units at a time. Measured on
  R's record of 4,000,000 Hebrew characters at 80 columns: its lines counted in 6.7 s on Node 20.20.2, against 2.0 s on
  Node 26.13.1 (an ASCII record of the same size: 57 and 61 ms).

Exit status: 0 after `q`; 130 after Ctrl-C or SIGINT; 129 after SIGHUP; 143 after SIGTERM; 1 after an internal error;
2 when it is refused before the screen opens (not a terminal, a usage error, a path that is not a folder or a `.jsonl`);
128 and a signal's number when a signal the screen cannot handle ended its process (134, SIGABRT, when Node's memory ran
out), the terminal restored all the same.

## Development

```sh
npm install
npm test
```

`npm test` runs `node --test test/*.test.mjs`, the pattern expanded by the shell, which runs the test files on Node 20,
22, 24 and 26 alike. Given the folder `test/` instead, Node 20 runs every module under it as a test, the fixtures too,
and Node 22 and 24 run none: they take the folder for a module, and fail.
The tests run every view at 80 x 24 and 200 x 60 over ltms's own synthetic transcripts (`test/fixtures/ltms`) and the
reader's (`test/fixtures/hebrew-english.jsonl`, `escapes.jsonl` and `channels.jsonl`, written by
`node test/fixtures/make-fixtures.mjs`), compare what each row says with ltms's own commands, read every byte the
reader writes for a transcript full of escape sequences, and run it end to end in a pseudo-terminal (`script`, on
Linux). `LTMS_READER_FIXTURES=<folder>` adds every `.jsonl` under a folder to the views' test (the core's own
`test/fixtures`, say). The width table's regeneration is checked when `LTMS_READER_EAW` names the pinned
`EastAsianWidth.txt`; the bidirectional table's regeneration, and Unicode's conformance test of the algorithm
(`test/bidi.test.mjs`, which reports how many cases passed and failed), when `LTMS_READER_UCD` names a folder holding
the pinned files (`scripts/bidi-table.mjs` names each with its sha256); GNU FriBidi's layout of the right-to-left page
and fixtures is compared with the reader's where `fribidi` is on the PATH (or `LTMS_READER_FRIBIDI` names it); and each
line of paragraphs wrapped into lines (the fixtures', and random ones) with its library's, where `python3` can load
`libfribidi` (`test/fribidi-lines.py`; `LTMS_READER_LIBFRIBIDI` names the library, `LTMS_READER_PYTHON` the Python).
GNU FriBidi 1.0.18 lays some paragraphs out otherwise than UAX #9 (brackets next to a nonspacing mark): a line on which
the reader and FriBidi's library differ is laid out by the tests' own reference of UAX #9 too (`test/uba-reference.mjs`,
checked on `BidiCharacterTest.txt`, every case, and on `BidiTest.txt` when the folder holds it), and counts as
FriBidi's difference, said and not failed, where FriBidi differs from the reference and the reader does not:

```sh
curl -sS --fail -o EastAsianWidth.txt https://www.unicode.org/Public/17.0.0/ucd/EastAsianWidth.txt
mkdir ucd && for f in extracted/DerivedBidiClass.txt UnicodeData.txt BidiBrackets.txt BidiMirroring.txt BidiCharacterTest.txt BidiTest.txt; do
  curl -sS --fail -o "ucd/${f##*/}" "https://www.unicode.org/Public/17.0.0/ucd/$f"; done
LTMS_READER_EAW=EastAsianWidth.txt LTMS_READER_UCD=ucd npm test
```

`src/view.mjs`, `src/layout.mjs`, `src/engine.mjs`, `src/lines.mjs` and `src/helper.mjs` are the view layer the LTMS
Reader extension for VS Code shares: it takes them from this package.

## License

MIT (`LICENSE`). `src/width-table.mjs` and `src/bidi-table.mjs` are derived from the Unicode Character Database, version
17.0.0 (`EastAsianWidth.txt`; `DerivedBidiClass.txt`, `UnicodeData.txt`, `BidiBrackets.txt` and `BidiMirroring.txt`;
© 2025 Unicode, Inc.), under the Unicode License v3: its copyright and permission notice is in `LICENSE-UNICODE`, which
the package ships, and at the head of each table.
