// Which part of the map a name in the code stands for, and where a file opens for a part: the declaration of a name,
// a relation's evidence, a reference's lines. Pure, so the code columns, decision mode and the tests share one rule.

import { fileOfRef, filesUnder, relationKey, type CanvasElement, type CanvasMap } from '../../../shared/canvas.ts'
import { absoluteRef } from '../../../shared/mapFiles.ts'
import type { DiffResult } from '../../../shared/protocol.ts'
import { outlineOf, type OutlineItem, type SymbolKind } from './outline.ts'

export type DeclKind = 'type' | 'function' | 'field'
/** A name in code that stands for a part of the map. */
export type PartLink = {
  name: string
  /** What the map selects: a box, a participant, or a message. */
  target: string
  /** The box whose files declare the name: a member's box, a message's receiver (`to`). */
  owner: string
  kind: DeclKind
}

const NAME = /^[A-Za-z_$][\w$]*$/
const isName = (s: string) => s.length >= 2 && NAME.test(s)
const MODIFIER = /^(?:fun|val|var|def|let|const|static|abstract|final|override|open|suspend|async|public|private|protected|internal|readonly)\s+/

/** `+place(id: String): Group` → place · `-repo: Repo` → repo · `+String owner` → owner · `PENDING` → PENDING; prose and `<<interface>>` → undefined. */
function memberName(text: string): { name: string; kind: 'function' | 'field' } | undefined {
  let t = text.trim()
  if (t.startsWith('<<')) return undefined
  // Mermaid's visibility mark in front, its static ($) or abstract (*) mark behind, and its generics (~T~).
  t = t.replace(/^[+\-#~]\s*/, '').replace(/[$*]\s*$/, '').replace(/~[^~]*~/g, '')
  while (MODIFIER.test(t)) t = t.replace(MODIFIER, '')
  const fn = /([A-Za-z_$][\w$]*)\s*\(/.exec(t)
  if (fn) return { name: fn[1], kind: 'function' }
  const typed = /^([A-Za-z_$][\w$]*)\s*:/.exec(t)
  if (typed) return { name: typed[1], kind: 'field' }
  if (!/^[\w$<>[\],.?\s]+$/.test(t)) return undefined
  const last = t.match(/[A-Za-z_$][\w$]*/g)?.at(-1)
  return last ? { name: last, kind: 'field' } : undefined
}
/** A member line may list several names joined by `·` (`findByUserId · findByGroup`): each is read as its own member. */
const memberNames = (text: string) => text.split('·').flatMap(t => memberName(t) ?? [])

/** A message's call: the name its label starts with (`place(order)`, `repo.save(o)`), when a `(` follows or the label is that word alone. */
export function callName(label: string | undefined): string | undefined {
  const m = /^(?:[A-Za-z_$][\w$]*\s*(?:\?\.|\.|::|->)\s*)*([A-Za-z_$][\w$]*)\s*(?:\(|$)/.exec((label ?? '').trim().replace(/^\d+[.)]\s*/, ''))
  return m?.[1]
}

/** name → candidates in map order. Built once per map object, so every column shares it. */
type LinkIndex = ReadonlyMap<string, readonly PartLink[]>
const indexes = new WeakMap<CanvasMap, LinkIndex>()
function linkIndex(map: CanvasMap): LinkIndex {
  const known = indexes.get(map)
  if (known) return known
  const index = new Map<string, PartLink[]>()
  const add = (l: PartLink) => {
    if (!isName(l.name)) return
    const list = index.get(l.name) ?? []
    // A message calling the same function on the same receiver again is the same declaration.
    const message = (x: PartLink) => x.target !== x.owner
    if (!list.some(x => x.owner === l.owner && x.kind === l.kind && (x.target === l.target || (message(x) && message(l))))) index.set(l.name, [...list, l])
  }
  for (const el of map.elements) {
    if (el.kind === 'group') continue
    add({ name: el.id, target: el.id, owner: el.id, kind: 'type' })
    const label = el.label?.replace(/~[^~]*~|<[^>]*>/g, '').trim()
    if (label) add({ name: label, target: el.id, owner: el.id, kind: 'type' })
    for (const m of el.members ?? []) for (const n of memberNames(m.text)) add({ name: n.name, target: el.id, owner: el.id, kind: n.kind })
  }
  for (const m of map.messages ?? []) {
    const call = m.to ? callName(m.label) : undefined
    if (call) add({ name: call, target: m.id, owner: m.to!, kind: 'function' })
  }
  indexes.set(map, index)
  return index
}

/** The name a relation's `via` gives its evidence: `field orderRepository` → orderRepository. */
const viaName = (via: string | undefined) => /^\s*[A-Za-z]+\s+([A-Za-z_$][\w$]*)/.exec(via ?? '')?.[1]

/** The name at a character of a line of code, and the word before its `.`, `?.`, `::` or `->`. */
export function linkAt(text: string, offset: number): { name: string; receiver?: string } | undefined {
  const word = /[\w$]/
  if (!word.test(text[offset] ?? '')) return undefined
  let s = offset, e = offset + 1
  while (s > 0 && word.test(text[s - 1])) s--
  while (e < text.length && word.test(text[e])) e++
  const name = text.slice(s, e)
  if (!NAME.test(name)) return undefined
  const receiver = /([A-Za-z_$][\w$]*)\s*(?:\?\.|!!\.|\.|::|->)\s*$/.exec(text.slice(0, s))?.[1]
  return receiver ? { name, receiver } : { name }
}

/**
 * The parts a name may lead to, best first. `here` lists the parts whose own files hold the file being read.
 * With a receiver: a `via` of a relation from `here` naming it (→ that relation's `to`), then a type part it names (a
 * static call), then the rest. A box the receiver names this way is where the call goes even when its members do not
 * list the name: its file is searched for the declaration, and another box declaring the same name never wins over it.
 * Without a receiver (or `this`, `self`): `here`, then parts tied to `here` by a relation, then the rest. A receiver
 * the map does not know says nothing about its type, so it never picks by relation.
 * `sure` when the best non-empty tier holds exactly one link.
 */
export function resolveLink(map: CanvasMap, at: { name: string; receiver?: string; here: readonly string[] }): { links: PartLink[]; sure: boolean } {
  const index = linkIndex(map)
  const all = index.get(at.name) ?? []
  const here = new Set(at.here)
  const r = at.receiver
  const tiers: PartLink[][] = []
  const owned = (owners: Iterable<string>) => { const o = new Set(owners); return all.filter(l => o.has(l.owner)) }
  const into = (boxes: string[]): PartLink[] => {
    const listed = owned(boxes)
    if (listed.length || !isName(at.name)) return listed
    return [...new Set(boxes)].map(b => ({ name: at.name, target: b, owner: b, kind: 'function' }))
  }
  if (r && r !== 'this' && r !== 'self') {
    tiers.push(into(map.relations.filter(x => here.has(x.from) && viaName(x.via) === r).map(x => x.to)))
    tiers.push(into((index.get(r) ?? []).filter(l => l.kind === 'type').map(l => l.owner)))
  } else {
    tiers.push(owned(here))
    tiers.push(owned(map.relations.flatMap(x => (here.has(x.from) ? [x.to] : here.has(x.to) ? [x.from] : []))))
  }
  const top = tiers.find(t => t.length) ?? all
  if (!top.length) return { links: [], sure: false }
  return { links: [...top, ...all.filter(l => !top.includes(l))], sure: top.length === 1 }
}

/**
 * What a file is searched for once its text is in. A `soft` seek (a part's own declaration) gives way to a ref's span.
 * `uses`: where the file uses one of these names, in order (a relation's call). `or` is searched when this finds nothing.
 */
export type Seek = ({ names: string[]; kind: DeclKind; soft?: true } | { mention: string } | { uses: string[]; on: string[] }) & { or?: Seek }
/** The seek a miss is reported for: the last of an `or` chain. */
export const lastSeek = (s: Seek): Seek => (s.or ? lastSeek(s.or) : s)

/**
 * What a relation's label says its `from` end uses of `to`, in the label's order: a name a `(` follows at once
 * (`isActive(uid)`, not prose's `HOST (…)`), a member `to` lists (`findByUserId · existsByUserId`), or the label's one
 * word (`findById`).
 */
export function usesOf(label: string | undefined, to: CanvasElement): { name: string; kind: 'function' | 'field' }[] {
  const text = (label ?? '').trim()
  const listed = new Map((to.members ?? []).flatMap(m => memberNames(m.text)).map(m => [m.name, m.kind]))
  const out = new Map<string, 'function' | 'field'>()
  for (const m of text.matchAll(/(?<![\w$])([A-Za-z_$][\w$]*)(\()?/g)) {
    const kind = m[2] ? 'function' : (listed.get(m[1]) ?? (m[1] === text ? 'function' : undefined))
    if (kind && isName(m[1]) && !out.has(m[1])) out.set(m[1], kind)
  }
  return [...out].map(([name, kind]) => ({ name, kind }))
}

/**
 * A relation's evidence in its `from` file. `field x` and `constructor x` → x's declaration. Any other word → the first
 * use of its name (`extends AuditEntity` → AuditEntity). No via → the first use of `to`'s id. With the names its label
 * uses, the place it uses them comes first and the evidence is the fallback: reached through the variable the via names
 * or through `to`'s own name (`repo.save`, `Model.map`), else called (`save(`).
 */
export function seekOfVia(via: string | undefined, to: CanvasElement, uses: string[] = []): Seek {
  const m = /^\s*([A-Za-z]+)\s+([A-Za-z_$][\w$.]*)/.exec(via ?? '')
  const name = m && (m[2].split('.').filter(Boolean).at(-1) ?? to.id)
  const evidence: Seek = !m || !name ? { mention: to.id } : /^(field|constructor)$/i.test(m[1]) ? { names: [name], kind: 'field' } : { mention: name }
  if (!uses.length) return evidence
  const held = name && /^(field|constructor|param|local)$/i.test(m[1]) ? [name] : []
  return { uses, on: [...new Set([...held, to.id, to.label ?? ''])].filter(isName), or: evidence }
}

const DECL_KINDS: Record<DeclKind, readonly SymbolKind[]> = {
  type: ['class', 'struct', 'interface', 'enum', 'object', 'type', 'table', 'view', 'namespace'],
  function: ['function', 'method', 'constructor'],
  field: ['property', 'param', 'variable', 'column'],
}

/**
 * The lines a file opens on, and the word to light.
 *  - Name seek: an outline declaration with that name and kind, preferring one inside the ref's span. Then
 *    declarationOf for types (languages the outline does not read). Then an outline declaration with that name of
 *    any kind (a member listed bare, a call reached through its receiver). Then the first mention past the imports.
 *  - A soft seek on a ref with a span → the span; a soft seek lights nothing and never says it missed.
 *  - Uses seek: the first line past the imports reaching a name through `on` (`repo.save`), else calling it
 *    (`save(`) on a line that does not declare it; names in order.
 *  - Nothing found → its `or`, else the span, else the top, and `missed` names it.
 */
export function targetOf(lines: string[], path: string, ref: string, seek?: Seek): { rows?: [number, number]; lit?: string; missed?: string } {
  const span = linesOf(ref)
  if (!seek) return { rows: span }
  const found = lookup(lines, path, span, seek)
  return found.missed && seek.or ? targetOf(lines, path, ref, seek.or) : found
}

function lookup(lines: string[], path: string, span: [number, number] | undefined, seek: Seek): { rows?: [number, number]; lit?: string; missed?: string } {
  if ('uses' in seek) {
    const at = useOf(lines, path, seek)
    return at ? { rows: [at.line, at.line], lit: at.name } : { rows: span, lit: seek.uses[0], missed: seek.uses[0] }
  }
  if ('mention' in seek) {
    const at = firstUse(lines, seek.mention)
    return at ? { rows: [at, at], lit: seek.mention } : { rows: span, lit: seek.mention, missed: seek.mention }
  }
  if (seek.soft && span) return { rows: span }
  const named = outlineOf(lines, path)?.filter(it => seek.names.includes(it.name))
  const near = (items?: OutlineItem[]) => items?.find(it => span && it.line >= span[0] && it.line <= span[1]) ?? items?.[0]
  const found = near(named?.filter(it => DECL_KINDS[seek.kind].includes(it.kind)))?.line
    ?? (seek.kind === 'type' ? declarationOf(lines, seek.names) : undefined)
    ?? near(named)?.line
    ?? mentionOf(lines, seek.names)
  const lit = seek.soft ? undefined : seek.names[0]
  if (found) return { rows: [found, found], lit }
  return seek.soft ? { rows: span } : { rows: span, lit, missed: lit }
}

/** A part's refs, in the order a seek should try them: a type link's file named like the name (`OrderRepository.kt`) first. */
export function refsFor(map: CanvasMap, part: string, seek?: Seek): string[] {
  const refs = codeRefsOf(map, part)
  if (!seek || !('kind' in seek) || seek.kind !== 'type' || seek.soft) return refs
  const named = (r: string) => seek.names.includes(fileOfRef(r).split('/').pop()!.replace(/\.[^.]*$/, ''))
  return [...refs.filter(named), ...refs.filter(r => !named(r))]
}

/** The parts whose own `files` hold this file. */
export function partsOfFile(map: CanvasMap, file: { root: string; path: string }, base: string): string[] {
  const abs = `${file.root}/${file.path}`
  return map.elements.filter(e => (e.files ?? []).some(r => absoluteRef(base, r) === abs)).map(e => e.id)
}

/** The review's side of where a file is read: the tree it shows, and whether it shows this map's code. */
export type ReviewSide = { root?: string; diff?: DiffResult; bound?: { map: string }; editing: boolean }
export type Source = { root: string; path: string; ref: string; marks: boolean }

/** A file by its own root and path: at the review's version, its changed lines marked, when that root is the review's and the review shows this map; else on disk. */
export function pinSource(file: { root: string; path: string }, mapName: string | undefined, review: ReviewSide): Source {
  const { root, diff, bound, editing } = review
  const mine = Boolean(bound && bound.map === mapName && !editing && diff && root && file.root === root)
  return mine ? { root: file.root, path: file.path, ref: diff!.newRef, marks: true } : { root: file.root, path: file.path, ref: 'WORKTREE', marks: false }
}

/**
 * Where to read a file: in the code the review shows for this map (at that version, its changed lines marked) when the
 * map is bound and the file is in it, else as it is on disk in the review's tree or the workspace.
 */
export function sourceOf(abs: string, workspace: string, mapName: string | undefined, review: ReviewSide, codeRoot?: string): Source | undefined {
  // The map's own repository too: its files open from there while the review shows another tree.
  const r = [review.root, workspace, codeRoot].find(r => r && abs.startsWith(r + '/'))
  return r ? pinSource({ root: r, path: abs.slice(r.length + 1) }, mapName, review) : undefined
}

/** The file references a part stands for: a box's own (with their lines), a package's everything inside, a line's or a message's two ends'. */
function codeRefsOf(map: CanvasMap, target: string): string[] {
  const own = (id: string) => map.elements.find(e => e.id === id)?.files ?? []
  const el = map.elements.find(e => e.id === target)
  if (el) return el.kind === 'group' ? filesUnder(map, target) : own(target)
  const ends = map.relations.find(r => relationKey(r) === target) ?? map.messages?.find(m => m.id === target)
  return ends ? [...new Set([...own(ends.from ?? ''), ...own(ends.to ?? '')])] : []
}

/** `path:12` or `path:12-30`: the lines a reference points at. */
export function linesOf(ref: string): [number, number] | undefined {
  const m = /:(\d+)(?:-(\d+))?$/.exec(ref)
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : undefined
}

/** The line declaring a type (`class Store`, `interface Store`, `CREATE TABLE store`…), by names that are identifiers. */
function declarationOf(lines: string[], names: string[]): number | undefined {
  const ok = names.filter(n => NAME.test(n))
  if (!ok.length) return undefined
  const re = new RegExp(`\\b(?:class|interface|protocol|actor|enum|object|record|struct|trait|type|table)\\s+[\`"']?(?:${ok.join('|')})\\b`, 'i')
  const i = lines.findIndex(l => re.test(l))
  return i >= 0 ? i + 1 : undefined
}

const IMPORT = /^\s*(import|package|using|#include|from)\b/
const esc = (name: string) => name.replace(/\$/g, '\\$')
/** The first line past the imports that has the word, whole. */
function firstUse(lines: string[], word: string): number | undefined {
  const re = new RegExp(`(?<![\\w$])${esc(word)}(?![\\w$])`)
  const i = lines.findIndex(l => re.test(l) && !IMPORT.test(l))
  return i >= 0 ? i + 1 : undefined
}

/** Where a uses seek lands: its names reached through one of `on` first, then called anywhere but where they are declared. */
function useOf(lines: string[], path: string, { uses, on }: { uses: string[]; on: string[] }): { line: number; name: string } | undefined {
  const at = (re: RegExp, skip?: Set<number>) => {
    const i = lines.findIndex((l, i) => re.test(l) && !IMPORT.test(l) && !skip?.has(i + 1))
    return i >= 0 ? i + 1 : undefined
  }
  if (on.length) {
    const through = `(?<![\\w$])(?:${on.map(esc).join('|')})\\s*(?:\\?\\.|!!\\.|\\.|::|->)\\s*`
    for (const name of uses) {
      const line = at(new RegExp(`${through}${esc(name)}(?![\\w$])`))
      if (line) return { line, name }
    }
  }
  const outline = outlineOf(lines, path)
  for (const name of uses) {
    const line = at(new RegExp(`(?<![\\w$])${esc(name)}\\s*\\(`), new Set(outline?.filter(it => it.name === name).map(it => it.line)))
    if (line) return { line, name }
  }
  return undefined
}

/** A box named after a function or a file ("User.kt authorizeUser()"): the first line past the imports naming the longest word of its name. */
function mentionOf(lines: string[], names: string[]): number | undefined {
  const words = [...new Set(names.flatMap(n => n.match(/[A-Za-z_$][\w$]{3,}/g) ?? []))].sort((a, b) => b.length - a.length)
  for (const w of words) {
    const at = firstUse(lines, w)
    if (at) return at
  }
  return undefined
}
