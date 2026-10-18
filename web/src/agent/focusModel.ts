// Focus: the same conversation through another lens. Each turn keeps what the person said, what
// waits for them, the agent's last words and the files it changed; the work in between (thinking,
// tool calls, words on the way) folds into one line that opens in place.

import type { Block } from './transcript.ts'

/** Cards that ask the person for something, or are a result in themselves, never fold. */
const ALWAYS = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** A request waiting on the person, here or inside a subagent's card (which then stays open in full). */
const waits = (b: Block): boolean =>
  (b.kind === 'tool' && (b.permission?.state === 'pending' || b.children.some(waits))) ||
  (b.kind === 'permission' && b.permission.state === 'pending')

const needsMe = (b: Block): boolean =>
  waits(b) || (b.kind === 'tool' && ALWAYS.has(b.name)) || (b.kind === 'notice' && b.level !== 'info')

const hasWords = (b: Block) => b.kind === 'text' && (b.text.trim().length > 0 || b.streaming)

export type Turn = {
  key: string; asked: Block[]; work: Block[]; mine: Block[]; answer?: Block; foot?: Block; later: Block[]; live: boolean
  /** Everything the agent did this turn, in order (no prompts, no foot): shown as is while the turn runs. */
  flow: Block[]
  /**
   * The finished turn, in order: what the agent said along the way and what waits for the person
   * stay; each run of work between them (thinking, tool calls) folds to one line.
   */
  parts: Part[]
}

export type Part = { kind: 'show'; block: Block } | { kind: 'work'; key: string; blocks: Block[] }

/** Split into turns (a new prompt, or the end of a turn, starts the next) and sort each turn's blocks. */
export function focusTurns(blocks: Block[], running: boolean): Turn[] {
  const groups: Block[][] = []
  let cur: Block[] = []
  for (const b of blocks) {
    if (b.kind === 'user' && !b.queued && cur.some(x => x.kind !== 'user')) { groups.push(cur); cur = [] }
    cur.push(b)
    if (b.kind === 'turn') { groups.push(cur); cur = [] }
  }
  if (cur.length) groups.push(cur)
  return groups.map((g, i) => {
    const live = running && i === groups.length - 1 && !g.some(b => b.kind === 'turn')
    // The answer is the turn's last words. While the turn runs, words count only while nothing came after them.
    let answer: Block | undefined
    if (live) {
      const last = g[g.length - 1]
      if (last && hasWords(last)) answer = last
    } else {
      for (let j = g.length - 1; j >= 0; j--) if (hasWords(g[j])) { answer = g[j]; break }
    }
    const t: Turn = { key: g[0].key, asked: [], work: [], mine: [], answer, later: [], live, flow: [], parts: [] }
    let started = false
    for (const b of g) {
      if (b === answer) { t.flow.push(b); started = true; continue }
      if (b.kind === 'user') {
        // A message queued while this turn ran belongs after it.
        if (started || b.queued) t.later.push(b)
        else t.asked.push(b)
        continue
      }
      started = true
      if (b.kind !== 'turn') t.flow.push(b)
      if (b.kind === 'turn') t.foot = b
      else if (needsMe(b)) t.mine.push(b)
      else t.work.push(b)
    }
    // Words and cards stay in place; the work between them folds, run by run.
    let run: Block[] = []
    const flush = () => { if (run.length) t.parts.push({ kind: 'work', key: run[0].key, blocks: run }); run = [] }
    for (const b of t.flow) {
      if (hasWords(b) || needsMe(b)) { flush(); t.parts.push({ kind: 'show', block: b }) }
      else run.push(b)
    }
    flush()
    return t
  })
}

