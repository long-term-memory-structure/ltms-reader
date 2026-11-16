// test/fixtures/guard/killed.mjs — a screen's process (for test/guard.test.mjs) that a signal ends: it writes a line to
// stderr, as V8 writes its report before an abort, and is killed by the signal its first argument names.
process.stderr.write('FATAL ERROR: planted - JavaScript heap out of memory\n');
process.kill(process.pid, process.argv[2] ?? 'SIGKILL');
setTimeout(() => {}, 10_000);
