// test/fixtures/throw-on-signal.mjs — loaded with node --import by test/pty.test.mjs, into both of the reader's processes
// (the command passes its flags to the screen's): SIGUSR2 makes the process that receives it fail as a bug would, by
// LTMS_PLANT: 'error' throws a TypeError, 'reject' leaves a rejected promise with nothing to catch it, 'string' throws
// a string, 'interval' throws a TypeError every 20 ms from then on (an error that leaves something running). Each holds
// a marker that must never be printed (it stands for a transcript's text). The test sends SIGUSR2 to the command's own
// process, once the frame is up (R's P1: an error planted in the command's process).
const kind = process.env.LTMS_PLANT ?? 'error';
process.on('SIGUSR2', () => {
  if (kind === 'reject') Promise.reject(new RangeError('PLANTED-SECRET-REJECT'));
  else if (kind === 'string') throw 'PLANTED-SECRET-STRING';
  else if (kind === 'interval') setInterval(() => { throw new TypeError('PLANTED-SECRET-INTERVAL'); }, 20);
  else throw new TypeError('PLANTED-SECRET-ERROR');
});
