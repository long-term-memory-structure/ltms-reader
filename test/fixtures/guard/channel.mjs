// test/fixtures/guard/channel.mjs — a screen's process (for test/guard.test.mjs) that says whether the command opened an
// IPC channel to it (N5: the screen's process learns by it that the command's process is gone), then ends by itself.
process.stderr.write(`channel ${typeof process.channel}\n`);
