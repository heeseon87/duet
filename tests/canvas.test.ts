import { describe, expect, it } from 'vitest'
import { applyPatch, chooseOption, deliveryLabel, deliveryOf, describeDiff, diffMaps, emptyMap, normalizeDecisions, relationKey, reopenDecision, reorderedGroups, safeText, toMermaid, validate, type CanvasMap } from '../shared/canvas.ts'

function base(): CanvasMap {
  const m = emptyMap('class', 'test')
  return applyPatch(m, {
    elements: [
      { id: 'grp', kind: 'group' },
      { id: 'A', parent: 'grp' },
      { id: 'B', parent: 'grp' },
      { id: 'C' },
    ],
    relations: [{ from: 'A', to: 'B', label: 'calls' }, { from: 'B', to: 'C', kind: 'dependency' }],
    decisions: [{ id: 'D1', question: 'which?', options: [{ id: 'D1-a', text: 'keep' }, { id: 'D1-b', text: 'split' }] }],
  }, 'agent').map
}

describe('applyPatch', () => {
  it('upserts by id and clears fields with null', () => {
    const m = applyPatch(base(), { elements: [{ id: 'A', label: 'Alpha', note: 'n' }] }, 'agent').map
    expect(m.elements.find(e => e.id === 'A')).toMatchObject({ label: 'Alpha', note: 'n', parent: 'grp' })
    const cleared = applyPatch(m, { elements: [{ id: 'A', note: null }] }, 'agent').map
    expect(cleared.elements.find(e => e.id === 'A')?.note).toBeUndefined()
  })

  it('removes an element with its relations, and lifts children out of a removed group', () => {
    const res = applyPatch(base(), { remove: { elements: ['B', 'grp'] } }, 'agent')
    expect(res.map.elements.map(e => e.id).sort()).toEqual(['A', 'C'])
    expect(res.map.elements.find(e => e.id === 'A')?.parent).toBeUndefined()
    expect(res.map.relations).toEqual([])
    expect(res.errors).toEqual([])
  })

  it('removes a relation by from/to/kind', () => {
    const res = applyPatch(base(), { relations: [{ from: 'B', to: 'C', kind: 'dependency', remove: true }] }, 'agent')
    expect(res.map.relations.map(relationKey)).toEqual(['A->B:association'])
  })

  it('never lets the agent choose a decision', () => {
    const res = applyPatch(base(), { decisions: [{ id: 'D1', chosen: 'D1-a' }] }, 'agent')
    expect(res.map.decisions?.[0].chosen).toBeUndefined()
    expect(res.notes.join(' ')).toMatch(/only the person/)
  })

  it('moves an element next to a sibling with before/after, and keeps the fields out of the map', () => {
    const ids = (m: CanvasMap) => m.elements.map(e => e.id)
    const moved = applyPatch(base(), { elements: [{ id: 'B', before: 'A' }] }, 'person').map
    expect(ids(moved)).toEqual(['grp', 'B', 'A', 'C'])
    expect(moved.elements.find(e => e.id === 'B')).not.toHaveProperty('before')
    expect(ids(applyPatch(moved, { elements: [{ id: 'B', after: 'A' }] }, 'person').map)).toEqual(['grp', 'A', 'B', 'C'])
    // A new element can be placed at once.
    expect(ids(applyPatch(base(), { elements: [{ id: 'Z', parent: 'grp', before: 'A' }] }, 'agent').map)).toEqual(['grp', 'Z', 'A', 'B', 'C'])
    const away = applyPatch(base(), { elements: [{ id: 'A', before: 'Nope' }] }, 'person')
    expect(ids(away.map)).toEqual(['grp', 'A', 'B', 'C'])
    expect(away.notes.join(' ')).toMatch(/order kept/)
    expect(applyPatch(base(), { elements: [{ id: 'C', before: 'A' }] }, 'person').notes.join(' ')).toMatch(/another group/)
  })

  it('tells which groups changed order, ignoring added and removed parts', () => {
    expect(reorderedGroups(base(), applyPatch(base(), { elements: [{ id: 'B', before: 'A' }] }, 'person').map)).toEqual(['grp'])
    expect(reorderedGroups(base(), applyPatch(base(), { elements: [{ id: 'grp', after: 'C' }] }, 'person').map)).toEqual([''])
    expect(reorderedGroups(base(), applyPatch(base(), { elements: [{ id: 'Z', parent: 'grp' }], remove: { elements: ['C'] } }, 'agent').map)).toEqual([])
  })

  it('reports invalid references instead of writing them', () => {
    const res = applyPatch(base(), { relations: [{ from: 'A', to: 'Nope' }], elements: [{ id: 'bad id' }] }, 'agent')
    expect(res.errors.some(e => e.includes('Nope'))).toBe(true)
    expect(res.errors.some(e => e.includes('bad id'))).toBe(true)
  })
})

describe('chooseOption', () => {
  const forked = () => applyPatch(base(), {
    elements: [{ id: 'Keep', decision: 'D1', option: 'D1-a' }, { id: 'Split', decision: 'D1', option: 'D1-b' }, { id: 'A', decision: 'D1' }],
    relations: [{ from: 'A', to: 'Split' }, { from: 'A', to: 'Keep', decision: 'D1', option: 'D1-a' }, { from: 'B', to: 'C', kind: 'dependency', decision: 'D1', option: 'D1-b' }],
  }, 'agent').map

  it('drops the other options with their lines, and keeps the tags on what the choice shaped', () => {
    const chosen = chooseOption(forked(), 'D1', 'D1-a', 'simpler')
    expect(chosen.elements.map(e => e.id)).not.toContain('Split')
    expect(chosen.elements.find(e => e.id === 'Keep')).toMatchObject({ decision: 'D1', option: 'D1-a' })
    expect(chosen.elements.find(e => e.id === 'A')).toMatchObject({ decision: 'D1' })
    expect(chosen.relations.map(relationKey)).toEqual(['A->B:association', 'A->Keep:association'])
    expect(chosen.relations.find(r => r.to === 'Keep')).toMatchObject({ decision: 'D1', option: 'D1-a' })
    expect(chosen.decisions?.[0]).toMatchObject({ chosen: 'D1-a', rationale: 'simpler' })
    expect(validate(chosen)).toEqual([])
  })

  it('reopens with the chosen path still tagged; a new choice then drops it', () => {
    const reopened = reopenDecision(chooseOption(forked(), 'D1', 'D1-a', 'simpler'), 'D1')
    expect(reopened.decisions?.[0].chosen).toBeUndefined()
    expect(reopened.decisions?.[0].rationale).toBeUndefined()
    expect(reopened.elements.find(e => e.id === 'Keep')).toMatchObject({ decision: 'D1', option: 'D1-a' })
    expect(validate(reopened)).toEqual([])
    const redrawn = applyPatch(reopened, { elements: [{ id: 'Split', decision: 'D1', option: 'D1-b' }] }, 'agent').map
    const other = chooseOption(redrawn, 'D1', 'D1-b')
    expect(other.elements.map(e => e.id)).toContain('Split')
    expect(other.elements.map(e => e.id)).not.toContain('Keep')
  })

  it('rejects a tag on a made decision\'s lost option, and accepts its chosen one', () => {
    const made = chooseOption(forked(), 'D1', 'D1-a')
    const lost = applyPatch(made, { elements: [{ id: 'C', decision: 'D1', option: 'D1-b' }] }, 'agent')
    expect(lost.errors).toHaveLength(1)
    expect(lost.errors[0]).toMatch(/^C: D1 is decided/)
    expect(applyPatch(made, { elements: [{ id: 'C', decision: 'D1', option: 'D1-a' }] }, 'agent').errors).toEqual([])
    expect(applyPatch(made, { relations: [{ from: 'A', to: 'B', decision: 'D1' }] }, 'agent').errors).toEqual([])
  })
})

describe('deliveryOf', () => {
  const sent = { who: 'person' as const, ts: 100, messageId: 'm1' }
  const reply = (ts: number) => ({ who: 'agent' as const, ts })
  const revs = () => [
    { revision: 4, by: 'agent' as const, ts: 50 },
    { revision: 5, by: 'agent' as const, ts: 120 },
    { revision: 6, by: 'person' as const, ts: 130 },
    { revision: 7, by: 'agent' as const, ts: 140 },
    { revision: 8, by: 'agent' as const, ts: 300 },
  ]

  it('follows the live session while it holds the prompt, even after the agent spoke', () => {
    expect(deliveryOf([sent], 0, { state: 'queued', position: 2 }, revs)).toEqual({ state: 'queued', position: 2 })
    expect(deliveryOf([sent, reply(200)], 0, { state: 'working' }, revs)).toEqual({ state: 'working' })
  })

  it('is answered once the session lets go and the agent spoke, naming the agent\'s last revision in between', () => {
    expect(deliveryOf([sent, reply(200)], 0, undefined, revs)).toEqual({ state: 'answered', revision: 7 })
    expect(deliveryOf([sent, reply(110)], 0, undefined, revs)).toEqual({ state: 'answered' })
  })

  it('has ended with no answer when nothing came back, as after a restart', () => {
    expect(deliveryOf([sent], 0, undefined, revs)).toEqual({ state: 'ended' })
    expect(deliveryOf([reply(10), sent], 1, undefined, revs)).toEqual({ state: 'ended' })
  })

  it('says nothing about what was never sent', () => {
    expect(deliveryOf([{ who: 'person', ts: 1 }], 0, undefined, revs)).toBeUndefined()
    expect(deliveryOf([reply(1)], 0, { state: 'working' }, revs)).toBeUndefined()
  })

  it('reads in the canvas\'s words', () => {
    expect(deliveryLabel({ state: 'queued', position: 2 })).toBe('대기열 2번째')
    expect(deliveryLabel({ state: 'delivered' })).toBe('터미널에 전달함')
    expect(deliveryLabel({ state: 'working' })).toBe('작업 중')
    expect(deliveryLabel({ state: 'answered', revision: 33 })).toBe('답함 · rev 33 반영')
    expect(deliveryLabel({ state: 'answered' })).toBe('답함')
    expect(deliveryLabel({ state: 'ended' })).toBe('끝남 · 답 없음')
  })
})

describe('diffMaps', () => {
  it('finds added, removed and changed parts', () => {
    const a = base()
    const b = applyPatch(a, { elements: [{ id: 'D' }, { id: 'A', label: 'renamed' }], remove: { elements: ['C'] } }, 'agent').map
    const d = diffMaps(a, b)
    expect([...d.addedElements]).toEqual(['D'])
    expect([...d.removedElements.keys()]).toEqual(['C'])
    expect([...d.changedElements]).toEqual(['A'])
    expect([...d.removedRelations.keys()]).toEqual(['B->C:dependency'])
  })

  // A patch that touches only these used to leave no diff, so the store wrote no revision.
  it('finds map-level fields and fragments', () => {
    const a = base()
    for (const patch of [{ title: 'renamed' }, { context: 'why' }, { direction: 'LR' as const }]) {
      const field = Object.keys(patch)[0]
      expect(describeDiff(diffMaps(a, applyPatch(a, patch, 'agent').map), a)).toEqual([`~ ${field}`])
    }
    const seq = applyPatch(emptyMap('sequence', 'seq'), {
      elements: [{ id: 'A', kind: 'actor' }, { id: 'B' }],
      messages: [{ id: 'm1', from: 'A', to: 'B', label: 'ask' }, { id: 'm2', from: 'B', to: 'A', label: 'answer', kind: 'reply' }],
    }, 'agent').map
    const looped = applyPatch(seq, { fragments: [{ id: 'f1', kind: 'loop', label: 'retry', first: 'm1', last: 'm2' }] }, 'agent')
    expect(looped.errors).toEqual([])
    expect(describeDiff(diffMaps(seq, looped.map), looped.map)).toEqual(['~ fragment f1'])
    expect(describeDiff(diffMaps(looped.map, seq), seq)).toEqual(['~ fragment f1'])
  })
})

describe('Mermaid text', () => {
  it('escapes what Mermaid would swallow', () => {
    expect(safeText('List<Swing>: a')).toBe('List‹Swing›∶ a')
    expect(safeText('static$')).toBe('static＄')
    expect(safeText('say "hi" {x}')).toBe('say ″hi″ ❴x❵')
  })

  it('draws groups as namespaces and numbers steps', () => {
    // Same from/to/kind is the same relation: the second write updates the first.
    const m = applyPatch(base(), { relations: [{ from: 'A', to: 'B', label: 'calls', step: 1 }, { from: 'A', to: 'B', label: 'again' }] }, 'agent').map
    const plan = toMermaid(m)
    expect(plan.text).toContain('namespace grp {')
    expect(plan.text).toContain('A --> B : ① again')
  })

  it('folds a collapsed group into one box and merges the lines that meet there', () => {
    const m = applyPatch(base(), { relations: [{ from: 'A', to: 'C', kind: 'dependency', label: 'reads' }] }, 'agent').map
    const collapsed = toMermaid(m, { collapsed: new Set(['grp']) })
    expect(collapsed.text).toContain('class grp["grp"]')
    expect(collapsed.text).toContain('grp ..> C : reads')
    expect(collapsed.edgeOrder.find(k => k.includes('B->C'))).toContain('A->C')
  })
})

describe('normalizeDecisions', () => {
  const base = { schema: 1 as const, diagram: 'class' as const, title: 't', elements: [], relations: [] }
  it('reads the old "→ 확정 D2-a. 이유" line as the choice', () => {
    const m = normalizeDecisions({ ...base, decisions: [{ id: 'D2', question: '도메인으로 나눌까 → 확정 D2-a. 규칙이 한 곳에 모인다.', options: [{ id: 'D2-a', text: 'a' }, { id: 'D2-b', text: 'b', rejected: '섞인다' }] }] })
    expect(m.decisions![0]).toMatchObject({ chosen: 'D2-a', question: '도메인으로 나눌까', rationale: '규칙이 한 곳에 모인다.' })
  })
  it('does not guess from reasons alone, so a reopened decision stays open', () => {
    const m = normalizeDecisions({ ...base, decisions: [{ id: 'D7', question: '어떻게 할까', options: [{ id: 'D7-a', text: 'a', rejected: 'x' }, { id: 'D7-b', text: 'b' }] }] })
    expect(m.decisions![0].chosen).toBeUndefined()
  })
  it('ignores a "확정" line that names no option of the decision', () => {
    const m = normalizeDecisions({ ...base, decisions: [{ id: 'D1', question: '고를까 → 확정 D9-z. 이유', options: [{ id: 'D1-a', text: 'a' }] }] })
    expect(m.decisions![0].chosen).toBeUndefined()
  })
  it('leaves an open decision open', () => {
    const d = { id: 'D1', question: '고를까', options: [{ id: 'D1-a', text: 'a' }, { id: 'D1-b', text: 'b' }] }
    expect(normalizeDecisions({ ...base, decisions: [d] }).decisions![0].chosen).toBeUndefined()
  })
})
