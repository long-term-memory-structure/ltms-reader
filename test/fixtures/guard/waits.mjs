// test/fixtures/guard/waits.mjs — a screen's process (for test/guard.test.mjs) that waits for a signal and ends with
// 128 + its number, as the reader's screen does for SIGINT, SIGTERM and SIGHUP; it says which it got on stderr.
const codes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
for (const [sig, code] of Object.entries(codes)) process.on(sig, () => { process.stderr.write(`got ${sig}\n`); process.exit(code); });
process.stderr.write('waiting\n');
setTimeout(() => {}, 20_000);
