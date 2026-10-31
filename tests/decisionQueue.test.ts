import { describe, expect, it } from 'vitest'
import type { CanvasDecision } from '../shared/canvas.ts'
import { nextDecision, withDecision } from '../web/src/canvas/decisionQueue.ts'

const d = (id: string, chosen?: string): CanvasDecision => ({ id, question: id, options: [{ id: `${id}-a`, text: 'a' }, { id: `${id}-b`, text: 'b' }], ...(chosen ? { chosen: `${id}-${chosen}` } : {}) })

describe('nextDecision', () => {
  it('starts at the first open decision, in the map order', () => {
    expect(nextDecision([d('D1', 'a'), d('D2'), d('D3')], undefined, [])).toBe('D2')
  })

  it('goes to the next open one, round past the end', () => {
    const all = [d('D1'), d('D2', 'a'), d('D3')]
    expect(nextDecision(all, 'D1', [])).toBe('D3')
    expect(nextDecision(all, 'D3', [])).toBe('D1')
  })

  it('leaves one put off for later until nothing else is open', () => {
    expect(nextDecision([d('D1'), d('D2'), d('D3')], 'D1', ['D2'])).toBe('D3')
    expect(nextDecision([d('D1', 'a'), d('D2'), d('D3', 'b')], 'D3', ['D2'])).toBe('D2')
    // Put off while it is the only one left: it stays.
    expect(nextDecision([d('D1', 'a'), d('D2')], 'D2', ['D2'])).toBe('D2')
  })

  it('has nothing after the last one is made, nor on a map without decisions', () => {
    expect(nextDecision([d('D1', 'a'), d('D2', 'b')], 'D2', [])).toBeUndefined()
    expect(nextDecision([], undefined, [])).toBeUndefined()
  })
})

describe('withDecision', () => {
  it('adds once, at the end, and takes out', () => {
    expect(withDecision(['D1', 'D2'], 'D1', true)).toEqual(['D2', 'D1'])
    expect(withDecision(['D1', 'D2'], 'D1', false)).toEqual(['D2'])
    expect(withDecision([], 'D3', false)).toEqual([])
  })
})
