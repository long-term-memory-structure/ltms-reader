// src/lines.mjs — the lines of a stream, split at "\n" only.
//
// Every process this extension talks to (the reading process, the ltms command) writes one JSON value per line.
// JSON.stringify leaves U+2028 and U+2029 unescaped inside strings, and Node's readline ends a line at both, so a
// transcript that holds either would cut a JSON line in two, and the request it answers would wait forever (measured:
// three JSON lines through readline came out as five, four of them not JSON). So this splits at "\n" alone.
export function onLines(stream, onLine, onEnd) {
  // each chunk is searched once: the unfinished line's chunks wait in a list, joined only when its "\n" arrives (a long
  // line is not scanned again for every chunk that brings it)
  let parts = [];
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    let start = 0, i;
    while ((i = chunk.indexOf('\n', start)) >= 0) { parts.push(chunk.slice(start, i)); onLine(parts.join('')); parts = []; start = i + 1; }
    if (start < chunk.length) parts.push(chunk.slice(start));
  });
  stream.on('end', () => { if (parts.length) onLine(parts.join('')); parts = []; onEnd?.(); });
}
