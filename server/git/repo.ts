import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { DiffSource, GitInfo, MapCode } from '../../shared/protocol.ts'
import { git, HttpError, run } from '../util.ts'

/** The working tree root that contains `path`, or an error if it is not in a git repo. */
export async function toplevel(path: string): Promise<string> {
  const abs = resolve(path)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new HttpError(400, `${abs} is not a folder`)
  const out = await git(abs, ['rev-parse', '--show-toplevel'], { allowFail: true })
  if (!out.trim()) throw new HttpError(400, `${abs} is not inside a git repository`)
  return out.trim()
}

/** For a linked worktree, the main repository's root; else undefined. */
export async function mainRoot(root: string): Promise<string | undefined> {
  const common = (await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { allowFail: true })).trim()
  const own = (await git(root, ['rev-parse', '--path-format=absolute', '--git-dir'], { allowFail: true })).trim()
  if (!common || common === own) return undefined
  return common.replace(/\/\.git\/?$/, '')
}

export async function workspaceName(root: string): Promise<string> {
  const main = await mainRoot(root)
  return main ? `${basename(main)} / ${basename(root)}` : basename(root)
}

export async function currentBranch(root: string): Promise<string | undefined> {
  const b = (await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFail: true })).trim()
  return b || undefined
}

export async function gitInfo(root: string): Promise<GitInfo> {
  const [branch, head, refs, wt, status, originHead] = await Promise.all([
    currentBranch(root),
    git(root, ['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true }),
    git(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(committerdate:unix)', 'refs/heads', 'refs/remotes'], { allowFail: true }),
    git(root, ['worktree', 'list', '--porcelain'], { allowFail: true }),
    git(root, ['status', '--porcelain=v1', '-uall'], { allowFail: true }),
    git(root, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'], { allowFail: true }),
  ])
  const branches: GitInfo['branches'] = []
  for (const line of refs.split('\n')) {
    if (!line) continue
    const [full, short, upstream, date] = line.split('\0')
    if (full.endsWith('/HEAD')) continue
    branches.push({ name: short, remote: full.startsWith('refs/remotes/'), current: short === branch && full.startsWith('refs/heads/'), upstream: upstream || undefined, updated: Number(date) * 1000 })
  }
  const worktrees: GitInfo['worktrees'] = []
  let cur: GitInfo['worktrees'][number] | undefined
  for (const line of wt.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9), current: false }
      cur.current = cur.path === root
      worktrees.push(cur)
    } else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5)
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '')
    else if (cur && line === 'bare') cur.bare = true
  }
  return {
    root,
    branch,
    head: head.trim() || undefined,
    branches,
    worktrees,
    defaultBase: pickDefaultBase(branches, originHead.trim(), branch),
    dirtyCount: status.split('\n').filter(Boolean).length,
  }
}

/** origin/HEAD first; else the usual trunk names. reviewr fell back the same way. */
function pickDefaultBase(branches: GitInfo['branches'], originHead: string, current?: string): string | undefined {
  const names = new Set(branches.map(b => b.name))
  const candidates = [originHead, 'origin/main', 'origin/master', 'origin/ktx', 'origin/develop', 'main', 'master', 'develop']
  return candidates.find(c => c && names.has(c) && c !== current)
}

export async function listFiles(root: string): Promise<string[]> {
  const out = await git(root, ['ls-files', '-co', '--exclude-standard'], { maxBuffer: 128 * 1024 * 1024 })
  return out.split('\n').filter(Boolean)
}

export type LogEntry = { sha: string; short: string; subject: string; author: string; date: number; refs: string }

export async function log(root: string, ref = 'HEAD', limit = 60): Promise<LogEntry[]> {
  const out = await git(root, ['log', `-n${limit}`, '--format=%H%x00%h%x00%s%x00%an%x00%ct%x00%D', ref, '--'], { allowFail: true })
  return out.split('\n').filter(Boolean).map(line => {
    const [sha, short, subject, author, date, refs] = line.split('\0')
    return { sha, short, subject, author, date: Number(date) * 1000, refs }
  })
}

/** The commit HEAD was on at a moment, per the reflog; where the reflog does not reach back, the last commit made before it. */
export async function headAt(root: string, ms: number): Promise<{ sha: string; subject: string; date: number } | undefined> {
  const at = `@${Math.floor(ms / 1000)}`
  // Before its first entry the reflog answers with that entry and only warns, so a warning means "ask the history".
  const r = await run('git', ['rev-parse', '--verify', `HEAD@{${at}}`], { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
  const sha = (r.code === 0 && !r.stderr.trim() ? r.stdout.trim() : '') || (await git(root, ['rev-list', '-1', `--before=${at}`, 'HEAD'], { allowFail: true })).trim()
  if (!sha) return undefined
  const [subject, date] = (await git(root, ['log', '-1', '--format=%s%x00%ct', sha], { allowFail: true })).trim().split('\0')
  return { sha, subject, date: Number(date) * 1000 }
}

/** A file's text at a ref ('WORKTREE' = on disk). Undefined when it does not exist there. */
export async function readAt(root: string, ref: string, path: string): Promise<string | undefined> {
  if (path.includes('\0') || path.startsWith('/') || path.split('/').includes('..')) throw new HttpError(400, 'bad path')
  if (ref === 'WORKTREE') {
    const { readFile } = await import('node:fs/promises')
    try {
      return await readFile(resolve(root, path), 'utf8')
    } catch {
      return undefined
    }
  }
  if (!isSafeRef(ref)) throw new HttpError(400, 'bad ref')
  const res = await run('git', ['show', `${ref}:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
  return res.code === 0 ? res.stdout : undefined
}

/** Refs come from the browser: allow names and ids, never options or revision tricks with spaces. */
export function isSafeRef(ref: string): boolean {
  return /^[\w./@{}~^-]+$/.test(ref) && !ref.startsWith('-') && !ref.includes('..')
}

export type GrepHit = { path: string; line: number; text: string }

export async function grep(root: string, query: string, limit = 400): Promise<GrepHit[]> {
  if (!query.trim()) return []
  const res = await run('rg', ['--line-number', '--no-heading', '--color=never', '--max-columns=300', '--smart-case', '--fixed-strings', '-m', '50', '--', query, '.'], { cwd: root, timeout: 15_000 })
  // rg exits 1 for "no matches"; a missing rg (ENOENT) falls back to git grep.
  const rgWorked = res.code === 0 || (res.code === 1 && !/ENOENT/.test(res.stderr))
  const out = rgWorked ? res.stdout : await git(root, ['grep', '-n', '-I', '-F', '--', query], { allowFail: true })
  const hits: GrepHit[] = []
  for (const line of out.split('\n')) {
    const m = /^(?:\.\/)?(.+?):(\d+):(.*)$/.exec(line)
    if (!m) continue
    hits.push({ path: m[1], line: Number(m[2]), text: m[3] })
    if (hits.length >= limit) break
  }
  return hits
}

/**
 * The code a map made in `cwd` is about: its tree from the current commit on, the working tree included, so what is
 * built from the map shows up (no commit yet: what is not committed). `home` names the tree when it is the same folder.
 * Undefined outside a git repository. Synchronous: two quick local reads, while the map is made.
 */
export function codeHere(cwd: string, home?: string): MapCode | undefined {
  if (!existsSync(cwd)) return undefined
  const at = (args: string[]) => {
    try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim() } catch { return '' }
  }
  const top = at(['rev-parse', '--show-toplevel'])
  if (!top) return undefined
  const same = (a: string, b: string) => { try { return realpathSync(a) === realpathSync(b) } catch { return false } }
  const root = home && same(home, top) ? home : top
  const head = at(['rev-parse', '--verify', '-q', 'HEAD'])
  return { root, source: head ? { kind: 'branch', base: head, compare: 'WORKTREE' } : { kind: 'working' }, set: Date.now() }
}

/** What a map made to review code is bound to, as the tool takes it: `pr`, `pr:123`, `branch:main...feat`, `commits:a..b`. */
export function codeSourceOf(text: string): DiffSource | undefined {
  const [kind, rest = ''] = text.trim().split(/:(.*)/s)
  const refs = (...r: string[]) => r.every(isSafeRef)
  if (kind === 'pr') {
    if (rest === '') return { kind: 'pr' }
    return /^\d+$/.test(rest) ? { kind: 'pr', number: Number(rest) } : undefined
  }
  if (kind === 'branch') {
    const [base, compare = 'WORKTREE'] = rest.split('...')
    return base && (compare === 'WORKTREE' || refs(compare)) && refs(base) ? { kind: 'branch', base, compare } : undefined
  }
  if (kind === 'commits') {
    const [a, b] = rest.split('..')
    if (b === undefined) return a && refs(a) ? { kind: 'commits', to: a } : undefined
    return a && b && refs(a, b) ? { kind: 'commits', from: a, to: b } : undefined
  }
  return undefined
}
