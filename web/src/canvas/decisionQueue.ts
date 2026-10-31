import type { CanvasDecision, CanvasMap } from '../../../shared/canvas.ts'

/**
 * The decision that decision mode shows after `from`: the next open one in the map's order, going round. One put off
 * ("나중에") waits until no other is left. Undefined once every decision is made: the mode shows its summary.
 */
export function nextDecision(decisions: CanvasDecision[], from: string | undefined, later: string[]): string | undefined {
  const at = decisions.findIndex(d => d.id === from)
  const order = [...decisions.slice(at + 1), ...decisions.slice(0, at + 1)].filter(d => !d.chosen)
  return (order.find(d => !later.includes(d.id)) ?? order.find(d => d.id !== from) ?? order[0])?.id
}

/** A list of decision ids with this one added (at the end) or taken out. */
export function withDecision(list: string[], id: string, keep: boolean): string[] {
  const rest = list.filter(x => x !== id)
  return keep ? [...rest, id] : rest
}

/** What one option of a decision brings: the parts tagged with it, and those the decision touches whichever way it goes. */
export function optionShare(map: CanvasMap, decision: string, option: string) {
  const mine = (x: { decision?: string; option?: string }) => x.decision === decision && (!x.option || x.option === option)
  return { elements: map.elements.filter(mine), relations: map.relations.filter(mine), messages: (map.messages ?? []).filter(mine) }
}
