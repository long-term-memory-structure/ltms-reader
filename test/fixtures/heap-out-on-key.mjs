// test/fixtures/heap-out-on-key.mjs — loaded with node --import by test/pty.test.mjs: the key x makes the reader's
// process run V8's heap out (an array of strings that grows until the heap's limit), as a record too large for its
// memory did (R.F1), to see the terminal restored after the abort, by the command that started the screen's process.
process.stdin.on('keypress', (str) => {
  if (str !== 'x') return;
  const keep = [];
  for (let i = 0; ; i++) keep.push(`${i}`.repeat(1000) + i);
});
