// A class map's flow: the relations numbered with `step` (①②③), listed beside the map and walked one step at a time.

import { relationKey, type CanvasMap, type CanvasRelation } from '../../../shared/canvas.ts'

/** The flow's steps in order; steps sharing a number keep the map's order. */
export function flowSteps(map: CanvasMap): CanvasRelation[] {
  if (map.diagram !== 'class') return []
  return map.relations.filter(r => r.step).sort((a, b) => a.step! - b.step!)
}

/**
 * The step to go to from the picked part: the next (`1`) or previous (`-1`) one, or from outside the flow the first
 * (last). Nothing past either end.
 */
export function stepFrom(steps: CanvasRelation[], selected: string | undefined, dir: 1 | -1): string | undefined {
  const keys = steps.map(relationKey)
  const i = selected ? keys.indexOf(selected) : -1
  if (i < 0) return dir > 0 ? keys[0] : keys.at(-1)
  return keys[i + dir]
}
