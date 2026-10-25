import type { CanvasElement, CanvasMap } from './canvas.ts'
import { fileOfRef } from './canvas.ts'

/** Map file references are relative to the workspace (`home`); diff paths are relative to the tree under review (`root`). */
export const absoluteRef = (home: string, ref: string) => (ref.startsWith('/') ? ref : `${home}/${fileOfRef(ref).replace(/^\.\//, '')}`)

/**
 * The changed files each element names itself (not those of the parts inside it), by element id. One matcher for the
 * review's map layout and the canvas's code marks, so the two never disagree on which file belongs to which part.
 */
export function ownFiles<F extends { path: string }>(map: CanvasMap, files: F[], root: string, home: string): Map<string, F[]> {
  const byAbs = new Map(files.map(f => [`${root}/${f.path}`, f]))
  const out = new Map<string, F[]>()
  for (const el of map.elements) {
    const own = [...new Set((el.files ?? []).map(r => absoluteRef(home, r)))].map(a => byAbs.get(a)).filter((f): f is F => !!f)
    if (own.length) out.set(el.id, own)
  }
  return out
}

/**
 * How a part stands against its map's code: `built` (its files changed, as planned), `unplanned` (its files changed
 * though the map marks no change on it), `pending` (a change is planned and none of its files changed yet).
 * `paths` lists the changed files of the part and everything inside it, each once; `viewed`, how many of those the
 * review marks viewed.
 */
export type CodeMark = { state: 'built' | 'unplanned' | 'pending'; paths: string[]; viewed: number }

const planned = (el: CanvasElement) =>
  el.change === 'add' || el.change === 'modify' || el.change === 'delete' || (el.members ?? []).some(m => m.change)

/**
 * Every part's mark, and how many changed files no part names. `pending: false` (one turn of the map's code) leaves out
 * "not built yet": a part that turn did not touch may well be built. `viewed` holds the paths the review marks viewed.
 */
export function codeMarks(map: CanvasMap, files: { path: string }[], root: string, home: string, o: { pending?: boolean; viewed?: Set<string> } = {}): { marks: Map<string, CodeMark>; outside: number } {
  const own = ownFiles(map, files, root, home)
  const ids = new Set(map.elements.map(e => e.id))
  const children = new Map<string, CanvasElement[]>()
  for (const el of map.elements) if (el.parent && ids.has(el.parent)) children.set(el.parent, [...(children.get(el.parent) ?? []), el])
  const marks = new Map<string, CodeMark>()
  const used = new Set<string>()
  const walk = (el: CanvasElement): Set<string> => {
    const all = new Set((own.get(el.id) ?? []).map(f => f.path))
    for (const p of all) used.add(p)
    for (const c of children.get(el.id) ?? []) for (const p of walk(c)) all.add(p)
    const group = el.kind === 'group'
    const viewed = [...all].filter(p => o.viewed?.has(p)).length
    if (all.size) marks.set(el.id, { state: group || planned(el) ? 'built' : 'unplanned', paths: [...all], viewed })
    else if (!group && planned(el) && o.pending !== false) marks.set(el.id, { state: 'pending', paths: [], viewed: 0 })
    return all
  }
  for (const el of map.elements) if (!el.parent || !ids.has(el.parent)) walk(el)
  return { marks, outside: files.filter(f => !used.has(f.path)).length }
}
