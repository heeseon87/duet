import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CanvasStore } from '../server/canvas/store.ts'
import type { runCanvasTool as Run } from '../server/agent/canvasTools.ts'

let store: CanvasStore
let run: typeof Run
let INSTRUCTIONS: string
const ws = '/w'
const terminal = { terminal: { id: 'term-0001', label: 'feat · term-000' } }

beforeAll(async () => {
  // The store keeps its maps under DUET_HOME, read once as it loads.
  process.env.DUET_HOME = mkdtempSync(join(tmpdir(), 'duet-tools-'))
  const { CanvasStore } = await import('../server/canvas/store.ts')
  const tools = await import('../server/agent/canvasTools.ts')
  store = new CanvasStore(() => undefined, () => undefined)
  run = tools.runCanvasTool
  INSTRUCTIONS = tools.INSTRUCTIONS
})

describe('canvas tools from a terminal', () => {
  it('points a terminal with no maps to duet_map_create', () => {
    expect(run(store, ws, 'canvas_list', {}, terminal).text).toContain('duet_map_create')
    expect(run(store, ws, 'canvas_list', {}).text).toContain('canvas_create')
  })

  it('gives a terminal the drawing guide with the map it makes, and signs the first rev', () => {
    const made = run(store, ws, 'canvas_create', { name: 'from-terminal', diagram: 'class', title: '터미널 지도' }, terminal)
    expect(made.isError).toBeUndefined()
    expect(made.text.startsWith(INSTRUCTIONS)).toBe(true)
    expect(made.text).toContain('Created from-terminal (rev 1)')
    expect(store.history(ws, 'from-terminal')[0]).toMatchObject({ revision: 1, by: 'agent', note: '터미널 · feat · term-000 · 새 지도' })
  })

  it('leaves a conversation\'s create as it was', () => {
    const made = run(store, ws, 'canvas_create', { name: 'from-chat', diagram: 'sequence', title: '대화 지도' })
    expect(made.text).toBe('Created from-chat (rev 1). The person sees it on the Canvas tab.')
    expect(store.history(ws, 'from-chat')[0]).toMatchObject({ by: 'agent', note: '새 지도' })
  })

  it('refuses a name that is taken', () => {
    expect(run(store, ws, 'canvas_create', { name: 'from-terminal', diagram: 'class', title: '다시' }, terminal)).toMatchObject({ isError: true })
  })

  it('writes a rev for a patch that only changes the context', () => {
    const before = store.get(ws, 'from-terminal').revision
    const res = run(store, ws, 'canvas_update', { name: 'from-terminal', note: '목적 고침', context: '새 목적' }, terminal)
    expect(res.text).toBe(`rev ${before + 1}\n  ~ context`)
    expect(store.get(ws, 'from-terminal').map.context).toBe('새 목적')
  })
})
