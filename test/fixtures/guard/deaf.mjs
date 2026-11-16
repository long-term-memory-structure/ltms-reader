// test/fixtures/guard/deaf.mjs — a screen's process (for test/guard.test.mjs) that does not end on the signals the
// command passes on, as a screen busy in a long synchronous read would not end in time: it says so on stderr, and waits.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { process.stderr.write(`ignored ${sig}\n`); });
process.stderr.write('waiting\n');
setTimeout(() => {}, 20_000);
