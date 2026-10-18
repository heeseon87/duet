import { describe, expect, it } from 'vitest'
import { mapView, reviewView, takesView } from '../web/src/agent/view.ts'
import { listedFiles } from '../web/src/review/mapGroups.ts'
import { applyPatch, emptyMap } from '../shared/canvas.ts'
import type { DiffFile, DiffResult } from '../shared/protocol.ts'

const file = (path: string): DiffFile => ({ path, status: 'modified', additions: 1, deletions: 0, hunks: [] })
const diff = (paths: string[]): DiffResult => ({
  workspace: '/w/feat', source: { kind: 'working' }, oldLabel: 'HEAD', newLabel: 'Working tree', oldRef: 'abc', newRef: 'WORKTREE', files: paths.map(file), generatedAt: 0,
})

describe('takesView', () => {
  it("keeps the view off Claude Code's own commands, with or without arguments", () => {
    for (const t of ['/compact', '/compact keep the plan', '/model', '/clear', '  /context', '/mcp']) expect(takesView(t), t).toBe(false)
  })

  it('sends it with skill and plugin commands, and with plain messages', () => {
    for (const t of ['/review medium', '/review', '/code-review high', '/pstack:how', 'list the files', 'what does /compact do?', '']) expect(takesView(t), t).toBe(true)
  })
})

describe('the review on screen', () => {
  it('lists what the review lists: the map part first, then the filter box', () => {
    const files = ['src/a/One.kt', 'src/a/Two.kt', 'src/b/Three.kt'].map(file)
    const scope = { paths: ['/w/feat/src/a/One.kt', '/w/feat/src/a/Two.kt'] }
    expect(listedFiles(files, '/w/feat', scope, '').map(f => f.path)).toEqual(['src/a/One.kt', 'src/a/Two.kt'])
    expect(listedFiles(files, '/w/feat', scope, 'two').map(f => f.path)).toEqual(['src/a/Two.kt'])
    expect(listedFiles(files, '/w/feat', undefined, 'three').map(f => f.path)).toEqual(['src/b/Three.kt'])
  })

  it('names the tree, the source and the count, and carries the diff refs', () => {
    const d = diff(['a.ts', 'b.ts'])
    const item = reviewView(d, '/w/worktrees/FEAT-42', d.files, 'Changes')
    expect(item).toMatchObject({ kind: 'review-view', label: '리뷰: FEAT-42 · Changes · 파일 2개', root: '/w/worktrees/FEAT-42', base: 'abc', head: 'WORKTREE', files: ['a.ts', 'b.ts'], total: 2 })
    expect(reviewView(d, '/w/feat', d.files, 'Changes', 'process (응용 계층)').label).toBe('리뷰: feat · Changes · 파일 2개 · process (응용 계층)')
  })

  it('keeps the first 60 paths and counts them all', () => {
    const d = diff(Array.from({ length: 75 }, (_, i) => `f${String(i).padStart(2, '0')}.ts`))
    const item = reviewView(d, '/w/feat', d.files, 'Changes')
    expect(item.kind === 'review-view' && [item.files.length, item.files[59], item.total]).toEqual([60, 'f59.ts', 75])
  })
})

describe('the map on screen', () => {
  const map = applyPatch(emptyMap('class', '썸네일 워커 클래스 구조'), { elements: [{ id: 'Pool', label: '작업 풀' }, { id: 'Job' }] }, 'agent').map

  it('names the map, and the selection by id and label', () => {
    expect(mapView(map, 'worker', 4)).toMatchObject({ label: '지도: 썸네일 워커 클래스 구조', map: 'worker', title: '썸네일 워커 클래스 구조', revision: 4, selected: undefined })
    expect(mapView(map, 'worker', 4, 'Pool')).toMatchObject({ label: '지도: 썸네일 워커 클래스 구조 · 작업 풀', selected: 'Pool (작업 풀)' })
    expect(mapView(map, 'worker', 4, 'Job')).toMatchObject({ selected: 'Job' })
  })
})
