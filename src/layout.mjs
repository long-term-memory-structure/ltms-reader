// src/layout.mjs — where a project's transcripts are, by ltms's own rules (ltms 0.2.0, dist/cli.js walkPaths), with no
// editor in it. A transcript is any regular .jsonl file at any depth under the project's folder, reached without
// following a symbolic link: what `ltms search <folder>` reads, as near as this code can tell (ltms also skips a file
// larger than a tenth of its runtime's memory, and this walk stops at MAX_DEPTH folders and MAX_FILES files, saying so).
// `ltms index <folder>` reads the same files except those in a session's own folder, the set-aside copies and the
// folders holding PINS.log, and lists a session wherever it finds one (a copy kept under another folder of the project
// is listed too). The GUI names each transcript by its path in the project, '/'-separated; the page names nothing else.
//
// A session's own folder (ltms's rule): beside <name>.jsonl, the folder <name>/, or a folder named by a UUID. Claude Code
// keeps a session's agents there: subagents/agent-<id>.jsonl, and a workflow's under subagents/workflows/<run>/. ltms index
// counts every agent-*.jsonl at any depth of that folder; a symbolic link met there, a folder there that cannot be
// listed, or the own folder itself a symbolic link, makes the count unknown (null).
import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const AGENT_NAME = /^agent-.*\.jsonl$/;
export const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ltms's set-aside copies: Claude Code's <session>.orphaned-<time>-<suffix>.jsonl, pin's <stem>.superseded-<12 hex>.jsonl. */
export const SET_ASIDE = /^(.+?)\.(?:orphaned-[^/]*|superseded-[0-9a-f]{12})\.jsonl$/;
// a backslash is an ordinary character in a name on Linux and macOS (ltms reads such files); on Windows it separates
const PLAIN = process.platform === 'win32' ? /^[^/\\\0]+$/ : /^[^/\0]+$/;
const LOSSY = String.fromCodePoint(0xfffd);   // what Node writes for bytes of a name that are not UTF-8
/** One component of a path the page sends: a plain name, never '.' or '..'. */
export const isName = (s) => typeof s === 'string' && s !== '.' && s !== '..' && PLAIN.test(s) && s.length <= 255;
export const MAX_DEPTH = 64;
export const MAX_FILES = 200_000;

const kind = (p) => { try { const s = lstatSync(p); return s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other'; } catch { return 'none'; } };

/** The path the page sends, checked: plain names joined by '/', at most MAX_DEPTH of them; null if it is not one. */
export function relParts(rel, { jsonl = true } = {}) {
  if (typeof rel !== 'string' || rel.length > 4096) return null;
  const parts = rel.split('/');
  if (!parts.length || parts.length > MAX_DEPTH || !parts.every(isName)) return null;
  if (jsonl && !parts[parts.length - 1].endsWith('.jsonl')) return null;
  return parts;
}

/**
 * Every regular .jsonl file under `dir`, at any depth: { files: [{ rel, size, mtimeMs, dev, ino }], links, linkRels,
 * lossy, pinStores, unreadable, cut }. Symbolic links are counted (linkRels: their paths) and not followed, also when a
 * folder became one after its parent was listed; a folder is entered once (by device and inode); a folder that cannot be
 * listed, or an entry that vanished or cannot be stat'ed, is counted in `unreadable`. `lossy`: the .jsonl files whose
 * names are not UTF-8 (ltms counts them and cannot read them either). `pinStores`: the folders holding PINS.log. `cut`:
 * more than maxFiles were found (the rest are not listed), or a folder lay deeper than MAX_DEPTH.
 */
export function walk(dir, { maxFiles = MAX_FILES, under = '' } = {}) {
  const files = [], linkRels = [], lossy = [], pinStores = [];
  let unreadable = 0, cut = false;
  const entered = new Set();
  const stack = [{ abs: dir, rel: under, depth: 0 }];
  while (stack.length) {
    const { abs, rel, depth } = stack.pop();
    let st;
    try { st = lstatSync(abs, { bigint: true }); } catch { unreadable++; continue; }
    // listed as a folder by its parent, it may have been replaced by a link since: never listed through one
    if (!st.isDirectory()) { if (st.isSymbolicLink()) linkRels.push(rel); else unreadable++; continue; }
    const id = `${st.dev}:${st.ino}`;
    if (entered.has(id)) continue;
    entered.add(id);
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { unreadable++; continue; }
    if (rel && entries.some((e) => e.name === 'PINS.log' && e.isFile())) pinStores.push(rel);
    for (const e of entries) {
      const childAbs = path.join(abs, e.name), childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) { linkRels.push(childRel); continue; }
      if (e.name.includes(LOSSY)) { if (e.isFile() && e.name.endsWith('.jsonl')) lossy.push(childRel); else if (e.isDirectory()) unreadable++; continue; }
      if (e.isDirectory()) {
        if (!isName(e.name)) { unreadable++; continue; }
        if (depth + 1 >= MAX_DEPTH) { cut = true; continue; }
        stack.push({ abs: childAbs, rel: childRel, depth: depth + 1 });
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        if (!isName(e.name)) { unreadable++; continue; }
        if (files.length >= maxFiles) { cut = true; continue; }
        try { const s = lstatSync(childAbs); if (!s.isFile()) continue; files.push({ rel: childRel, size: s.size, mtimeMs: s.mtimeMs, dev: s.dev, ino: s.ino }); }
        catch { unreadable++; }
      }
    }
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { files, links: linkRels.length, linkRels, lossy, pinStores, unreadable, cut };
}

/**
 * Each file of a walk, by what `ltms index` does with it (its classify): 'read' (it reads it), 'part' (in a session's own
 * folder: counted, not read), 'aside' (a set-aside copy: counted, not read), 'pinned' (under a folder holding PINS.log:
 * not entered). A session's own folder is any folder below the one walked named by a UUID, or with <its name>.jsonl
 * beside it.
 */
export function classify(w) {
  const names = new Set(w.files.map((f) => f.rel));
  const pins = w.pinStores.map((p) => `${p}/`);
  const out = new Map();
  for (const f of w.files) {
    if (pins.some((p) => f.rel.startsWith(p))) { out.set(f.rel, 'pinned'); continue; }
    const parts = f.rel.split('/');
    let part = false;
    for (let i = 0; i < parts.length - 1 && !part; i++) {
      const folder = parts.slice(0, i + 1).join('/');
      if (UUID_NAME.test(parts[i]) || names.has(`${folder}.jsonl`)) part = true;
    }
    out.set(f.rel, part ? 'part' : SET_ASIDE.test(parts[parts.length - 1]) ? 'aside' : 'read');
  }
  return out;
}

/** A transcript of the project at `rel`: every folder on its way a real folder (never a link), the file a regular file.
 *  Returns { abs, name } or { refused: kind, why }. */
export function transcriptAt(projectDir, rel) {
  const parts = relParts(rel);
  if (!parts) return { refused: 'bad-name', why: `${JSON.stringify(rel)} is not the path of a transcript in a project (plain names joined by /, ending in .jsonl)` };
  let at = projectDir;
  for (let i = 0; i < parts.length - 1; i++) {
    at = path.join(at, parts[i]);
    const k = kind(at);
    if (k !== 'dir') return { refused: 'no-session', why: `${parts.slice(0, i + 1).join('/')} is not a folder${k === 'link' ? ' (a symbolic link is not followed)' : ''}` };
  }
  const abs = path.join(at, parts[parts.length - 1]), k = kind(abs);
  if (k !== 'file') return { refused: 'no-session', why: k === 'none' ? `no file ${rel}: it may have been removed by Claude Code's cleanup` : `${rel} is not a regular file${k === 'link' ? ' (a symbolic link is not followed)' : ''}` };
  return { abs, name: parts[parts.length - 1] };
}

/** The session a transcript's name stands for: its name without .jsonl, or, for a set-aside copy, the session's. */
export const sessionStem = (name) => SET_ASIDE.exec(name)?.[1] ?? name.slice(0, -'.jsonl'.length);

/** A session's own folder, by ltms's rule: <folder of the file>/<its session's name>. { folder (its path in the project,
 *  or null), kind: 'dir' | 'link' | 'none' }. */
export function ownFolder(projectDir, rel) {
  const parts = relParts(rel);
  if (!parts) return { folder: null, kind: 'none' };
  const stem = sessionStem(parts[parts.length - 1]);
  if (!isName(stem)) return { folder: null, kind: 'none' };
  const own = [...parts.slice(0, -1), stem].join('/');
  const k = kind(path.join(projectDir, ...own.split('/')));
  return { folder: k === 'dir' ? own : null, kind: k === 'dir' || k === 'link' ? k : 'none' };
}

/**
 * The agent transcripts of the session at `rel`: every agent-*.jsonl at any depth of its own folder, oldest first (ltms
 * index counts the same files). Each: { file (its path in the project), name, group (its folder under the session's own,
 * such as subagents or subagents/workflows/<run>), bytes, mtime, openable }. `known` is false where ltms index gives the
 * count as null: the own folder is itself a symbolic link, or one was met in it, or a folder in it could not be listed.
 * A name that is not UTF-8 is counted, as ltms counts it, and cannot be opened.
 */
export function agentsOf(projectDir, rel) {
  const own = ownFolder(projectDir, rel);
  if (own.kind === 'link') return { agents: [], known: false, folder: null };
  if (own.folder === null) return { agents: [], known: true, folder: null };
  const w = walk(path.join(projectDir, ...own.folder.split('/')), { under: own.folder });
  const of = (file, extra) => ({ file, name: file.slice(file.lastIndexOf('/') + 1), group: file.slice(own.folder.length + 1, file.lastIndexOf('/')), ...extra });
  const agents = [
    ...w.files.filter((f) => AGENT_NAME.test(f.rel.slice(f.rel.lastIndexOf('/') + 1))).map((f) => of(f.rel, { bytes: f.size, mtime: f.mtimeMs, openable: true })),
    ...w.lossy.filter((r) => AGENT_NAME.test(r.slice(r.lastIndexOf('/') + 1))).map((r) => of(r, { bytes: null, mtime: null, openable: false })),
  ].sort((a, b) => (a.mtime ?? Infinity) - (b.mtime ?? Infinity) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { agents, known: w.links === 0 && w.unreadable === 0, folder: own.folder };
}

/** The session whose own folder holds the transcript at `rel` (an agent's): the nearest folder on its path with
 *  <folder>.jsonl beside it, or a set-aside copy of it (<folder>.orphaned-….jsonl, <folder>.superseded-….jsonl). Its
 *  path in the project, or null. */
export function parentOf(projectDir, rel) {
  const parts = relParts(rel);
  if (!parts) return null;
  for (let i = parts.length - 2; i >= 0; i--) {
    const at = parts.slice(0, i), name = parts[i];
    if (kind(path.join(projectDir, ...at, `${name}.jsonl`)) === 'file') return [...at, `${name}.jsonl`].join('/');
    let beside = [];
    try { beside = readdirSync(path.join(projectDir, ...at), { withFileTypes: true }); } catch {}
    const aside = beside.filter((e) => e.isFile() && SET_ASIDE.exec(e.name)?.[1] === name).map((e) => e.name).sort();
    if (aside.length) return [...at, aside[0]].join('/');
  }
  return null;
}

/** A name that stands for one transcript: a session's (a UUID) or an agent's (agent-<id>). Only such names are grouped
 *  as copies; a workflow's journal.jsonl, say, has the same name in every run. */
export const identifies = (name) => UUID_NAME.test(name.slice(0, -'.jsonl'.length)) || AGENT_NAME.test(name);

/** The order in which copies are chosen: the fewest folders first (Claude Code keeps a session at its project's top, an
 *  agent in its session's folder), then by path. */
export const byPlace = (a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0);
