import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repoOf, reposInLog, turnsOf, workTreeOf, writtenPath } from '../server/agent/repos.ts'
import { headAt } from '../server/git/repo.ts'
import type { SessionEvent, TurnSummary } from '../shared/protocol.ts'

const gitInit = (dir: string) => { mkdirSync(dir, { recursive: true }); execFileSync('git', ['init', '-q', dir]) }

describe('repos a conversation wrote in', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'duet-repos-')))
  const ws = join(base, 'ws'), nested = join(ws, 'worktrees', 'feat')
  gitInit(ws); gitInit(nested)
  writeFileSync(join(ws, '.gitignore'), 'worktrees/\n')

  it('reads the written path from edit tools only, relative paths against the cwd', () => {
    expect(writtenPath('Edit', { file_path: '/a/b.kt' }, ws)).toBe('/a/b.kt')
    expect(writtenPath('Write', { file_path: 'src/x.kt' }, ws)).toBe(join(ws, 'src/x.kt'))
    expect(writtenPath('NotebookEdit', { notebook_path: '/n.ipynb' }, ws)).toBe('/n.ipynb')
    expect(writtenPath('Read', { file_path: '/a/b.kt' }, ws)).toBeUndefined()
    expect(writtenPath('Bash', { command: 'ls' }, ws)).toBeUndefined()
  })

  it('finds the repo of a file that does not exist yet, by its nearest folder', async () => {
    expect(await repoOf(join(nested, 'src', 'deep', 'New.kt'))).toBe(nested)
    expect(await repoOf(join(ws, 'notes', 'x.md'))).toBe(ws)
  })

  it("never counts Claude Code's own folder as a repo the conversation works in, even when it is one", async () => {
    const own = join(base, 'claude-home')
    gitInit(own)
    const was = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = own
    try {
      expect(await repoOf(join(own, 'plans', 'a-plan.md'))).toBeUndefined()
      expect(await repoOf(own)).toBeUndefined()
      expect(await reposInLog([write(join(own, 'plans', 'a-plan.md')), write(join(nested, 'B.kt'))], ws)).toEqual([nested])
    } finally {
      if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = was
    }
  })

  const tool = (name: string, input: unknown) => ({ seq: 1, ts: 1, kind: 'sdk', msg: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name, input }] } } }) as unknown as SessionEvent
  const write = (path: string) => tool('Write', { file_path: path })
  const start = (turnId: string, ts = 1) => ({ seq: 1, ts, kind: 'turn-start', turnId, snapshot: 'tree' }) as SessionEvent
  /** A turn's end with its snapshot counts: the workspace's own files, then each other repo it kept trees of. */
  const end = (turnId: string, own?: number, repos: Record<string, number> = {}) => {
    const changed = Object.entries(repos).filter(([, n]) => n > 0).map(([path, files]) => ({ path, files, additions: files, deletions: 0 }))
    const summary = own === undefined ? undefined : { changes: { files: own + changed.reduce((n, r) => n + r.files, 0), additions: 0, deletions: 0 }, repos: changed.length ? changed : undefined } as TurnSummary
    return { seq: 1, ts: 2, kind: 'turn-end', turnId, snapshot: 'tree', summary, repos: Object.keys(repos).length ? Object.keys(repos).map(path => ({ path, before: 'b', after: 'a' })) : undefined } as SessionEvent
  }

  it('lists repos other than the workspace from a log', async () => {
    const log = [tool('Write', { file_path: join(nested, 'A.kt') }), tool('Edit', { file_path: join(ws, 'README.md') }), tool('Read', { file_path: join(base, 'elsewhere', 'x') })]
    expect(await reposInLog(log, ws)).toEqual([nested])
  })

  it('splits a log into turns, each with the trees its edit tools wrote in', async () => {
    const log = [
      start('t1', 100), write(join(nested, 'A.kt')), write(join(nested, 'B.kt')), write(join(nested, 'A.kt')), tool('Edit', { file_path: join(ws, 'README.md') }), end('t1', 1, { [nested]: 2 }),
      start('t2', 200), tool('Read', { file_path: join(nested, 'A.kt') }), end('t2', 0, { [nested]: 0 }),
      write(join(nested, 'Outside.kt')),
    ]
    const turns = await turnsOf(log, ws)
    expect(turns.map(t => [t.turnId, t.n, t.started, Object.fromEntries(t.wrote)])).toEqual([['t1', 1, 100, { [nested]: 2, [ws]: 1 }], ['t2', 2, 200, {}]])
  })

  it('works where the latest turn that changed files changed most, not in the last turn', async () => {
    const log = [start('t1'), write(join(nested, 'A.kt')), end('t1', 0, { [nested]: 1 }), start('t2'), write(join(ws, 'notes.md')), end('t2', 1), start('t3'), end('t3', 0, { [nested]: 0 })]
    expect(workTreeOf(await turnsOf(log, ws), ws)).toBe(ws)
    expect(workTreeOf(await turnsOf(log.slice(0, 3), ws), ws)).toBe(nested)
    expect(workTreeOf(await turnsOf([start('t1'), end('t1', 0)], ws), ws)).toBeUndefined()
  })

  it('counts what the snapshots saw over what the tools aimed at, and gives a tie to the other repo', async () => {
    const reverted = [start('t1'), write(join(nested, 'A.kt')), write(join(nested, 'B.kt')), write(join(ws, 'x.md')), end('t1', 1, { [nested]: 0 })]
    expect(workTreeOf(await turnsOf(reverted, ws), ws)).toBe(ws)
    const tie = [start('t1'), write(join(nested, 'A.kt')), write(join(ws, 'x.md')), end('t1', 1, { [nested]: 1 })]
    expect(workTreeOf(await turnsOf(tie, ws), ws)).toBe(nested)
  })

  it('finds the repo of a turn older than the per-repo snapshots from the log', async () => {
    const old = [start('t7'), write(join(nested, 'A.kt')), write(join(nested, 'B.kt')), end('t7', 1), start('t8'), end('t8', 0)]
    expect(workTreeOf(await turnsOf(old, ws), ws)).toBe(nested)
  })
})

describe('the commit HEAD was on at a moment', () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'duet-head-')))
  const T = 1_800_000_000
  const at = (secs: number, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: `@${secs} +0000`, GIT_AUTHOR_DATE: `@${secs} +0000` } }).toString().trim()
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  at(T, 'commit', '-q', '--allow-empty', '-m', 'one')
  at(T + 100, 'commit', '-q', '--allow-empty', '-m', 'two')
  const one = at(T, 'rev-parse', 'HEAD~1'), two = at(T, 'rev-parse', 'HEAD')

  it('gives the commit, its subject and date, at any moment after it', async () => {
    expect(await headAt(repo, (T + 50) * 1000)).toEqual({ sha: one, subject: 'one', date: T * 1000 })
    expect(await headAt(repo, (T + 100) * 1000 + 999)).toEqual({ sha: two, subject: 'two', date: (T + 100) * 1000 })
    expect(await headAt(repo, (T - 10) * 1000)).toBeUndefined()
  })

  it('follows the reflog: a commit later reset away still counts for its time', async () => {
    at(T + 200, 'reset', '-q', '--hard', one)
    expect((await headAt(repo, (T + 150) * 1000))?.sha).toBe(two)
    expect((await headAt(repo, (T + 250) * 1000))?.sha).toBe(one)
  })

  it('falls back to the history where the reflog does not reach back', async () => {
    at(T + 300, 'reset', '-q', '--hard', two)
    at(T + 300, 'reflog', 'expire', '--expire=all', '--all')
    at(T + 400, 'commit', '-q', '--allow-empty', '-m', 'three')
    expect((await headAt(repo, (T + 50) * 1000))?.sha).toBe(one)
  })
})
