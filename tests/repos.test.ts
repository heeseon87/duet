import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { headAt, repoOf } from '../server/git/repo.ts'

const gitInit = (dir: string) => { mkdirSync(dir, { recursive: true }); execFileSync('git', ['init', '-q', dir]) }

describe('the repo a path is in', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'duet-repos-')))
  const ws = join(base, 'ws'), nested = join(ws, 'worktrees', 'feat')
  gitInit(ws); gitInit(nested)
  writeFileSync(join(ws, '.gitignore'), 'worktrees/\n')

  it('finds the repo of a file that does not exist yet, by its nearest folder', async () => {
    expect(await repoOf(join(nested, 'src', 'deep', 'New.kt'))).toBe(nested)
    expect(await repoOf(join(ws, 'notes', 'x.md'))).toBe(ws)
  })

  it("never counts Claude Code's own folder as a repo, even when it is one", async () => {
    const own = join(base, 'claude-home')
    gitInit(own)
    const was = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = own
    try {
      expect(await repoOf(join(own, 'plans', 'a-plan.md'))).toBeUndefined()
      expect(await repoOf(own)).toBeUndefined()
    } finally {
      if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = was
    }
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
