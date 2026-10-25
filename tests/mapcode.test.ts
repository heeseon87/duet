import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CanvasStore } from '../server/canvas/store.ts'
import type { runCanvasTool as Run } from '../server/agent/canvasTools.ts'
import type { codeHere as CodeHere, codeSourceOf as CodeSourceOf } from '../server/git/repo.ts'

let store: CanvasStore
let run: typeof Run
let codeHere: typeof CodeHere
let codeSourceOf: typeof CodeSourceOf
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@duet', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim()

/** A repo with one commit, and one with none. */
function repos() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'duet-code-')))
  const done = join(base, 'done'), fresh = join(base, 'fresh')
  for (const r of [done, fresh]) { mkdirSync(r); git(r, 'init', '-q', '-b', 'main') }
  writeFileSync(join(done, 'a.txt'), 'a\n')
  git(done, 'add', '.')
  git(done, 'commit', '-q', '-m', 'first')
  mkdirSync(join(done, 'src'))
  return { done, fresh, head: git(done, 'rev-parse', 'HEAD') }
}

beforeAll(async () => {
  // Every server module is imported only after this: util.ts reads DUET_HOME once, as it loads, and a static import
  // would load it first and write the test maps into the person's real Duet home.
  process.env.DUET_HOME = mkdtempSync(join(tmpdir(), 'duet-code-home-'))
  ;({ codeHere, codeSourceOf } = await import('../server/git/repo.ts'))
  const { CanvasStore } = await import('../server/canvas/store.ts')
  run = (await import('../server/agent/canvasTools.ts')).runCanvasTool
  store = new CanvasStore(() => undefined, () => undefined)
})

describe('the code a map is bound to', () => {
  it('takes the tree from its current commit, from any folder inside it', () => {
    const { done, head } = repos()
    expect(codeHere(join(done, 'src'))).toMatchObject({ root: done, source: { kind: 'branch', base: head, compare: 'WORKTREE' } })
  })

  it('takes what is not committed in a repo with no commit yet, and nothing outside git', () => {
    const { fresh } = repos()
    expect(codeHere(fresh)?.source).toEqual({ kind: 'working' })
    expect(codeHere(mkdtempSync(join(tmpdir(), 'duet-nogit-')))).toBeUndefined()
    expect(codeHere('/no/such/folder')).toBeUndefined()
  })

  it('reads what a map made to review code reviews', () => {
    expect(codeSourceOf('pr')).toEqual({ kind: 'pr' })
    expect(codeSourceOf('pr:123')).toEqual({ kind: 'pr', number: 123 })
    expect(codeSourceOf('branch:main...feature/x')).toEqual({ kind: 'branch', base: 'main', compare: 'feature/x' })
    expect(codeSourceOf('branch:main')).toEqual({ kind: 'branch', base: 'main', compare: 'WORKTREE' })
    expect(codeSourceOf('commits:abc..def')).toEqual({ kind: 'commits', from: 'abc', to: 'def' })
    expect(codeSourceOf('commits:abc')).toEqual({ kind: 'commits', to: 'abc' })
    for (const bad of ['pr:x', 'branch:', 'branch:--all', 'commits:a..', 'turn', 'main']) expect(codeSourceOf(bad)).toBeUndefined()
  })

  it('keeps the binding through new revisions and a restore, and lets it go when unbound', () => {
    const { done } = repos()
    const code = codeHere(done)!
    store.create(done, 'kept', 'class', '지도', undefined, 'person', '새 지도', code)
    store.update(done, 'kept', { elements: [{ id: 'A' }] }, 'agent', 'add A')
    expect(store.get(done, 'kept')).toMatchObject({ revision: 2, code })
    store.restore(done, 'kept', 1)
    expect(store.get(done, 'kept').code).toEqual(code)
    expect(store.list(done).find(m => m.name === 'kept')?.code).toEqual(code)
    store.setCode(done, 'kept', undefined)
    expect(store.get(done, 'kept')).toMatchObject({ revision: 3 })
    expect(store.get(done, 'kept').code).toBeUndefined()
  })
})

describe('canvas_create binds the map', () => {
  it('to the terminal\'s tree for a design map', () => {
    const { done, head } = repos()
    const made = run(store, done, 'canvas_create', { name: 'design', diagram: 'class', title: '설계' }, { terminal: { id: 'term-0001', label: 't', cwd: join(done, 'src') } })
    expect(made.isError).toBeUndefined()
    expect(made.text).toContain(`Its review shows the working tree since ${head.slice(0, 7)} in ${done}.`)
    expect(store.get(done, 'design').code?.source).toEqual({ kind: 'branch', base: head, compare: 'WORKTREE' })
  })

  it('to the code it reviews, and refuses what it cannot read', () => {
    const { done } = repos()
    expect(run(store, done, 'canvas_create', { name: 'review', diagram: 'class', title: '리뷰', code: 'pr:12' }).text).toContain('Its review shows PR #12')
    expect(store.get(done, 'review').code).toMatchObject({ root: done, source: { kind: 'pr', number: 12 } })
    const bad = run(store, done, 'canvas_create', { name: 'bad', diagram: 'class', title: '틀림', code: 'pr:abc' })
    expect(bad).toMatchObject({ isError: true })
    expect(store.exists(done, 'bad')).toBe(false)
  })
})

describe('the parts a map\'s code changed', async () => {
  const { codeMarks } = await import('../shared/mapFiles.ts')
  const { mapGroups } = await import('../web/src/review/mapGroups.ts')
  const map = {
    schema: 1 as const, diagram: 'class' as const, title: 't', relations: [],
    elements: [
      { id: 'pkg', kind: 'group' as const },
      { id: 'Built', parent: 'pkg', change: 'add' as const, files: ['src/Built.kt'] },
      { id: 'Waiting', parent: 'pkg', change: 'modify' as const, files: ['src/Waiting.kt'] },
      { id: 'Kept', change: 'keep' as const, files: ['src/Kept.kt', 'src/Built.kt'] },
      { id: 'Plain' },
    ],
  }
  const file = (path: string) => ({ path, status: 'modified' as const, additions: 1, deletions: 0, hunks: [] })
  const files = [file('src/Built.kt'), file('src/Kept.kt'), file('README.md')]

  it('marks built, not yet built and unplanned parts, and counts what no part names', () => {
    const { marks, outside } = codeMarks(map, files, '/r', '/r')
    expect(Object.fromEntries(marks)).toEqual({
      pkg: { state: 'built', paths: ['src/Built.kt'], viewed: 0 },
      Built: { state: 'built', paths: ['src/Built.kt'], viewed: 0 },
      Waiting: { state: 'pending', paths: [], viewed: 0 },
      Kept: { state: 'unplanned', paths: ['src/Kept.kt', 'src/Built.kt'], viewed: 0 },
    })
    expect(outside).toBe(1)
  })

  it('leaves out "not built yet" for one turn of the map\'s code', () => {
    const { marks } = codeMarks(map, [file('src/Built.kt')], '/r', '/r', { pending: false })
    const one = { paths: ['src/Built.kt'], viewed: 0 }
    expect(Object.fromEntries(marks)).toEqual({ pkg: { state: 'built', ...one }, Built: { state: 'built', ...one }, Kept: { state: 'unplanned', ...one } })
  })

  it('counts the viewed files of a part and of everything inside a package', () => {
    const { marks } = codeMarks(map, files, '/r', '/r', { viewed: new Set(['src/Built.kt', 'README.md']) })
    expect(marks.get('pkg')?.viewed).toBe(1)
    expect(marks.get('Built')?.viewed).toBe(1)
    expect(marks.get('Kept')?.viewed).toBe(1)
  })

  it('agrees with the review\'s map layout on every file, the workspace being another folder than the tree', () => {
    const { marks, outside } = codeMarks(map, files, '/ws/wt', '/ws/wt')
    const groups = mapGroups(map, files, '/ws/wt', '/ws/wt')
    expect(groups.outside.length).toBe(outside)
    const counts = new Map<string, number>()
    const walk = (n: (typeof groups.nodes)[number]) => { counts.set(n.el.id, n.count); n.children.forEach(walk) }
    groups.nodes.forEach(walk)
    for (const [id, m] of marks) if (m.paths.length) expect(counts.get(id)).toBe(m.paths.length)
  })
})

describe('canvas_create binds the map to another repository', () => {
  const terminalIn = (cwd: string) => ({ terminal: { id: 'term-0002', label: 't', cwd } })

  it('takes repo over the terminal\'s folder, and starts the parts\' files from that root', () => {
    const { done: ws } = repos()
    const { done: other } = repos()
    const range = `commits:${git(other, 'rev-parse', '--short', 'HEAD')}`
    const made = run(store, ws, 'canvas_create', { name: 'elsewhere', diagram: 'class', title: '옆 저장소', code: range, repo: join(other, 'src') }, terminalIn(ws))
    expect(made.isError).toBeUndefined()
    expect(made.text).toContain(`in ${other}. Its parts' files are relative to ${other}.`)
    expect(store.get(ws, 'elsewhere').code?.root).toBe(other)
  })

  it('refuses commits the repository does not have, and a repo outside git', () => {
    const { done: ws } = repos()
    const { done: other } = repos()
    // Two fresh repos made in the same second share their first commit; a second one only the other has.
    writeFileSync(join(other, 'b.txt'), 'b\n')
    git(other, 'add', '.')
    git(other, 'commit', '-q', '-m', 'second')
    const theirs = git(other, 'rev-parse', 'HEAD')
    const wrong = run(store, ws, 'canvas_create', { name: 'wrong', diagram: 'class', title: '틀림', code: `commits:${theirs}` }, terminalIn(ws))
    expect(wrong).toMatchObject({ isError: true })
    expect(wrong.text).toContain('Pass repo')
    expect(store.exists(ws, 'wrong')).toBe(false)
    const nogit = run(store, ws, 'canvas_create', { name: 'nogit', diagram: 'class', title: '틀림', repo: mkdtempSync(join(tmpdir(), 'duet-nogit-')) }, terminalIn(ws))
    expect(nogit).toMatchObject({ isError: true })
  })
})

describe('where a map\'s relative files start', async () => {
  const { refBase, ownFiles } = await import('../shared/mapFiles.ts')
  const map = { schema: 1 as const, diagram: 'class' as const, title: 't', relations: [], elements: [{ id: 'A', files: ['src/A.kt'] }, { id: 'W', files: ['wt/src/W.kt'] }] }
  const file = (path: string) => ({ path })

  it('starts from another repository\'s root, and from the workspace for a tree inside it', () => {
    expect(refBase('/ws', '/repos/other')).toBe('/repos/other')
    expect(refBase('/ws', '/ws/wt')).toBe('/ws')
    expect(refBase('/ws', '/ws')).toBe('/ws')
    expect(refBase('/ws', undefined)).toBe('/ws')
    expect(refBase('/ws', '/wsx')).toBe('/wsx')
  })

  it('matches the review\'s files either way', () => {
    expect([...ownFiles(map, [file('src/A.kt')], '/repos/other', refBase('/ws', '/repos/other')).keys()]).toEqual(['A'])
    expect([...ownFiles(map, [file('src/W.kt')], '/ws/wt', refBase('/ws', '/ws/wt')).keys()]).toEqual(['W'])
  })
})
