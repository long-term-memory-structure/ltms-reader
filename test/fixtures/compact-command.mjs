// test/fixtures/compact-command.mjs — a session compacted by /compact, its records linked as the demo corpus's dc532898
// L123–L132 are (measured S365): the boundary's logicalParentUuid is the last reply before it, the summary its child,
// then the command's caveat, the command and its output, the command's records carrying its earlier time. Invented text.
// make(trigger, cmdTime): the JSONL; trigger 'manual', 'auto' or null (none recorded); cmdTime the command's time.
export const SID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name = `${SID}.jsonl`;
const base = { isSidechain: false, userType: 'external', cwd: '/work/x', sessionId: SID, version: '2.1.300', gitBranch: 'main', entrypoint: 'sdk-cli' };
const u = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 };
const reply = (n, parent, text, ts) => ({ ...base, parentUuid: u(parent), type: 'assistant', message: { id: `msg_${n}`, type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage }, requestId: `req_${n}`, uuid: u(n), timestamp: ts });
const user = (n, parent, content, ts, extra = {}) => ({ ...base, parentUuid: parent === null ? null : u(parent), type: 'user', message: { role: 'user', content }, uuid: u(n), timestamp: ts, ...extra });
export const make = (trigger, cmdTime) => [
  user(1, null, 'An invented first prompt.', '2026-03-01T10:00:00.000Z', { promptSource: 'sdk' }),
  reply(2, 1, 'An invented reply.', '2026-03-01T10:00:01.000Z'),
  { parentUuid: null, logicalParentUuid: u(2), isSidechain: false, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', isMeta: false, timestamp: '2026-03-01T10:00:40.000Z', uuid: u(3), level: 'info', compactMetadata: { ...(trigger ? { trigger } : {}), preTokens: 54612, postTokens: 9840 }, sessionId: SID, version: '2.1.300', cwd: '/work/x' },
  user(4, 3, 'This session is being continued from a previous conversation. An invented summary.', '2026-03-01T10:00:40.000Z', { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
  user(5, 4, '<local-command-caveat>Caveat: an invented caveat.</local-command-caveat>', cmdTime, { isMeta: true }),
  user(6, 5, '<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>', cmdTime),
  user(7, 6, '<local-command-stdout>Compacted </local-command-stdout>', '2026-03-01T10:00:41.000Z'),
  user(8, 7, 'An invented prompt after it.', '2026-03-01T10:01:00.000Z', { promptSource: 'sdk' }),
  reply(9, 8, 'Another invented reply.', '2026-03-01T10:01:01.000Z'),
].map((r) => JSON.stringify(r)).join('\n') + '\n';
