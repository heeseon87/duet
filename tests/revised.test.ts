import { describe, expect, it } from 'vitest'
import { applyPatch, chooseOption, emptyMap, type CanvasMap } from '../shared/canvas.ts'
import { lastAgentRevision, revisedBoxes } from '../web/src/canvas/revised.ts'

function before(): CanvasMap {
  return applyPatch(emptyMap('class', 't'), {
    elements: [{ id: 'grp', kind: 'group' }, { id: 'A', parent: 'grp' }, { id: 'B' }, { id: 'C' }],
    relations: [{ from: 'A', to: 'B' }],
  }, 'agent').map
}

describe('lastAgentRevision', () => {
  it('is the last revision the agent wrote, even under the person’s later ones', () => {
    expect(lastAgentRevision([{ revision: 1, by: 'agent' }, { revision: 2, by: 'agent' }, { revision: 3, by: 'person' }])).toBe(2)
  })

  it('is none for a map the agent only created, or never touched', () => {
    expect(lastAgentRevision([{ revision: 1, by: 'agent' }, { revision: 2, by: 'person' }])).toBeUndefined()
    expect(lastAgentRevision([{ revision: 1, by: 'person' }])).toBeUndefined()
    expect(lastAgentRevision([])).toBeUndefined()
  })
})

describe('revisedBoxes', () => {
  it('marks the boxes the agent added or changed, not packages or untouched boxes', () => {
    const after = applyPatch(before(), { elements: [{ id: 'grp', label: 'pkg' }, { id: 'A', note: 'n' }, { id: 'D' }] }, 'agent').map
    expect(revisedBoxes(before(), after, after).sort()).toEqual(['A', 'D'])
  })

  it('drops a box the person edited or removed later, and keeps the rest through a choice', () => {
    const after = applyPatch(before(), {
      elements: [{ id: 'A', note: 'n' }, { id: 'D', decision: 'D1', option: 'D1-a' }, { id: 'E', decision: 'D1', option: 'D1-b' }, { id: 'F' }],
      decisions: [{ id: 'D1', question: 'which?', options: [{ id: 'D1-a', text: 'a' }, { id: 'D1-b', text: 'b' }] }],
    }, 'agent').map
    const edited = applyPatch(after, { elements: [{ id: 'A', label: 'Alpha' }] }, 'person').map
    const chosen = chooseOption(edited, 'D1', 'D1-a')
    expect(revisedBoxes(before(), after, chosen).sort()).toEqual(['D', 'F'])
  })

  it('marks nothing when the revision first draws on an empty map', () => {
    const drawn = before()
    expect(revisedBoxes(emptyMap('class', 't'), drawn, drawn)).toEqual([])
    const onlyPackages = applyPatch(emptyMap('class', 't'), { elements: [{ id: 'grp', kind: 'group' }] }, 'agent').map
    expect(revisedBoxes(onlyPackages, drawn, drawn)).toEqual([])
  })

  it('marks nothing on a sequence map', () => {
    const seq = applyPatch(emptyMap('sequence', 't'), { elements: [{ id: 'A' }] }, 'agent').map
    expect(revisedBoxes(emptyMap('sequence', 't'), seq, seq)).toEqual([])
  })
})
