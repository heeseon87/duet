import { describe, expect, it } from 'vitest'
import type { CanvasMap } from '../shared/canvas.ts'
import { EMPTY, HISTORY, addPin, go, layoutColumns, linkView, blocksOf, nextBlock, parsePins, partIds, shown, step, swap, unfoldFor, viewOf, type LiveView, type Trail } from '../web/src/canvas/codeNav.ts'

const map: CanvasMap = {
  schema: 1, diagram: 'class', title: 't',
  elements: [
    { id: 'svc', kind: 'group' }, { id: 'OrderService', parent: 'svc', files: ['src/OrderService.kt'] },
    { id: 'repo', kind: 'group' }, { id: 'inner', kind: 'group', parent: 'repo' },
    { id: 'OrderRepository', label: 'Repo', parent: 'inner', files: ['src/OrderRepository.kt'] },
  ],
  relations: [{ from: 'OrderService', to: 'OrderRepository', via: 'field orderRepository' }],
  decisions: [{ id: 'D1', question: 'q', options: [] }],
}
const rel = 'OrderService->OrderRepository:association'
const box = (target: string): LiveView => ({ target, docs: [{ part: target }] })

describe('viewOf', () => {
  it('opens a box on its own declaration, quietly', () => {
    expect(viewOf(map, 'OrderRepository')).toEqual({ target: 'OrderRepository', docs: [{ part: 'OrderRepository', seek: { names: ['OrderRepository', 'Repo'], kind: 'type', soft: true } }] })
  })
  it('opens a package on the files under it', () => {
    expect(viewOf(map, 'repo')).toEqual({ target: 'repo', docs: [{ part: 'repo' }] })
  })
  it('stacks a relation\'s two ends: from at its via\'s evidence, to at its declaration; one end for a line to itself', () => {
    expect(viewOf(map, rel)).toEqual({ target: rel, docs: [
      { part: 'OrderService', seek: { names: ['orderRepository'], kind: 'field' } },
      { part: 'OrderRepository', seek: { names: ['OrderRepository', 'Repo'], kind: 'type', soft: true } },
    ] })
    const self: CanvasMap = { ...map, relations: [{ from: 'OrderService', to: 'OrderService', kind: 'dependency', via: 'call place' }] }
    expect(viewOf(self, 'OrderService->OrderService:dependency')).toEqual({ target: 'OrderService->OrderService:dependency', docs: [{ part: 'OrderService', seek: { mention: 'place' } }] })
  })
  it('opens a relation\'s two ends at the call its label names and that name\'s declaration, then as without it', () => {
    const called: CanvasMap = { ...map, relations: [{ from: 'OrderService', to: 'OrderRepository', via: 'field orderRepository', label: 'save(o) · flush(o)' }] }
    const repo = { names: ['OrderRepository', 'Repo'], kind: 'type', soft: true }
    expect(viewOf(called, rel)).toEqual({ target: rel, docs: [
      { part: 'OrderService', seek: { uses: ['save', 'flush'], on: ['orderRepository', 'OrderRepository', 'Repo'], or: { names: ['orderRepository'], kind: 'field' } } },
      { part: 'OrderRepository', seek: { names: ['save'], kind: 'function', or: { names: ['flush'], kind: 'function', or: repo } } },
    ] })
  })
  it('stacks a message\'s sender at the call over the receiver at the function; a message to no one is its sender', () => {
    const seq: CanvasMap = {
      schema: 1, diagram: 'sequence', title: 's', relations: [],
      elements: [{ id: 'Client' }, { id: 'OrderService' }],
      messages: [{ id: 'm1', from: 'Client', to: 'OrderService', label: 'place(order)' }, { id: 'm2', from: 'Client', label: '로그' }],
    }
    expect(viewOf(seq, 'm1')).toEqual({ target: 'm1', docs: [{ part: 'Client', seek: { mention: 'place' } }, { part: 'OrderService', seek: { names: ['place'], kind: 'function' } }] })
    expect(viewOf(seq, 'm2')).toEqual({ target: 'm2', docs: [{ part: 'Client', seek: { names: ['Client'], kind: 'type', soft: true } }] })
    expect(linkView(seq, { name: 'place', target: 'm1', owner: 'OrderService', kind: 'function' })).toEqual(viewOf(seq, 'm1'))
  })
  it('shows nothing for what has no code', () => {
    expect(viewOf(map, 'D1')).toBeUndefined()
    expect(viewOf(map, 'gone')).toBeUndefined()
  })
})

describe('linkView', () => {
  it('opens a member\'s box at that member, a type at its declaration', () => {
    expect(linkView(map, { name: 'save', target: 'OrderRepository', owner: 'OrderRepository', kind: 'function' }))
      .toEqual({ target: 'OrderRepository', docs: [{ part: 'OrderRepository', seek: { names: ['save'], kind: 'function' } }] })
    expect(linkView(map, { name: 'Repo', target: 'OrderRepository', owner: 'OrderRepository', kind: 'type' }).docs[0].seek).toEqual({ names: ['Repo'], kind: 'type' })
  })
})

describe('history', () => {
  const trail = (...targets: string[]): Trail => targets.reduce((t, x, i) => go(t, box(x), undefined, i), EMPTY)
  it('moves on, stamping where the reader was on the entry left', () => {
    const t = go(trail('a'), box('b'), [12], 7)
    expect(t.index).toBe(1)
    expect(t.entries[0].at).toEqual([12])
    expect(shown(t)).toEqual({ view: box('b'), nonce: 7 })
  })
  it('drops what was ahead and is the same trail for the view already shown', () => {
    const back = step(trail('a', 'b', 'c'), -1, () => true, undefined, 9)
    const t = go(back, box('d'), undefined, 10)
    expect(t.entries.map(e => e.view.target)).toEqual(['a', 'b', 'd'])
    expect(go(t, box('d'), [3], 11)).toBe(t)
  })
  it('keeps the last HISTORY places', () => {
    const t = trail(...Array.from({ length: HISTORY + 5 }, (_, i) => `p${i}`))
    expect(t.entries).toHaveLength(HISTORY)
    expect(shown(t)?.view.target).toBe(`p${HISTORY + 4}`)
  })
  it('steps over parts the map lost, with a fresh nonce, and stays put with nowhere to go', () => {
    const t = trail('a', 'gone', 'c')
    const b = step(t, -1, x => x !== 'gone', [40], 99)
    expect(shown(b)).toEqual({ view: box('a'), nonce: 99 })
    expect(b.entries[2].at).toEqual([40])
    expect(step(b, -1, () => true, undefined, 100)).toBe(b)
    expect(step(EMPTY, 1, () => true, undefined, 1)).toBe(EMPTY)
  })
  it('swaps the shown view in place, keeping the history around it', () => {
    const t = go(trail('a', 'b'), box('c'), undefined, 3)
    const s = swap(step(t, -1, () => true, [5], 4), { target: 'b', docs: [{ part: 'b', ref: 'B2.kt' }] })
    expect(s.entries.map(e => e.view.target)).toEqual(['a', 'b', 'c'])
    expect(shown(s)).toEqual({ view: { target: 'b', docs: [{ part: 'b', ref: 'B2.kt' }] }, nonce: 4 })
    expect(swap(EMPTY, box('x'))).toBe(EMPTY)
  })
})

describe('pins', () => {
  const pin = (path: string, line = 1) => ({ root: '/ws', path, line, label: path, width: 400 })
  it('updates a pinned file rather than pinning it twice, and keeps at most three', () => {
    let pins = addPin([], pin('a.kt'), '1')
    pins = addPin(pins, pin('a.kt', 30), '2')
    expect(pins).toEqual([{ ...pin('a.kt', 30), id: '1' }])
    for (const p of ['b.kt', 'c.kt', 'd.kt']) pins = addPin(pins, pin(p), p)
    expect(pins.map(p => p.path)).toEqual(['b.kt', 'c.kt', 'd.kt'])
  })
  it('reads remembered pins, dropping anything malformed', () => {
    expect(parsePins('{oops')).toEqual([])
    expect(parsePins(null)).toEqual([])
    expect(parsePins(JSON.stringify([{ ...pin('a.kt'), id: 'x' }, { id: 'y' }]))).toEqual([{ ...pin('a.kt'), id: 'x' }])
  })
})

describe('unfoldFor', () => {
  it('opens only the folded packages around a part', () => {
    expect(unfoldFor(map, new Set(['repo', 'inner', 'svc']), 'OrderRepository')).toEqual(new Set(['svc']))
    expect(unfoldFor(map, new Set(['svc']), 'OrderRepository')).toBeUndefined()
  })
  it('brings a line with the boxes at its ends', () => {
    expect(partIds(map, rel)).toEqual(['OrderService', 'OrderRepository', rel])
    expect(partIds(map, 'OrderService')).toEqual(['OrderService'])
  })
})

describe('layoutColumns', () => {
  it('keeps the live column\'s width, clamped as the single pane was', () => {
    expect(layoutColumns(1440, 520, [])).toEqual({ live: 520, pins: [], hidden: 0 })
    expect(layoutColumns(800, 520, [])).toEqual({ live: 440, pins: [], hidden: 0 })
    expect(layoutColumns(600, 520, [])).toEqual({ live: 320, pins: [], hidden: 0 })
  })
  it('lets pins share what is left above the map\'s least, newest first, then hides the oldest', () => {
    expect(layoutColumns(1440, 520, [520])).toEqual({ live: 520, pins: [520], hidden: 0 })
    expect(layoutColumns(1440, 440, [500, 500])).toEqual({ live: 440, pins: [320, 320], hidden: 0 })
    expect(layoutColumns(1440, 520, [500, 500])).toEqual({ live: 520, pins: [undefined, 500], hidden: 1 })
    expect(layoutColumns(1220, 520, [400])).toEqual({ live: 520, pins: [340], hidden: 0 })
    expect(layoutColumns(1190, 520, [400])).toEqual({ live: 520, pins: [undefined], hidden: 1 })
  })
  it('never takes the map below its least for a pin', () => {
    for (const room of [1100, 1300, 1600]) {
      const l = layoutColumns(room, 520, [600, 600, 600])
      expect(room - (l.live ?? 0) - l.pins.reduce<number>((a, w) => a + (w ?? 0), 0)).toBeGreaterThanOrEqual(360)
    }
  })
  it('lays out pins with no live column', () => {
    expect(layoutColumns(1440, undefined, [500])).toEqual({ live: undefined, pins: [500], hidden: 0 })
  })
})

describe('blocksOf', () => {
  it('runs consecutive changed lines into blocks, top to bottom, a line twice counted once', () => {
    expect(blocksOf([16, 15, 40, 3, 4, 4])).toEqual([[3, 4], [15, 16], [40, 40]])
    expect(blocksOf(new Map([[2, 0], [1, 0]]).keys())).toEqual([[1, 2]])
    expect(blocksOf([])).toEqual([])
  })
})

describe('nextBlock', () => {
  const changed = [20, 3, 4, 5, 10, 11]
  it('goes to the start of the next block of changed lines, round the end', () => {
    expect([0, 3, 4, 10, 19, 20].map(l => nextBlock(changed, l, 1))).toEqual([3, 10, 10, 20, 20, 3])
  })
  it('goes back to the start of the block it is in, then the one before, round the top', () => {
    expect([11, 10, 4, 3, 1, 25].map(l => nextBlock(changed, l, -1))).toEqual([10, 3, 3, 20, 20, 20])
  })
  it('has nowhere to go with no changed lines', () => {
    expect(nextBlock([], 5, 1)).toBeUndefined()
    expect(nextBlock([], 5, -1)).toBeUndefined()
  })
})
