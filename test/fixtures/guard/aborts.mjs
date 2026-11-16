// test/fixtures/guard/aborts.mjs — a screen's process (for test/guard.test.mjs) that writes V8's line of a heap run out
// to stderr, then is ended by SIGABRT, whatever its arguments (they are the path the command was given).
process.stderr.write('FATAL ERROR: planted - JavaScript heap out of memory\n');
process.kill(process.pid, 'SIGABRT');
setTimeout(() => {}, 10_000);
