import { registry } from '../review/FindBar.tsx'

/**
 * Marks painted with the CSS highlight API by one code column. Every column adds its ranges to the same highlight per
 * name, so the CSS names stay static (`duet-word`, `duet-var-N[-f]`, `duet-kw`, `duet-link`…) and a column that goes
 * away takes only its own marks with it.
 */
export type Painter = { set(name: string, ranges: Range[]): void; clear(name?: string): void }

export function painter(): Painter {
  const mine = new Map<string, Range[]>()
  const set = (name: string, ranges: Range[]) => {
    const reg = registry()
    if (!reg) return
    let shared = reg.highlights.get(name)
    for (const r of mine.get(name) ?? []) shared?.delete(r)
    if (ranges.length) {
      if (!shared) reg.highlights.set(name, (shared = new reg.Highlight()))
      for (const r of ranges) shared.add(r)
      mine.set(name, ranges)
    } else mine.delete(name)
    // An empty highlight is dropped, so `CSS.highlights.has(name)` still says whether anything is painted.
    if (shared && !shared.size) reg.highlights.delete(name)
  }
  return { set, clear: name => { for (const n of name ? [name] : [...mine.keys()]) set(n, []) } }
}
