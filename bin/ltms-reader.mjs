#!/usr/bin/env node
// bin/ltms-reader.mjs — the reader's command. The screen is not written yet: until it is, the command prints its usage on
// stderr and exits 2, whatever it is given, and reads nothing.
process.stderr.write(`usage: ltms-reader                      the projects under ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects)
       ltms-reader <projects folder>    another folder of project folders
       ltms-reader <file.jsonl>         one transcript

The screen is not built yet: nothing was read.
`);
process.exitCode = 2;
