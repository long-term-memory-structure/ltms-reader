// src/screen.mjs — the terminal, with no library: Node's raw mode and keypress events (readline.emitKeypressEvents), the
// alternate screen, the cursor hidden and wrapping at the last column off, each frame written whole; and the terminal
// restored on every way out (src/main.mjs calls restore() for q, Ctrl-C, SIGTERM, SIGHUP, SIGINT and an uncaught error,
// and once more as the process exits). A terminal left raw is the one failure a reader must never have.
//
// What it writes is its own escape sequences (ENTER, LEAVE, a cursor position per line and the line erased whole, SGR
// styles) and the text of the lines, each segment passed through visible() once more on its way out, so that no
// control character, whatever its source, reaches the terminal as one. Each row is erased before it is written: a
// terminal that draws a cluster narrower than it is counted here (an emoji and VS16, one column by wcwidth) ends the
// row early, and nothing of the frame before may stay after it (R.F6). Each row's segments are put in the order the
// right-to-left mode writes them (text.mjs displayOrder, R1): laid out by the reader, or as stored for a terminal that
// lays bidirectional text out itself. A row laid out by the reader that holds right-to-left text is written inside a
// left-to-right override, LRO after its first grapheme cluster that takes a column and PDF at its end (Y1, round 6; Z3,
// round 7: after a first cluster that takes none, it was at the row's first column), so that a terminal that lays text
// out itself with a left-to-right base for each line (Konsole, at its default settings) keeps the reader's order:
// measured on four terminals (S378, CONTROLS.md), the two take no column after a character in Alacritty 0.17.0, Konsole
// 26.08.3, tmux 3.6 and VS Code 1.146.0's xterm.js (run in a headless browser; xterm.js gives a zero-width character a
// column after an escape sequence, as it does the PDF after a row's last styled segment, which moves nothing), and
// Konsole applies an override from a row's second column on; at its first column an LRO is not applied by Konsole,
// dropped by tmux and given a column by xterm.js, which with its own Unicode 6 widths gives an isolate (LRI, RLI, PDI) a
// column anywhere. Between that first cluster and the LRO, a left-to-right mark (LRM, 0.1.1): a terminal that lays a row
// out with a left-to-right base (Konsole) moved a first cluster that is right to left, standing outside the override, to
// the row's other end (0.1.0's first Known limit, measured on Konsole 26.08.3 in S381), and with the mark it keeps it
// first (measured there too); S378 measured an LRM past the first column as no column in all four. Nothing else is
// written in "reader"; in "terminal" the text goes as stored, an RLM at the end of each line of a right-to-left
// paragraph (text.mjs displayOrder).
import readline from 'node:readline';
import { AL, AN, R, classOf } from './bidi.mjs';
import { clusterWidth, clusters, displayOrder, visible } from './text.mjs';

/** The alternate screen, the cursor hidden, no wrapping at the last column (so a cluster a terminal draws wider than it
 *  is counted here cannot scroll the screen), and bracketed paste: the terminal marks a paste, so that its text is
 *  read as text, never as keys (R.F8). */
export const ENTER = '\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h';
/** Back: bracketed paste off, styles reset, wrapping on, the cursor shown, the main screen. */
export const LEAVE = '\x1b[?2004l\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l';
const SGR = Object.freeze({ head: '1', dim: '2', sel: '7', bad: '31', addr: '36' });
/** The styles that are colours, left out under NO_COLOR; bold, faint and reverse are not colours. */
const COLOURS = new Set(['bad', 'addr']);

/** Colour unless NO_COLOR is set to anything but the empty string (no-color.org). */
export const colourFrom = (env) => !(typeof env.NO_COLOR === 'string' && env.NO_COLOR !== '');

/** One segment's text as it is written: visible, on one line. */
const safe = (s) => visible(s).replace(/\n/g, '\\n').replace(/\t/g, '\\t');

/** The left-to-right mark (U+200E) written between such a row's first cluster that takes a column and its override
 *  (0.1.1). A transcript's own marks are written as they are, so a test finds the reader's by its place, never by its
 *  character. */
export const LRM = String.fromCharCode(0x200e);
/** The left-to-right override (U+202D) and the pop that ends it (U+202C), written around a row laid out by the reader
 *  that holds right-to-left text (Y1): with the mark, the only bidirectional controls the reader writes in "reader"; in
 *  "terminal" it writes none of these, and an RLM at the end of each line of a right-to-left paragraph (text.mjs
 *  displayOrder). A transcript's overrides are escapes. */
export const LRO = '\u202d', PDF = '\u202c';
/** A text with no character that could be right to left (every R, AL and AN code point is at U+0590 or above). */
const NO_RTL = /^[\u0000-\u058f]*$/;
/** Whether a row's text holds a character a terminal that lays text out itself would lay out right to left or reorder
 *  around: one of class R, AL or AN (an Arabic number among neutrals is reordered too, and the reader has laid it out). */
export function holdsRtl(text) {
  if (NO_RTL.test(text)) return false;
  for (const ch of text) { const c = classOf(ch.codePointAt(0)); if (c === R || c === AL || c === AN) return true; }
  return false;
}

/** Where the first grapheme cluster of `text` that takes a column ends (Z3, round 7: after a first cluster that takes
 *  none, ZWSP or a lone mark, the LRO was in the row's first column), or -1 when none takes a column. */
function firstColumnEnd(text) {
  let at = 0;
  for (const c of clusters(text)) { at += c.length; if (clusterWidth(c) > 0) return at; }
  return -1;
}

/** The bytes of one whole frame: each line at its row, the row erased whole first, then the line, styled; its segments in
 *  the order the right-to-left mode `rtl` writes them ("reader" or "terminal"); in "reader", a row that holds
 *  right-to-left text inside LRO (after its first grapheme cluster that takes a column, and an LRM before it) and PDF
 *  (last). */
export function frameBytes(lines, { cols, rows, colour = true, rtl = 'reader' }) {
  let out = '';
  for (let i = 0; i < rows; i++) {
    const row = displayOrder(lines[i] ?? [], rtl);
    out += `\x1b[${i + 1};1H\x1b[2K`;
    // segments of one style next to each other are written as one
    const merged = [];
    for (const s of row) { const last = merged[merged.length - 1]; if (last && (last.style ?? null) === (s.style ?? null)) last.text += s.text; else merged.push({ text: s.text, style: s.style ?? null }); }
    const texts = merged.map((s) => safe(s.text));
    // laid out by the reader and holding right-to-left text: LRM and LRO right after the row's first grapheme cluster that
    // takes a column (where it ends, in whichever segment that is, a mark on its character kept with it; never in the row's
    // first column, where the terminals measured drop it, give it a column or do not apply it: Z3, round 7; the LRM keeps a
    // right-to-left first cluster first on a terminal with a left-to-right base: 0.1.1), PDF last; a row with no cluster
    // that takes a column has nothing a terminal could reorder, and none of the three
    let end = '';
    if (rtl === 'reader') {
      const whole = texts.join('');
      const first = holdsRtl(whole) ? firstColumnEnd(whole) : -1;
      if (first > 0) {
        for (let k = 0, at = 0; k < texts.length; at += texts[k++].length) {
          if (at < first && first <= at + texts[k].length) { texts[k] = texts[k].slice(0, first - at) + LRM + LRO + texts[k].slice(first - at); break; }
        }
        end = PDF;
      }
    }
    merged.forEach((s, k) => {
      const code = s.style && (colour || !COLOURS.has(s.style)) ? SGR[s.style] : undefined;
      out += code ? `\x1b[${code}m${texts[k]}\x1b[0m` : texts[k];
    });
    out += end;
  }
  return out;
}

/**
 * Take the terminal: raw mode, keypress events on `input`, the alternate screen. onKey(str, key) for each key;
 * onResize() when the window's size changes; `rtl` the right-to-left mode. Returns { draw(lines, cols, rows), restore(),
 * size() }; restore() may be called any number of times, and from any way out; restore({ modes: false }) writes the
 * leave sequence and leaves the terminal's modes as they are (another process has set them since: R3).
 */
export function openScreen({ input, output, colour = true, rtl = 'reader', onKey, onResize }) {
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
    draw(lines, cols, rows) { if (open) write(frameBytes(lines, { cols, rows, colour, rtl })); },
    restore({ modes = true } = {}) {
      if (!open) return;
      open = false;
      input.off('keypress', onKey);
      output.off('resize', onResize);
      write(LEAVE);
      if (modes) { try { input.setRawMode(false); } catch {} }
      try { input.pause(); } catch {}
    },
  };
}
