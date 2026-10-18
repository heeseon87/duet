import type { CanvasElement, CanvasMap } from '../../../shared/canvas.ts'
import { fileOfRef } from '../../../shared/canvas.ts'
import type { DiffFile } from '../../../shared/protocol.ts'

/** A package or a box of the map, with the changed files it points at. */
export type MapNode = {
  el: CanvasElement
  package: boolean
  /** Changed files this element itself points at. */
  files: DiffFile[]
  children: MapNode[]
  /** Changed files in this node and everything inside it, each once. */
  count: number
}

/** The files the review lists: those of a part of the map (absolute `paths`), then those matching the filter box. */
export function listedFiles(files: DiffFile[], root: string | undefined, scope: { paths: string[] } | undefined, filter: string): DiffFile[] {
  const scoped = scope && root ? files.filter(f => scope.paths.includes(`${root}/${f.path}`)) : files
  return filter ? scoped.filter(f => f.path.toLowerCase().includes(filter.toLowerCase())) : scoped
}

/** Map file references are relative to the workspace (`home`); diff paths are relative to the tree under review (`root`). */
const absolute = (home: string, ref: string) => (ref.startsWith('/') ? ref : `${home}/${fileOfRef(ref).replace(/^\.\//, '')}`)

/**
 * The changed files laid out the way the map is: packages, the boxes in them, the files each box
 * points at. A file a box shares with another shows under both. Files no box points at are `outside`;
 * `order` is the order on screen (each file once), for moving through them.
 */
export function mapGroups(map: CanvasMap, files: DiffFile[], root: string, home: string): { nodes: MapNode[]; outside: DiffFile[]; order: DiffFile[] } {
  const byAbs = new Map(files.map(f => [`${root}/${f.path}`, f]))
  const used = new Set<string>()
  const ids = new Set(map.elements.map(e => e.id))
  const build = (el: CanvasElement): MapNode | undefined => {
    const own = [...new Set((el.files ?? []).map(r => absolute(home, r)))].map(a => byAbs.get(a)).filter((f): f is DiffFile => !!f)
    const children = map.elements.filter(c => c.parent === el.id).map(build).filter((n): n is MapNode => !!n)
    if (!own.length && !children.length) return undefined
    for (const f of own) used.add(f.path)
    const all = new Set([...own.map(f => f.path), ...children.flatMap(paths)])
    return { el, package: el.kind === 'group', files: own, children, count: all.size }
  }
  const paths = (n: MapNode): string[] => [...n.files.map(f => f.path), ...n.children.flatMap(paths)]
  const nodes = map.elements.filter(e => !e.parent || !ids.has(e.parent)).map(build).filter((n): n is MapNode => !!n)
  const outside = files.filter(f => !used.has(f.path))
  const seen = new Set<string>()
  const order: DiffFile[] = []
  const walk = (n: MapNode) => {
    for (const f of n.files) if (!seen.has(f.path)) { seen.add(f.path); order.push(f) }
    n.children.forEach(walk)
  }
  nodes.forEach(walk)
  order.push(...outside)
  return { nodes, outside, order }
}
