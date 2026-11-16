// test/fixtures/throw-on-key.mjs — loaded with node --import by test/pty.test.mjs: the key x throws an error from inside
// the reader's process, as a bug would, to see the terminal restored and the error printed after the restore, by its
// kind and its place, without its message.
process.stdin.on('keypress', (str) => { if (str === 'x') throw new Error('planted: a secret a transcript could hold'); });
