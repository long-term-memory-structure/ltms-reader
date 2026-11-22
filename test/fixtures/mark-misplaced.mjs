// test/fixtures/mark-misplaced.mjs — loaded with node --import by test/pty.test.mjs, into both of the reader's processes
// (the command passes its flags to the screen's): what the screen writes to the terminal has every LRM that comes right
// before an LRO written as an RLM, as a defect of the reader's would (the claims run's K12), so that the text a step
// waits for reaches the terminal only in a wrong form.
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => write(typeof chunk === 'string' ? chunk.replace(/\u200e(?=\u202d)/g, '\u200f') : chunk, ...rest);
