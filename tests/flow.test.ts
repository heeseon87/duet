import { describe, expect, it } from 'vitest'
import { emptyMap, relationKey, type CanvasMap } from '../shared/canvas.ts'
import { flowSteps, stepFrom } from '../web/src/canvas/flow.ts'

const map = (): CanvasMap => ({
  ...emptyMap('class', 'flow'),
  elements: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
  relations: [
    { from: 'C', to: 'D', label: 'save', step: 3 },
    { from: 'A', to: 'B', label: 'call', step: 1 },
    { from: 'A', to: 'D', kind: 'dependency', label: 'no step' },
    { from: 'B', to: 'C', label: 'first two', step: 2 },
    { from: 'B', to: 'D', label: 'second two', step: 2 },
  ],
})

describe('flowSteps', () => {
  it('lists the numbered relations in step order, ties in map order', () => {
    expect(flowSteps(map()).map(r => r.label)).toEqual(['call', 'first two', 'second two', 'save'])
  })

  it('has no flow on a sequence map', () => {
    expect(flowSteps({ ...map(), diagram: 'sequence' })).toEqual([])
  })
})

describe('stepFrom', () => {
  const steps = flowSteps(map())
  const keys = steps.map(relationKey)

  it('starts at the first step going forward and the last going back', () => {
    expect(stepFrom(steps, undefined, 1)).toBe(keys[0])
    expect(stepFrom(steps, 'A', 1)).toBe(keys[0])
    expect(stepFrom(steps, undefined, -1)).toBe(keys[3])
  })

  it('walks one step at a time and stops at either end', () => {
    expect(stepFrom(steps, keys[0], 1)).toBe(keys[1])
    expect(stepFrom(steps, keys[2], -1)).toBe(keys[1])
    expect(stepFrom(steps, keys[3], 1)).toBeUndefined()
    expect(stepFrom(steps, keys[0], -1)).toBeUndefined()
  })
})
