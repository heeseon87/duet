import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CanvasStore } from '../server/canvas/store.ts'
import type { runCanvasTool as Run, CANVAS_TOOLS as Tools } from '../server/agent/canvasTools.ts'
import { RELATION_RULES } from '../shared/canvas.ts'

let store: CanvasStore
let run: typeof Run
let INSTRUCTIONS: string
let CANVAS_TOOLS: typeof Tools
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
  CANVAS_TOOLS = tools.CANVAS_TOOLS
})

describe('canvas tools from a terminal', () => {
  it('points a terminal with no maps to duet_map_create', () => {
    expect(run(store, ws, 'canvas_list', {}, terminal).text).toContain('duet_map_create')
    expect(run(store, ws, 'canvas_list', {}).text).toContain('canvas_create')
  })

  it('makes an empty map for a terminal and signs the first rev', () => {
    const made = run(store, ws, 'canvas_create', { name: 'from-terminal', diagram: 'class', title: '터미널 지도' }, terminal)
    expect(made.isError).toBeUndefined()
    expect(made.text).toBe('Created from-terminal (rev 1). The person sees it on the Canvas tab.')
    expect(store.history(ws, 'from-terminal')[0]).toMatchObject({ revision: 1, by: 'agent', note: '터미널 · feat · term-000 · 새 지도' })
  })

  it('draws the first rev in the same call, with the notes an update would give', () => {
    const made = run(store, ws, 'canvas_create', {
      name: 'drawn', diagram: 'class', title: '그린 지도', note: '첫 그림',
      elements: [{ id: 'Svc' }, { id: 'Repo' }], relations: [{ from: 'Svc', to: 'Repo', kind: 'dependency', via: 'field repo' }],
    }, terminal)
    expect(made.isError).toBeUndefined()
    expect(made.text).toMatch(/^Created drawn \(rev 1\)\. .*\n {2}\+ Svc\n {2}\+ Repo\n {2}\+ Svc->Repo\nnote: relation Svc->Repo:dependency/)
    expect(store.history(ws, 'drawn')).toMatchObject([{ revision: 1, by: 'agent', note: '터미널 · feat · term-000 · 첫 그림' }])
    expect(store.get(ws, 'drawn').map.elements.map(e => e.id)).toEqual(['Svc', 'Repo'])
  })

  it('makes nothing when the first drawing does not validate', () => {
    const made = run(store, ws, 'canvas_create', { name: 'broken', diagram: 'class', title: '깨진 지도', relations: [{ from: 'A', to: 'B' }] }, terminal)
    expect(made).toMatchObject({ isError: true })
    expect(made.text.startsWith('Nothing was made. Fix these and call again:')).toBe(true)
    expect(store.exists(ws, 'broken')).toBe(false)
  })

  it('leaves a conversation\'s create as it was', () => {
    const made = run(store, ws, 'canvas_create', { name: 'from-chat', diagram: 'sequence', title: '대화 지도' })
    expect(made.text).toBe('Created from-chat (rev 1). The person sees it on the Canvas tab.')
    expect(store.history(ws, 'from-chat')[0]).toMatchObject({ by: 'agent', note: '새 지도' })
  })

  it('refuses a name that is taken', () => {
    expect(run(store, ws, 'canvas_create', { name: 'from-terminal', diagram: 'class', title: '다시' }, terminal)).toMatchObject({ isError: true })
  })

  it('notes a relation whose via is evidence for another kind, and writes it anyway', () => {
    run(store, ws, 'canvas_update', { name: 'from-terminal', note: '상자', elements: [{ id: 'Svc' }, { id: 'Repo' }] }, terminal)
    const res = run(store, ws, 'canvas_update', { name: 'from-terminal', note: '선', relations: [{ from: 'Svc', to: 'Repo', kind: 'dependency', via: 'field repo' }] }, terminal)
    expect(res.isError).toBeUndefined()
    expect(res.text).toMatch(/^rev \d+\n {2}\+ Svc->Repo\n/)
    expect(res.text).toContain('note: relation Svc->Repo:dependency: via "field repo" is evidence of association, aggregation or composition, not dependency.')
    expect(store.get(ws, 'from-terminal').map.relations).toContainEqual({ from: 'Svc', to: 'Repo', kind: 'dependency', via: 'field repo' })
  })

  it('tells the agent in the kind of a relation how to pick it, and asks for via', () => {
    const kind = CANVAS_TOOLS.canvas_update.shape.relations.unwrap().element.shape.kind.description ?? ''
    for (const [k, r] of Object.entries(RELATION_RULES)) expect(kind).toContain(`${k}${k === 'association' ? ' (the default)' : ''}: ${r.when}`)
    expect(INSTRUCTIONS).toMatch(/give that code in via/)
  })

  it('leaves the drawing guide out of read results: it rides on the create tool', () => {
    expect(run(store, ws, 'canvas_read', { name: 'drawn' }, terminal).text.startsWith('rev 1\n')).toBe(true)
  })

  it('writes a rev for a patch that only changes the context', () => {
    const before = store.get(ws, 'from-terminal').revision
    const res = run(store, ws, 'canvas_update', { name: 'from-terminal', note: '목적 고침', context: '새 목적' }, terminal)
    expect(res.text).toBe(`rev ${before + 1}\n  ~ context`)
    expect(store.get(ws, 'from-terminal').map.context).toBe('새 목적')
  })
})

describe('rebaseFiles', () => {
  it('makes part files relative to where the map\'s files start, from the agent\'s folder or an absolute path', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { rebaseFiles } = await import('../server/agent/canvasTools.ts')
    const base = mkdtempSync(join(tmpdir(), 'duet-rebase-'))
    mkdirSync(join(base, 'wt', 'src'), { recursive: true })
    writeFileSync(join(base, 'wt', 'src', 'A.kt'), '')
    writeFileSync(join(base, 'top.kt'), '')
    const patch = { elements: [{ id: 'A', files: ['src/A.kt:3-9', `${base}/top.kt:1-2`, 'top.kt', 'src/Planned.kt', '/elsewhere/X.kt'] }, { id: 'B' }] }
    expect(rebaseFiles(patch, base, [join(base, 'wt')], () => []).patch.elements).toEqual([
      { id: 'A', files: ['wt/src/A.kt:3-9', 'top.kt:1-2', 'top.kt', 'src/Planned.kt', '/elsewhere/X.kt'] }, { id: 'B' },
    ])
  })

  it('writes the path of a file named by the end of its path alone, unless several files end so', async () => {
    const { rebaseFiles } = await import('../server/agent/canvasTools.ts')
    const tree = ['app/src/main/OrderService.kt', 'app/src/main/order/Order.kt', 'lib/order/Order.kt', 'app/src/test/OrderServiceTest.kt']
    const res = rebaseFiles({ elements: [{ id: 'S', files: ['OrderService.kt:4-20'] }, { id: 'O', files: ['Order.kt'] }, { id: 'L', files: ['lib/order/Order.kt'] }, { id: 'N', files: ['New.kt'] }] },
      '/ws', ['/ws/app-wt'], root => (root === '/ws/app-wt' ? tree : []))
    expect(res.patch.elements!.map(e => e.files)).toEqual([['app-wt/app/src/main/OrderService.kt:4-20'], ['Order.kt'], ['app-wt/lib/order/Order.kt'], ['New.kt']])
    expect(res.notes).toEqual(['files "Order.kt": 2 files end so in /ws/app-wt (app/src/main/order/Order.kt, lib/order/Order.kt); give more of the path'])
  })
})
