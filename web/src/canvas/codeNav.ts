// What the code columns show and how they move: the live column's view of the picked part, its history (back and
// forward), the pinned files beside it, and how much room each gets. Pure, so the store and the tests share it.

import { relationKey, type CanvasElement, type CanvasMap } from '../../../shared/canvas.ts'
import { callName, seekOfVia, usesOf, type PartLink, type Seek } from './codeLinks.ts'

/** One file read for a part. `ref` is set only when a person picked it (a tab, the menu); otherwise refsFor(...)[0]. */
export type Doc = { part: string; ref?: string; seek?: Seek }
/** The live column: one part's code, or a relation's or message's two ends (from first: above, or left when side by side). */
export type LiveView = { target: string; docs: [Doc] | [from: Doc, to: Doc] }
/** A place in history. `at` is the top line of each doc when the reader left it; `nonce` makes a re-visit scroll again. */
export type Entry = { view: LiveView; at?: number[]; nonce: number }
/** The live column's history. entries[index] is shown; index -1 shows nothing (no pick yet). */
export type Trail = { entries: Entry[]; index: number }
/**
 * A file kept beside the live column: its root and path, not a part id, so map edits, map switches and a map bound to
 * another repository leave it readable. No history: it never moves. Reopens at `line` after ⌘2 or a reload.
 */
export type Pin = { id: string; root: string; path: string; line: number; label: string; width: number }

export const EMPTY: Trail = { entries: [], index: -1 }
export const HISTORY = 50, MAX_PINS = 3, MIN_WIDTH = 320, STAGE_MIN = 360

/** What zooming to a part brings on screen: a line comes with the boxes at its ends; a message alone (its ends are whole lifelines). */
export function partIds(map: CanvasMap, target: string): string[] {
  const rel = map.relations.find(r => relationKey(r) === target)
  return rel ? [rel.from, rel.to, target] : [target]
}

/** Whether the map draws this target: a box, a package, a relation or a message. */
export const isPart = (map: CanvasMap, id: string | undefined): id is string =>
  Boolean(id && (map.elements.some(e => e.id === id) || map.relations.some(r => relationKey(r) === id) || map.messages?.some(m => m.id === id)))

/** A box's own declaration: found if it is there, else the box's lines or the top, quietly. */
const ownDeclaration = (el?: CanvasElement): Seek | undefined => el && el.kind !== 'group' ? { names: [el.id, ...(el.label ? [el.label] : [])], kind: 'type', soft: true } : undefined
const doc = (part: string, seek?: Seek): Doc => (seek ? { part, seek } : { part })

/**
 * What picking a target shows. A box: its declaration. A package: the files under it. A relation: its two ends, `from`
 * where it uses what the label names (`isActive(uid)` → `subscribePaymentService.isActive(`) and `to` at that name's
 * declaration, each falling back to the code its `via` names and to `to`'s own declaration. A message: the sender at the
 * call, the receiver at the function called. Undefined for what has no code (a decision pin, nothing).
 */
export function viewOf(map: CanvasMap, target: string): LiveView | undefined {
  const byId = (id?: string) => map.elements.find(e => e.id === id)
  const el = byId(target)
  if (el) return { target, docs: [doc(target, ownDeclaration(el))] }
  const rel = map.relations.find(r => relationKey(r) === target)
  if (rel) {
    const to = byId(rel.to) ?? { id: rel.to }, uses = usesOf(rel.label, to)
    const from = doc(rel.from, seekOfVia(rel.via, to, uses.map(u => u.name)))
    const used = uses.reduceRight<Seek | undefined>((or, u) => ({ names: [u.name], kind: u.kind, ...(or && { or }) }), ownDeclaration(to))
    return { target, docs: rel.from === rel.to ? [from] : [from, doc(rel.to, used)] }
  }
  const msg = map.messages?.find(m => m.id === target)
  if (!msg) return undefined
  const call = callName(msg.label)
  const called = call ? doc(msg.to ?? msg.from, { names: [call], kind: 'function' }) : doc(msg.to ?? msg.from, ownDeclaration(byId(msg.to)))
  if (!msg.to || msg.to === msg.from) return { target, docs: [msg.to ? called : doc(msg.from, ownDeclaration(byId(msg.from)))] }
  return { target, docs: [doc(msg.from, call ? { mention: call } : ownDeclaration(byId(msg.from))), called] }
}

/** What a link shows. A message → as picked on the map. A member or a type → its box's code, at that name's declaration. */
export function linkView(map: CanvasMap, link: PartLink): LiveView {
  if (link.target !== link.owner) return viewOf(map, link.target) ?? { target: link.target, docs: [{ part: link.owner }] }
  return { target: link.target, docs: [{ part: link.owner, seek: { names: [link.name], kind: link.kind } }] }
}

export const shown = (t: Trail): Entry | undefined => t.entries[t.index]

const sameSeek = (a?: Seek, b?: Seek) => JSON.stringify(a) === JSON.stringify(b)
const sameView = (a: LiveView, b: LiveView) =>
  a.target === b.target && a.docs.length === b.docs.length && a.docs.every((d, i) => d.part === b.docs[i].part && d.ref === b.docs[i].ref && sameSeek(d.seek, b.docs[i].seek))

/**
 * Move. Stamps `leaving` on the entry left, drops the forward entries, caps at HISTORY. Returns `t` itself when the shown
 * view already equals `view`.
 */
export function go(t: Trail, view: LiveView, leaving: number[] | undefined, nonce: number): Trail {
  const cur = shown(t)
  if (cur && sameView(cur.view, view)) return t
  const kept = t.entries.slice(0, t.index + 1)
  if (cur && leaving) kept[t.index] = { ...cur, at: leaving }
  const entries = [...kept, { view, nonce }].slice(-HISTORY)
  return { entries, index: entries.length - 1 }
}

/** Replace the shown view without a move (a tab picked, the menu's file). */
export function swap(t: Trail, view: LiveView): Trail {
  const cur = shown(t)
  if (!cur || sameView(cur.view, view)) return t
  const entries = [...t.entries]
  entries[t.index] = { view, nonce: cur.nonce }
  return { entries, index: t.index }
}

/** Step back or forward, skipping entries whose target left the map. Gives a fresh nonce. Returns `t` when there is nowhere to go. */
export function step(t: Trail, by: -1 | 1, alive: (target: string) => boolean, leaving: number[] | undefined, nonce: number): Trail {
  let i = t.index + by
  while (i >= 0 && i < t.entries.length && !alive(t.entries[i].view.target)) i += by
  if (i < 0 || i >= t.entries.length) return t
  const entries = [...t.entries]
  if (leaving && t.index >= 0) entries[t.index] = { ...entries[t.index], at: leaving }
  entries[i] = { ...entries[i], nonce }
  return { entries, index: i }
}

/** Add a pin. The same root and path again updates its line rather than adding. Past MAX_PINS the oldest goes. */
export function addPin(pins: Pin[], pin: Omit<Pin, 'id'>, id: string): Pin[] {
  const same = pins.findIndex(p => p.root === pin.root && p.path === pin.path)
  if (same >= 0) return pins.map((p, i) => (i === same ? { ...p, line: pin.line } : p))
  return [...pins, { ...pin, id }].slice(-MAX_PINS)
}

/** The folds to open so a part is drawn: its folded ancestors only, unlike soloExpand. Undefined when it is drawn already. */
export function unfoldFor(map: CanvasMap, collapsed: ReadonlySet<string>, id: string): Set<string> | undefined {
  const parent = new Map(map.elements.map(e => [e.id, e.parent]))
  const next = new Set(collapsed)
  for (let p = parent.get(id); p; p = parent.get(p)) next.delete(p)
  return next.size === collapsed.size ? undefined : next
}

/**
 * Column widths, map first. The live column keeps its width, clamped as the single pane was. Pins, newest first, share
 * what is left above STAGE_MIN, each between MIN_WIDTH and its own width. A pin that doesn't fit is undefined (hidden,
 * still kept); the map never goes below STAGE_MIN for a pin.
 */
export function layoutColumns(room: number, live: number | undefined, pins: number[]): { live?: number; pins: (number | undefined)[]; hidden: number } {
  const liveWidth = live === undefined ? undefined : Math.round(Math.max(MIN_WIDTH, Math.min(live, room - STAGE_MIN)))
  const left = room - STAGE_MIN - (liveWidth ?? 0)
  const fit = Math.max(0, Math.min(pins.length, Math.floor(left / MIN_WIDTH)))
  const shown = pins.slice(pins.length - fit)
  // As much of its own width as each can have: the narrowest wants are met first, the rest share what remains.
  const widths = new Map<number, number>()
  let free = left, waiting = shown.map((w, i) => ({ w, i })).sort((a, b) => a.w - b.w)
  while (waiting.length) {
    const share = free / waiting.length
    const met = waiting.filter(p => p.w <= share)
    if (!met.length) { for (const p of waiting) widths.set(p.i, Math.floor(share)); break }
    for (const p of met) { widths.set(p.i, Math.round(p.w)); free -= p.w }
    waiting = waiting.filter(p => p.w > share)
  }
  const out = pins.map((_, i) => (i < pins.length - fit ? undefined : widths.get(i - (pins.length - fit))))
  return { live: liveWidth, pins: out, hidden: pins.length - fit }
}

/** The blocks of changed lines: each run of consecutive line numbers as its first and last line, top to bottom. */
export function blocksOf(changed: Iterable<number>): [number, number][] {
  const out: [number, number][] = []
  for (const n of [...changed].sort((a, b) => a - b)) {
    const last = out.at(-1)
    if (last && n <= last[1] + 1) last[1] = Math.max(last[1], n)
    else out.push([n, n])
  }
  return out
}

/**
 * The first line of the next (`dir` 1) or previous block of changed lines from `line`, round the file's end as an
 * editor's "next change" does. A line inside a block goes back to that block's start first. Undefined with none.
 */
export function nextBlock(changed: Iterable<number>, line: number, dir: -1 | 1): number | undefined {
  const starts = blocksOf(changed).map(([first]) => first)
  if (!starts.length) return undefined
  return dir > 0 ? (starts.find(s => s > line) ?? starts[0]) : (starts.findLast(s => s < line) ?? starts.at(-1))
}

/** Pins as remembered; anything malformed is dropped. */
export function parsePins(json: string | null): Pin[] {
  try {
    const v: unknown = JSON.parse(json ?? '[]')
    if (!Array.isArray(v)) return []
    const ok = (p: Record<string, unknown>) =>
      typeof p.id === 'string' && typeof p.root === 'string' && typeof p.path === 'string' && typeof p.label === 'string' && Number.isFinite(p.line) && Number.isFinite(p.width)
    return v.filter((p): p is Pin => Boolean(p) && typeof p === 'object' && ok(p as Record<string, unknown>)).slice(-MAX_PINS)
  } catch {
    return []
  }
}
