// A part's note: what the agent (or the person) wrote about a box or a package, shown beside the map when it is picked.

import type { CanvasMap } from '../../../shared/canvas.ts'

/** The picked box's or package's note with its name; nothing for a line, a message, or a part without one. */
export function noteOf(map: CanvasMap, target: string | undefined): { label: string; note: string } | undefined {
  const el = target ? map.elements.find(e => e.id === target) : undefined
  const note = el?.note?.trim()
  return el && note ? { label: el.label ?? el.id, note } : undefined
}
