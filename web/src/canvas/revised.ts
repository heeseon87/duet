import { diffMaps, type CanvasMap } from '../../../shared/canvas.ts'

/** The agent's last revision, unless it is the map's first: there every box is new, so a mark would say nothing. */
export function lastAgentRevision(history: { revision: number; by: 'agent' | 'person' }[]): number | undefined {
  const last = history.findLast(h => h.by === 'agent')
  return last && last.revision > 1 ? last.revision : undefined
}

/**
 * The boxes of a class map the agent added or changed in one revision (`before` → `after`) that `current` still shows
 * as the agent left them. A later edit, a restore or a removal takes a box's mark away; choosing a decision does not,
 * as it leaves the boxes that stay untouched. Packages are not boxes. The revision that first draws on an empty map
 * marks nothing, like the map's first revision: there every box is new.
 */
export function revisedBoxes(before: CanvasMap, after: CanvasMap, current: CanvasMap): string[] {
  if (current.diagram !== 'class' || !before.elements.some(e => e.kind !== 'group')) return []
  const d = diffMaps(before, after)
  const left = new Map(after.elements.map(e => [e.id, JSON.stringify(e)]))
  return current.elements
    .filter(e => e.kind !== 'group' && (d.addedElements.has(e.id) || d.changedElements.has(e.id)) && left.get(e.id) === JSON.stringify(e))
    .map(e => e.id)
}
