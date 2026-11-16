// test/fixtures/make-fixtures.mjs — writes the reader's own synthetic transcripts, in Claude Code's record shapes, with
// invented text; the output is the same on every run:
//
//   node test/fixtures/make-fixtures.mjs     # writes hebrew-english.jsonl, escapes.jsonl and channels.jsonl here
//
// hebrew-english.jsonl: Hebrew and English in one text, with niqqud and cantillation, numbers, paths and brackets, a
// right-to-left mark, wide characters and an emoji: what the screen must cut and wrap by grapheme cluster.
// escapes.jsonl: what a transcript can hold that a terminal would act on: ESC sequences (colours, cursor moves, the
// alternate screen, a title, a hyperlink, a device query), OSC 52 (which writes the clipboard), BEL, C1 controls (raw in
// the file, as JSON leaves them), the other C0 controls and DEL; in prompts, a reply, thinking, a tool's name and input, a
// result, and a channel's own word.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ESC = '\u001b', BEL = '\u0007';

function transcript(sid, records) {
  let parent = null, n = 0;
  const out = [];
  for (const r of records) {
    n++;
    const uuid = `${sid.slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const time = new Date(Date.UTC(2026, 10, 15, 9, 0, n)).toISOString();
    const base = { parentUuid: parent, isSidechain: false, userType: 'external', cwd: '/work/invented', sessionId: sid, version: '2.0.0', gitBranch: 'main', entrypoint: 'cli' };
    let rec;
    if (r.prompt !== undefined) rec = { ...base, type: 'user', message: { role: 'user', content: r.prompt }, uuid, timestamp: time, promptSource: 'typed', ...(r.extra ?? {}) };
    else if (r.result !== undefined) rec = { ...base, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: r.result, is_error: r.error === true, tool_use_id: r.id }] }, uuid, timestamp: time };
    else rec = { ...base, type: 'assistant', message: { id: `msg_${sid.slice(0, 4)}_${r.req}`, type: 'message', role: 'assistant', model: 'claude-invented-model', content: r.blocks, stop_reason: null, usage: { input_tokens: 10, output_tokens: 10 } }, requestId: `req_${sid.slice(0, 4)}_${r.req}`, uuid, timestamp: time };
    out.push(JSON.stringify(rec));
    parent = uuid;
  }
  out.push(JSON.stringify({ type: 'last-prompt', lastPrompt: '(invented)', leafUuid: parent, sessionId: sid }));
  return `${out.join('\n')}\n`;
}

const heb = (s) => s;   // the Hebrew below is written as it is read, with its points
const LONG = heb('וַיְהִי עֶרֶב וַיְהִי בֹקֶר: a long paragraph that mixes both scripts, to be wrapped by columns and never inside a cluster. ')
  + heb('בְּרֵאשִׁית הַסֵּפֶר (the book) נִכְתַּב בְּ-2026, וּבוֹ 3 פְּרָקִים [1, 2, 3] וְנָתִיב אֶחָד: /srv/נתונים/קובץ_ראשון.txt; ')
  + heb('אַחֲרָיו מִסְפָּרִים: 1,234.56 ₪ ו-78% מֵהַשּׁוּרוֹת, וְסוֹגְרַיִם {מפתח: "ערך"} <תג> (סוף).');

export const HEBREW_ENGLISH = transcript('44444444-4444-4444-8444-444444444444', [
  { prompt: heb('בְּרֵאשִׁית: read src/מודול.ts (line 12) and fix [the bug] in פונקציה() — 3.14 > 2') },
  { req: 1, blocks: [{ type: 'thinking', thinking: heb('חושב על זה: the path is /home/user/פרויקט/קובץ.txt, line 12'), signature: 'sig-1' }] },
  { req: 1, blocks: [{ type: 'tool_use', id: 'toolu_heb_1', name: 'Bash', input: { command: heb('grep -n "שָׁלוֹם" docs/קובץ.md | head -5'), description: heb('חיפוש המילה') } }] },
  { result: heb('12: שָׁלוֹם עוֹלָם (hello world)\n13:\tוַֽיְהִי־עֶ֥רֶב [v2.0] {key: \'ערך\'}\n14: 中文 mixed 👍 1,234.56 ₪ 🇮🇱 é'), id: 'toolu_heb_1' },
  { req: 2, blocks: [{ type: 'text', text: heb('Found 3 lines in docs/קובץ.md: the word שָׁלוֹם is on line 12 (שורה 12), and the brackets [ ] ( ) { } < > are balanced. Next: עדכון src/מודול.ts:12.') }] },
  { prompt: heb('תודה! now run the tests: npm test -- --grep \'עברית\'') },
  { req: 3, blocks: [{ type: 'tool_use', id: 'toolu_heb_2', name: 'Bash', input: { command: heb('npm test -- --grep \'עברית\''), description: 'Run the tests' } }] },
  { result: heb('Exit code 1\nFAIL test/עברית.test.js\n  expected ‏\'אבג\' received \'גבא\''), error: true, id: 'toolu_heb_2' },
  { req: 4, blocks: [{ type: 'text', text: LONG }] },
]);

export const ESCAPES = transcript('55555555-5555-4555-8555-555555555555', [
  { prompt: `show the colours ${ESC}[31mred${ESC}[0m, then ring ${BEL} and move ${ESC}[10;10H here` },
  { req: 1, blocks: [{ type: 'thinking', thinking: `think ${ESC}]0;thinking title${BEL} done`, signature: 'sig-e' }] },
  { req: 1, blocks: [{ type: 'tool_use', id: 'toolu_esc_1', name: `${ESC}[2JBash`, input: { command: `printf '${ESC}]0;a new title${BEL}'`, description: `title ${ESC}[?1049h` } }] },
  { result: `${ESC}]52;c;cGF5bG9hZA==${BEL} clipboard\n${ESC}[2J${ESC}[H cleared\n${ESC}[?1049l left the alternate screen\n${ESC}[?25h cursor shown\nC1: \u009b31m csi \u009d0;c1 title\u009c st \u0085 nel \u008d ri \u0090 dcs \u009e pm \u009f apc\ncarriage\r return, delete\u007f, back\bspace, form\ffeed, vertical\u000btab, nul\u0000, reset ${ESC}c end`, id: 'toolu_esc_1' },
  { req: 2, blocks: [{ type: 'text', text: `Here: ${ESC}[1mbold${ESC}[0m, ${ESC}]8;;http://example.invalid${ESC}\\a link${ESC}]8;;${ESC}\\, \u009b?1049h c1 alternate screen, ${ESC}P+q544e${ESC}\\ a query, ${ESC}[6n ${ESC}[c reports` }] },
  { prompt: `again \u009b2J\u0085 with C1 raw ${ESC}]52;p;${BEL}`, extra: { origin: { kind: `peer${ESC}]52;c;b3JpZ2lu${BEL}` } } },
  { req: 3, blocks: [{ type: 'text', text: `the end ${ESC}[0m${ESC}[?25l${ESC}[?7l${ESC}[?1000h${ESC}[?2004h` }] },
]);

// channels.jsonl: prompts whose channel is the record's own word: another agent's ("peer"), an empty one (ltms prints
// "none"), and one with a long error class's worth of characters
export const CHANNELS = transcript('66666666-6666-4666-8666-666666666666', [
  { prompt: 'a peer writes', extra: { origin: { kind: 'peer' } } },
  { req: 1, blocks: [{ type: 'text', text: 'read' }] },
  { prompt: 'an empty word', extra: { origin: { kind: '' } } },
  { req: 2, blocks: [{ type: 'tool_use', id: 'toolu_ch_1', name: 'Bash', input: { command: 'true' } }] },
  { result: `PreToolUse:Bash hook error: [bash /x/hooks/${'a'.repeat(48)}.sh]: blocked`, error: true, id: 'toolu_ch_1' },
  { prompt: 'a long word', extra: { origin: { kind: 'a-long-channel-word' } } },
]);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(here, 'hebrew-english.jsonl'), HEBREW_ENGLISH);
  writeFileSync(path.join(here, 'escapes.jsonl'), ESCAPES);
  writeFileSync(path.join(here, 'channels.jsonl'), CHANNELS);
  process.stderr.write('wrote test/fixtures/hebrew-english.jsonl, escapes.jsonl and channels.jsonl\n');
}
