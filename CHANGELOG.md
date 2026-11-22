# Changelog

## 0.1.1 (not yet released)

- **Right to left on Konsole.** A line laid out by the reader that holds right-to-left text is now written with a
  left-to-right mark (U+200E, LRM) between its first grapheme cluster that takes a column and the LRO: that cluster,
  LRM, LRO, the rest, PDF. Konsole, at its default bidi settings, lays each line out with a left-to-right base, and drew
  a first cluster that is right to left, which stands outside the override, at the line's other end: 0.1.0's first Known
  limit, measured on 2026-11-20 in Konsole 26.08.3 (Liberation Mono 11) with 0.1.0 itself, whose record row of the
  prompt `שלום עולם ומלואו` showed its vav at the row's right end (in windows of 379 x 78, by 0.1.0's own frames, where
  their launch had asked for 80 x 24), and with the same bytes on a page, read from its pixels (a capture the size of
  the 210 x 59 windows the fix was run in that night): the vav at column 15 of 16, and a final nun at column 13 of 14 in
  a twin row. With the mark, the same page kept both at column 0. In the tests, GNU FriBidi 1.0.18 with a
  left-to-right base (`fribidi --ltr`), standing for such a terminal, keeps the reader's order on such rows, a pointed
  first cluster and an Arabic one among them; on 0.1.0's rows it moves a first cluster that is right to left to the
  row's other end. Measured again on 2026-11-21 with the reader itself, 0.1.1 against 0.1.0, on two transcripts, one of
  the prompt above and one of its twin, `שלום עולם ואבן`, each run with the same keys (Enter, Enter, q): the two
  versions' outputs differ only by the marks, each right before an LRO. Konsole 26.08.3 (its default bidi settings) drew
  the first letter at column 0, where 0.1.0's was at the row's right end, and so it did on 2026-11-22 with tmux 3.6
  inside it (tmux's status line off: the same pixels as without tmux); Alacritty 0.17.0 drew the same
  pixels for both; tmux 3.6, and the xterm.js of VS Code 1.146.0 and 1.147.0 (run in a headless browser, not in VS Code;
  with xterm.js's own Unicode 6 widths and with Unicode 11's), hold the mark in the first letter's cell; in all four the
  mark took no column. The first letters measured were two Hebrew letters without points, a vav and a final nun: a
  pointed first cluster or an Arabic one, and Konsole's other bidi settings, were not measured on a terminal. Konsole's
  own library names the setting ("force LTR line direction"; unchecked, a line takes its base from its first strong
  character), and with it unchecked the ICU that Konsole lays lines out with, and GNU FriBidi, lay 0.1.1's row out as
  they do 0.1.0's, a first cluster that is right to left at the line's other end (predicted, not run on Konsole).
- **Corrections to 0.1.0's notes.** Its entry below is as it was released; where it said more than holds (found
  2026-11-21 and 22), what it said, what holds, and where that was measured or read:
  - The terminals: "measured on Alacritty, Konsole, tmux and VS Code's terminal"; it was Alacritty 0.17.0, Konsole
    26.08.3, tmux 3.6 and the xterm.js of VS Code 1.146.0's terminal, run in a headless browser (2026-11-16, below).
  - The base: "a terminal that lays text out itself keeps that order"; one that lays each line out with a left-to-right
    base (Konsole, at its default settings) does, but for a first cluster that is right to left, its first Known limit
    (Konsole, above).
  - A path: "a path or a URL laid out as one left-to-right unit"; one that begins a line or follows a space, an opening
    bracket or quote, `=` or a hyphen, up to the next space; not right after Markdown's opening backtick or `**`, nor
    right after a colon or a comma (one that follows a space inside backticks or bold is one: a Known limit below); a
    path with a space is two (read in `pathUnits`, `src/text.mjs`, and run on it, 2026-11-22).
  - A paste: "text, never keys, but for a Ctrl-C character in it, which quits"; not right after an ESC, read with it as
    one key, and what follows an ESC [201~ in it acts as keys (2026-11-22, below).
  - Mode `terminal`: "an RLM at the end of each right-to-left paragraph"; at the end of each line of a right-to-left
    paragraph, before the whitespace that ends it (read in `displayOrder`, `src/text.mjs`, and its bytes, 2026-11-22).
  - The docker skips: "as their images have no GNU FriBidi and no Electron"; and no python3, which the five tests of
    FriBidi's library run (the three images' contents, read on 2026-11-22).
  - The first Known limit: "Konsole itself was not run (the README's Right to left says so too)"; that README is
    0.1.0's; Konsole has been run since (above).
- **Measured on terminals**, none of it a change of the code (each where it was run; none was run in VS Code's own
  window, and no terminal but those named was run):
  - On 2026-11-16, for 0.1.0, on Alacritty 0.17.0, Konsole 26.08.3, tmux 3.6 (in docker) and the xterm.js of VS Code
    1.146.0 (6.1.0-beta.304, in headless Chromium, with its own Unicode 6 widths), the four 0.1.0's notes name: LRO,
    PDF, LRM and RLM after a character took no column in any; at a line's first column an LRO was not applied by
    Konsole, dropped by tmux and given a column of its own by xterm.js; Konsole applied an override from a line's second
    column on; xterm.js gave an isolate a column anywhere; Alacritty and xterm.js drew text in the order it was written
    (for xterm.js's DOM renderer, see below).
  - xterm.js gives a zero-width control that follows an escape sequence a cell of its own, which moves what follows it
    one column: the PDF, an LRM, an LRO, an isolate; right after a character an LRM, an LRO or a PDF takes none
    (2026-11-22: xterm.js 6.1.0-beta.304, VS Code 1.146.0's, and beta.337, 1.147.0's, in headless Chromium 158, with
    xterm.js's own Unicode 6 widths and with Unicode 11's; `@xterm/headless` 6.1.0-beta.335, 1.147.0's, in Node). The
    reader writes its LRM and LRO right after a character, inside the style of a first cluster that ends a styled
    segment (a test pins it now); its PDF follows the ESC [0m of a row whose last segment is styled, and takes a cell
    after the row's text, so that no text moves, or, on the selected row, as wide as the screen, is written past the
    last column. tmux 3.6 (in docker) gave none of the three a column after an escape sequence; Konsole and Alacritty
    were not run so.
  - An isolate (LRI, RLI, FSI, PDI), which the reader does not write, takes no column after a character with Unicode
    11's widths, VS Code's default (`terminal.integrated.unicodeVersion`, read in 1.147.0's code), and one at a row's
    first column or after an escape sequence; with xterm.js's own Unicode 6 widths, one anywhere, as on 2026-11-16
    (2026-11-22, the same builds).
  - xterm.js's DOM renderer puts a run of cells of one style whose glyphs need the same spacing into one span, which the
    browser lays out itself, by UAX #9, a span a paragraph (read in its code, beta.304 and beta.337); its WebGL renderer
    draws each cell where it was written. VS Code 1.147.0 loads the WebGL renderer at its default
    (`terminal.integrated.gpuAcceleration` "auto"), and the DOM renderer with it "off" or where WebGL fails to load
    (read in its code). Measured on 2026-11-22 in headless Chromium 158, beta.304 and beta.337 alike, on the record rows
    of the 2026-11-21 measurement (the prompt above and its twin, 0.1.0's bytes and 0.1.1's), in the DOM renderer: with
    the font `monospace` (its Hebrew from a proportional font), a span for each letter, both versions in order; with
    Liberation Mono or Courier New (the Hebrew in the same font), one span for the row: 0.1.0 drew 14 of 14 and 12 of 12
    letters elsewhere, its first letter at the row's other end, and 0.1.1 drew both rows in order; with Noto Sans Mono
    and the Hebrew from Courier New, a span for each word: 0.1.0 drew 14 of 14 and 12 of 12 elsewhere, 0.1.1 8 of 14 and
    8 of 12, its words after the first reversed in place (a Known limit below). The WebGL renderer (beta.304) drew both
    versions' rows alike, each letter in the cell it was written to, with all four.
  - tmux 3.6 keeps a mark in the cell of the character before it, and redraws that cell to the terminal outside it: the
    record row, 0.1.0's and 0.1.1's, through tmux into xterm.js beta.337 came out cell for cell as without tmux, live
    and replayed, with Unicode 6's widths and 11's (2026-11-21, headless Chromium); with Konsole 26.08.3 outside, the
    same pixels as without tmux (above).
  - At the screen's edge, wrapping off (`@xterm/headless` 6.1.0-beta.335 in Node, Unicode 6 and 11, the reader's own
    bytes at 20 x 7, 2026-11-22): a cluster drawn wider than the reader counts it (an Indic conjunct, a family of emoji
    joined by ZWJ) moves the rest of its row right, and a row that then reaches past the edge stops there, each
    character past it written over the last column, which holds the last one written; so too the line that says what is
    being read, wider than a narrow screen; the row after it is whole (as a control, without ESC [?7l the rows wrap and
    the screen scrolls). On the other terminals: reasoned, not measured.
  - On leaving, nothing of the reader stays on the screen: a run's `script` log replayed into the same `@xterm/headless`
    showed its text on the alternate screen before the leave sequence and none on the normal screen after it
    (2026-11-22). Its frames go to the terminal that is its stdout, and a program that records that terminal records
    them: under util-linux `script` its log held them (2026-11-22, Node 24.18.0), and so did tmux's `pipe-pane`
    (2026-11-21); with stdout another terminal, the terminal of the keys got none of them.
  - A paste, in 0.1.1's code (2026-11-22, the keys through readline's decoding into the reader on Node 26.13.1, 24.18.0,
    22.23.3 and 20.20.2, and end to end in a pseudo-terminal on Node 26.13.1): a Ctrl-C in it quits (130), in a line
    being typed and outside one, but not right after an ESC, which is read with it as one key (in a line: the rest of
    the paste was typed); an ESC [201~ in it ends the paste there, what follows it acting as keys; a CR LF pasted into a
    line becomes two spaces, the line not run. What reaches the reader is the terminal's to say, by their sources (read,
    not run): Alacritty 0.17.0 takes ESC and Ctrl-C out of a bracketed paste; Konsole 26.08.3 asks before it pastes a
    control character, Ctrl-C among them (its first button pastes without them), and takes ESC out of a bracketed
    paste; the xterm.js of VS Code 1.147.0 (6.1.0-beta.337) writes ESC as U+241B (␛) and passes Ctrl-C.
  - Modelled, not run on such a terminal (xterm.js beta.304 with one of the three given a column, 2026-11-22): a
    terminal that gives an LRM or an LRO a column shifts the row by it from its second cluster on; one that gives a PDF
    a column shifts nothing, the column falling after the row's end, and on a row as wide as the screen in the place of
    its last character. And mode `terminal` on Konsole: after a Hebrew letter, the RLM at a right-to-left line's end
    puts the paragraph's end punctuation where it belongs, its brackets not mirrored (measured on 2026-11-16); after a
    left-to-right word or a path it would not, by a model of Konsole's layout (ICU 78, which it links, with a
    left-to-right base, and GNU FriBidi `--ltr`) that gives 10 of 10 lines measured on Konsole as they were drawn
    (2026-11-22).
- What `--help`, the keys screen and the refusal said more than holds, as a check of each of 0.1.1's claims against its
  code and its measurements found it (2026-11-21 and 22), is narrowed, and so is the README: `--help` says the first
  grapheme cluster, the left-to-right base, the xterm.js of VS Code's terminal, the RLM of mode `terminal`, and that,
  for a line that begins with a right-to-left letter, this was measured only with Hebrew letters without points, in no
  line wider than 0.1.0's; the keys screen and the refusal say where a transcript's text goes.
- Tests: 435 → 444 (Node 26.13.1: 444 passing; Node 24.18.0, on a second machine: 444 passing; Node 24.22.3, 22.23.3 and
  20.20.2 in docker: 436 passing, 0 failing, 8 skipped, as their images have no GNU FriBidi, no python3, which the five
  tests of FriBidi's library run, and no Electron; each line the same under `NODE_OPTIONS=--max-old-space-size=100` and
  `=500`, but Node 20.20.2 under `=100`, where the process of the record view's tests was ended by SIGABRT in some runs,
  Node's heap running out in its test of a record nested 990 deep, the tests before it passing: on 2026-11-22, in 2 of 5
  runs of the whole suite and 9 of 20 runs of that file alone, in a second set of runs 3 of 5 and 6 of 20, and in a
  third, at this release's code, 2 of 5 and 5 of 20. That test gives the record rule a memory limit of 256 MB in a
  process whose old space is 100 MB, and its abort needs the file's test of a right-to-left paragraph of 200,000 paths
  to have run before it in the same process: in docker node:20-slim under `=100`, a fresh process a run, it came in 0 of
  70 runs without that test (the record's test alone, after each of the other five tests before it, after all five), in
  10 of 40 with that test right before it and in 2 of 10 in the file's order; what of that test's run it needs was not
  measured. With the rule reading the process's own limit, the record is refused under `=100`, and under `=114`, the
  least at which the rule shows it, it opened in 10 of 10 runs after the same test. The new ones: the FriBidi test
  above; a transcript's own LRM in rows the reader lays out, in a
  frame's bytes and end to end in a pseudo-terminal, and the tests' own readers of a row (the one that takes the
  reader's LRM, LRO and PDF out of a row, the one that reads a pseudo-terminal's screen, and the one that writes what a
  terminal does not show as `<U+XXXX>`) on known answers (a check of 0.1.1's claims found no test holding such a row, so
  that the tests could find the reader's LRM by its character, and the reader could drop a transcript's, and every test
  passed); a walk of every row of the Hebrew fixture's views, and of a transcript whose lines begin with a letter and
  its mark, a test of its own, each row's text against that of `displayOrder` (`src/text.mjs`), which requires rows that
  begin with a Latin letter and its mark and rows that begin with a Hebrew one; `--help`'s widths; the keys screen's
  sentence on where the text goes; a step of the pseudo-terminal's tests whose text comes only in a wrong form fails
  once the terminal has gone quiet, no longer after its wait. The tests of where the reader writes its LRM, LRO and PDF
  take the three from the tests' own constants, not from the module under test (one of them passed with an RLM where the
  LRM goes); one of them pins where the LRM and LRO go when the first cluster that takes a column ends a styled segment
  (inside its style) and when it is past U+FFFF (an emoji, and one with a skin-tone modifier: after the whole cluster),
  and the tests' reader that takes them out of a row checks that they sit where a grapheme cluster of the row's text
  ends; a test of the path rule pins what a path in Markdown's backticks or bold gives (a Known limit below). Each of
  these but that test was found by changing the reader or the tests on purpose and running every test: with the LRM and
  LRO written after the escape sequences, every test passed; inside the first cluster, only the rows of the test of
  their place failed; between an emoji's two UTF-16 units, every test passed; and the walk passed with its right-to-left
  line taken out. The path test's case was found by running the path rule on such paths; then two changes of that rule,
  a closing backtick or asterisk trimmed off a path and a backtick or asterisk before a path taken as its start, each of
  which every test had passed, failed it.

### Known limits

- In xterm.js's DOM renderer (in VS Code 1.147.0's terminal, where WebGL fails to load or with
  `terminal.integrated.gpuAcceleration` "off"), with the Hebrew drawn from a second monospace font, a row's
  right-to-left words after its first come out reversed in place: the renderer puts each word into a span of its own,
  the browser lays each span out by itself, and the override, in the first span, reaches none of the others. Measured on
  2026-11-22 in headless Chromium 158 with xterm.js 6.1.0-beta.304 and beta.337 (VS Code 1.146.0's and 1.147.0's), the
  font Noto Sans Mono with the Hebrew from Courier New: 0.1.1's record row of `שלום עולם ומלואו` drew 8 of its 14
  letters elsewhere, and its twin 8 of 12 (0.1.0's rows: 14 of 14 and 12 of 12). With one monospace font for both
  scripts, or the Hebrew from a proportional font, and in the WebGL renderer, 0.1.1's rows were drawn in order. Not run
  in VS Code's own window.
- A path or a URL in Markdown's markers (backticks, bold, italics) is no unit only where it comes right after an opening
  backtick, `**` or `*`: one right after an opening `_` or `__` is one, the markers in it (`_/home/x_`), laid out in a
  right-to-left line as written; and one that follows a space inside any of them is one, up to the next space, the
  closing marker with it when the marker follows the path directly (with a word between them, the path alone), so that
  in a right-to-left line that marker is laid out with the path, on its right (`ראה **קובץ /home/x** שם` is laid out,
  from the left: `שם`, then `/home/x**`, then `קובץ`, then `**`, then `ראה`; so with `*`, `_` and `__`). Right after an
  opening backtick, `**` or `*` the path is laid out as UAX #9 has it, its first slash at its right end: in a
  right-to-left line, `/home/user/x.txt` in backticks reads `home/user/x.txt/`, and so in `**` or `*`. Read in
  `pathUnits` (`src/text.mjs`), and run on it and on the reader's layout at this release's code (Node 24.18.0,
  2026-11-22: backticks and bold, then italics too).
- A transcript is read into memory whole, in the reader's own process: one over a tenth of Node's memory limit is
  refused with its size (rounded up) and that limit (rounded down), so that the two differ, and the
  `NODE_OPTIONS=--max-old-space-size=...` that would let it be read, and one over 480 MB at all, by JavaScript's limit
  on a string's length (read in `src/reading.mjs`). That tenth is the rule ltms's commands follow, and the reader runs
  them without its own `NODE_OPTIONS` or flags, so that the lists and the reader agree on which files can be read while
  Node's memory limit is the same for both. Node's memory limit is the old space's where `--max-old-space-size` or
  `--max-old-space-size-percentage` sets it (in `NODE_OPTIONS` or on node's command line), else the heap's: a
  transcript's parse is kept in the old space, and the heap's limit holds beside it a reserve for new objects sized from
  the machine's memory, not from the old space: under `--max-old-space-size=16`, a heap limit of 64 MB on Node 20.20.2
  and 22.23.3, 208 MB on 24.22.3 and 112 MB on 26.13.1 (measured on 2026-11-17, and again on 2026-11-22: Node 20, 22 and
  24 in docker with 3 GB, Node 26 in a scope of 3 GB). By the heap's limit, under that old space, Node 24.22.3 took in a
  transcript of 12 MB and ran out of memory (2026-11-17, with the rule set to read the heap's limit).
- A record is shown when its view (up to 16 times the record's size) fits beside the transcript's parse (up to 8 times
  the file's) in nine tenths of Node's memory limit, and so does what writing the JSON its view writes takes, 1.5 times
  that JSON, with 12 MB beside it, the reader's own (read in `src/reading.mjs`). That JSON is measured by walking the
  record, before any of it is written; it is indented once more at each level a value is nested in, so that a record
  nested deep writes JSON hundreds of times its size: a list nested 990 deep of 400,000 ones, on a line of 0.8 MB,
  399,389,570 bytes (381 MB; a test asserts it, run on every Node line on 2026-11-22). The 1.5 and the 12 MB were
  measured against the old space on 2026-11-17, with the size rules set aside, on Node 20.20.2, 22.23.3, 24.22.3 and
  26.13.1 (130 records): the reader alone needed 7 to 9 MB, and writing a list nested deep up to 1.04 times its JSON on
  Node 22, 24 and 26 and up to 1.41 times on Node 20; the record view's code has not changed since, but for a refusal's
  wording. A record that does not fit is refused before it is drawn, with its size and the `NODE_OPTIONS` that would
  show it; its lines are laid out a page at a time.
- The screen runs in a process of its own, which the command waits for. When that process ends without restoring the
  terminal (Node's memory running out aborts it), the command restores it, then prints what Node said and what happened.
  An error in the command's own process (a module loaded through `NODE_OPTIONS` or `--import` that throws, say) ends the
  screen by its own way out (SIGTERM; if it has not ended within 2 s, SIGKILL, and the command restores the terminal),
  is printed after the restore, and the command exits with 1. When the command's own process is killed (SIGKILL), the
  screen's process learns of it by an IPC channel between the two, which closes, restores the terminal and ends (read in
  `src/guard.mjs`; run in a pseudo-terminal: the next entry). When both are killed at once (a whole cgroup, as
  systemd-oomd does), nothing is left to restore the terminal (reasoned, not run).
- Under an interactive shell with job control, that shell takes the terminal back as soon as the command's process is
  killed, racing the screen's process, which then writes the leave sequence and leaves the terminal's modes to the shell
  (it puts back the modes it started with only where they are still the screen's raw ones, as under a shell that sets
  none). Measured on 2026-11-16 in a pseudo-terminal of 80 x 24, the shell at its prompt, the reader started from it,
  SIGKILL to the command's process once its frame was up, 10 runs each of bash 5.3.20, zsh 5.9.2 (`-f`, and `-f` with
  `ttyctl -f` typed first), fish 4.9.3 and a stand-in for a job-control shell that sets no modes: the modes 1.5 s after
  were the shell's own, as at its prompt, 10 of 10 for bash, zsh with `ttyctl -f`, fish and the stand-in; a line typed
  then came back once, 10 of 10, for bash, both zsh and the stand-in. Bash, both zsh and the stand-in wrote their prompt
  before the leave sequence, 10 of 10 each (fish 0 of 10), on the alternate screen, where it is not seen (bash 4.0 to
  4.9 ms after the kill, zsh 4.1 to 9.2, zsh with `ttyctl -f` 3.9 to 5.1, the stand-in 3.7 to 5.1): the shell waits at
  it, and the next line given to it brings a prompt back. Zsh without `ttyctl -f` took the modes the killed command left
  as its own (10 of 10: its iflag and lflag not those at its prompt), so that the commands it ran next had the
  keyboard's signals (Ctrl-C) and flow control off, `-isig -ixon`, 10 of 10; with `ttyctl -f` (in `.zshrc`) they had
  them on, 10 of 10. The code that leaves the screen and restores the terminal has not changed since.
- A list of sessions waits for `ltms index` to read every transcript of the project, and a search for `ltms search`; the
  screen says what is being read and for how long (`ltms index` took 39 s for a project folder of 385 sessions on one
  machine, by the README of ltms 0.3.1, the dependency). A list that took 3 s or more is kept: opened again after its
  files changed, it is shown as it was read, and says when that was and how many files changed since; `r` reads it
  again, as it reads Projects again, and so does `ltms-reader` started again (read in `src/engine.mjs` and
  `src/app.mjs`).
- Some clusters are drawn wider by some terminals than the reader counts them (an Indic conjunct, an emoji sequence a
  terminal does not join): the rest of the row is drawn that much further right, and a row that then reaches past the
  screen's edge stops there, each character past it written over the last column (measured on 2026-11-22 with the
  xterm.js of VS Code 1.147.0, its headless build: at the screen's edge, above; on the other terminals reasoned, not
  measured).
- On a narrow screen some rows are wider than it: the line that says what is being read
  (`reading the sessions with ltms index`, a transcript's name, `searching with ltms search`), which is not cut to the
  screen's width, and the search line where its prompt, which names what is searched, fills the screen (the text typed
  and the cursor go past it). Measured on 2026-11-22 at this release's code, in a pseudo-terminal, Node 26.13.1: at 25
  columns, the line that says what is being read 38 columns wide (the sessions) and 30 (a transcript's name), and the
  search line 26; at 30 columns, 38 and 31. The reader turns wrapping at the last column off, so a terminal stops such a
  row at its edge, the edge's cell holding the last character written to the row (measured with the xterm.js of VS Code
  1.147.0, its headless build, above; on the other terminals reasoned, not measured).
- A paragraph's levels are resolved once, when a line of it is first drawn, and kept for the last two drawn of 4,096
  UTF-16 code units or more (a character past U+FFFF counts two), so that the first frame drawn of a long paragraph
  costs more than the frames after it. Measured on 2026-11-22 at this release's code, one process a run, on Node
  26.13.1: for a record of one paragraph of 4,000,000 characters (`אבג ` 1,000,000 times), the first frame of a page in
  its middle took 157 to 190 ms (6 runs, at 200 x 60 and 80 x 24), and the 20 frames after it a median of 11.6 to 12.0
  ms at 200 x 60 and 6.9 to 7.0 at 80 x 24; its levels alone 141 to 149 ms (3 runs), and 144 to 148 on Node 20.20.2 (2
  runs). A line finds the paths in it by a binary search of its paragraph's: in a right-to-left paragraph of 200,000
  paths (3,200,004 characters), the first frame took 160 to 173 ms at 80 x 24 (3 runs), and a page at its start, its
  middle and its end 1.5 to 2.3 ms at 80 x 24 and 4.6 to 7.6 at 200 x 60.
- On Node 20, a long line of text that is not ASCII is laid out about three times slower than on Node 26: Node 20's
  grapheme segmenter is slower, and walked over one long string it costs more at each cluster the longer the string is
  (on 2026-11-22, Node 20.20.2: 4.3 to 4.9 us a cluster at 10,000 units, 118 to 121 at 80,000 for Hebrew, mixed or CJK
  text, 28 for ASCII; Node 26.13.1: 0.08 to 0.3 us at every length; one run each), so the reader walks a long line 256
  units at a time. Measured at this release's code on the record of 4,000,000 characters above, at 80 columns: its lines
  counted in 3.6 to 3.9 s on Node 20.20.2 (2 runs, in docker), against 1.15 to 1.23 s on Node 26.13.1 (3 runs); a record
  of the same size in ASCII (`abc ` 1,000,000 times) in 15 to 16 ms on Node 20.20.2 and 16 to 20 on Node 26.13.1 (2 runs
  each).

Of 0.1.0's Known limits (below), the first, a first cluster that is right to left moved to the line's other end by a
terminal that lays each line out with a left-to-right base, no longer holds at Konsole's default bidi settings, where it
was measured with two Hebrew letters without points, nor under GNU FriBidi `--ltr`; with Konsole's "force LTR line
direction" unchecked, where a line takes its base from its first strong character, such a cluster is predicted to be
drawn at the line's other end still (the first bullet above). The others still hold; in the one of a letter followed by
WJ and a mark, 0.1.1 writes U+05DD, U+200E, U+202D, U+2060, U+05B7, the rest, U+202C. The last of them, which leaves
the rest to the README's Limits, is now carried by this release's Known limits above, each measured again at this
release's code or traced to the run that measured it.

## 0.1.0 (2026-11-18)

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
