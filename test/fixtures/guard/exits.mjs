// test/fixtures/guard/exits.mjs — a screen's process (for test/guard.test.mjs) that ends by itself: its stderr says so,
// and it exits with the code its first argument gives.
process.stderr.write(`ended by itself, ${process.argv[2]}\n`);
process.exitCode = Number(process.argv[2]);
