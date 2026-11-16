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
read, to pipe or to give an agent, `ltms` is the command (`npx long-term-memory-structure index|search|skeleton ...`).

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
- An error inside it is printed after the terminal is restored, by its kind and where in this package it happened, not
  by its message, which could quote a transcript.

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
  own; East Asian wide characters and emoji take two. A line is cut by columns, never inside a cluster. The wide
  characters come from a table generated from Unicode's `EastAsianWidth.txt`, version 17.0.0 (`src/width-table.mjs`,
  which names the file's sha256; `scripts/width-table.mjs` writes it). Characters of ambiguous width take one column.
- **Right to left:** the text is written in the order it is stored, and the terminal lays it out. Terminals differ:
  Konsole lays out bidirectional text itself; Alacritty, kitty and VS Code's terminal show the stored order. Whether
  the reader should lay out each line itself (the Unicode Bidirectional Algorithm) for terminals that do not is being
  measured; until then, this is the one mode.
- Colour follows [NO_COLOR](https://no-color.org): set, there is none; the selected row is still drawn in reverse.

## Limits

- A transcript is read into memory whole, in the reader's own process. One over a tenth of Node's memory limit is
  refused with its size and the `NODE_OPTIONS=--max-old-space-size=...` that would let it be read (the rule ltms's
  commands follow, so the lists and the reader agree on which files can be read); one over 480 MB cannot be read at all.
- A record is shown when its view (up to 16 times the record's size) fits beside the transcript's (up to 8 times the
  file's) in nine tenths of Node's memory limit; a larger one is refused before it is drawn, with its size and the
  `NODE_OPTIONS` that would show it. Its lines are laid out a page at a time.
- The screen runs in a process of its own, which the command waits for. If that process ends without restoring the
  terminal (Node's memory running out aborts it), the command restores it, then prints what Node said and what happened.
- A list of sessions waits for `ltms index` to read every transcript of the project (on one machine, 39 s for a project
  of 385 sessions), and a search for `ltms search`; the screen says what is being read and for how long. A list that
  took 3 s or more is kept: opened again after its files changed, it is shown as it was read, and says when that was
  and how many files changed since; it is read again when `ltms-reader` starts again.
- Some clusters are drawn wider by some terminals than by the cluster rule (an Indic conjunct, an emoji sequence a
  terminal does not join); a row then ends early, at the screen's edge.

Exit status: 0 after `q`; 130 after Ctrl-C or SIGINT; 129 after SIGHUP; 143 after SIGTERM; 1 after an internal error;
2 when it is refused before the screen opens (not a terminal, a usage error, a path that is not a folder or a `.jsonl`);
128 and a signal's number when a signal the screen cannot handle ended its process (134, SIGABRT, when Node's memory ran
out), the terminal restored all the same.

## Development

```sh
npm install
npm test
```

The tests run every view at 80 x 24 and 200 x 60 over ltms's own synthetic transcripts (`test/fixtures/ltms`) and the
reader's (`test/fixtures/hebrew-english.jsonl`, `escapes.jsonl` and `channels.jsonl`, written by
`node test/fixtures/make-fixtures.mjs`), compare what each row says with ltms's own commands, read every byte the
reader writes for a transcript full of escape sequences, and run it end to end in a pseudo-terminal (`script`, on
Linux). `LTMS_READER_FIXTURES=<folder>` adds every `.jsonl` under a folder to the views' test (the core's own
`test/fixtures`, say). The table's regeneration is checked when `LTMS_READER_EAW` names the pinned `EastAsianWidth.txt`:

```sh
curl -sS --fail -o EastAsianWidth.txt https://www.unicode.org/Public/17.0.0/ucd/EastAsianWidth.txt
LTMS_READER_EAW=EastAsianWidth.txt npm test
```

`src/view.mjs`, `src/layout.mjs`, `src/engine.mjs`, `src/lines.mjs` and `src/helper.mjs` are the view layer the LTMS
Reader extension for VS Code shares: it takes them from this package.

## License

MIT (`LICENSE`). `src/width-table.mjs` is derived from the Unicode Character Database (`EastAsianWidth.txt` 17.0.0,
© 2025 Unicode, Inc.); for its terms, see <https://www.unicode.org/terms_of_use.html> and
<https://www.unicode.org/license.txt>.
