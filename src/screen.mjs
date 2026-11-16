// src/screen.mjs — the terminal, with no library: Node's raw mode and keypress events (readline.emitKeypressEvents), the
// alternate screen, the cursor hidden and wrapping at the last column off, each frame written whole; and the terminal
// restored on every way out (src/main.mjs calls restore() for q, Ctrl-C, SIGTERM, SIGHUP, SIGINT and an uncaught error,
// and once more as the process exits). A terminal left raw is the one failure a reader must never have.
//
// What it writes is its own escape sequences (ENTER, LEAVE, a cursor position per line and the line erased whole, SGR
// styles) and the text of the lines, each segment passed through visible() once more on its way out, so that no
// control character, whatever its source, reaches the terminal as one. Each row is erased before it is written: a
// terminal that draws a cluster narrower than it is counted here (an emoji and VS16, one column by wcwidth) ends the
// row early, and nothing of the frame before may stay after it (R.F6).
import readline from 'node:readline';
import { displayOrder, visible } from './text.mjs';

/** The alternate screen, the cursor hidden, no wrapping at the last column (so a cluster a terminal draws wider than it
 *  is counted here cannot scroll the screen). */
export const ENTER = '\x1b[?1049h\x1b[?25l\x1b[?7l';
/** Back: styles reset, wrapping on, the cursor shown, the main screen. */
export const LEAVE = '\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l';
const SGR = Object.freeze({ head: '1', dim: '2', sel: '7', bad: '31', addr: '36' });
/** The styles that are colours, left out under NO_COLOR; bold, faint and reverse are not colours. */
const COLOURS = new Set(['bad', 'addr']);

/** Colour unless NO_COLOR is set to anything but the empty string (no-color.org). */
export const colourFrom = (env) => !(typeof env.NO_COLOR === 'string' && env.NO_COLOR !== '');

/** One segment's text as it is written: visible, on one line. */
const safe = (s) => visible(s).replace(/\n/g, '\\n').replace(/\t/g, '\\t');

/** The bytes of one whole frame: each line at its row, the row erased whole first, then the line, styled. */
export function frameBytes(lines, { cols, rows, colour = true, rtl = 'terminal' }) {
  let out = '';
  for (let i = 0; i < rows; i++) {
    const row = displayOrder(lines[i] ?? [], rtl);
    out += `\x1b[${i + 1};1H\x1b[2K`;
    // segments of one style next to each other are written as one
    const merged = [];
    for (const s of row) { const last = merged[merged.length - 1]; if (last && (last.style ?? null) === (s.style ?? null)) last.text += s.text; else merged.push({ text: s.text, style: s.style ?? null }); }
    for (const s of merged) {
      const text = safe(s.text);
      const code = s.style && (colour || !COLOURS.has(s.style)) ? SGR[s.style] : undefined;
      out += code ? `\x1b[${code}m${text}\x1b[0m` : text;
    }
  }
  return out;
}

/**
 * Take the terminal: raw mode, keypress events on `input`, the alternate screen. onKey(str, key) for each key;
 * onResize() when the window's size changes. Returns { draw(lines, cols, rows), restore(), size() }; restore() may be
 * called any number of times, and from any way out.
 */
export function openScreen({ input, output, colour = true, onKey, onResize }) {
  let open = true, dead = false;
  const write = (s) => { if (dead) return; try { output.write(s); } catch { dead = true; } };
  const onError = () => { dead = true; };
  output.on('error', onError);
  readline.emitKeypressEvents(input, { escapeCodeTimeout: 50 });
  input.setRawMode(true);
  input.on('keypress', onKey);
  output.on('resize', onResize);
  input.resume();
  write(ENTER);
  return {
    get open() { return open; },
    size: () => ({ cols: output.columns || 80, rows: output.rows || 24 }),
    draw(lines, cols, rows) { if (open) write(frameBytes(lines, { cols, rows, colour })); },
    restore() {
      if (!open) return;
      open = false;
      input.off('keypress', onKey);
      output.off('resize', onResize);
      write(LEAVE);
      try { input.setRawMode(false); } catch {}
      try { input.pause(); } catch {}
    },
  };
}
