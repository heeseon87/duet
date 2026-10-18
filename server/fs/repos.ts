import { existsSync, readFileSync, statSync, type Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type FoundRepo = { path: string; name: string; display: string; worktree: boolean; main?: string }

// Folders that never hold repos worth listing, or that macOS guards with a privacy prompt.
const SKIP = new Set(['Library', 'Applications', 'Movies', 'Music', 'Pictures', 'Public', 'Desktop', 'Documents', 'Downloads', 'node_modules', 'build', 'dist', 'target', 'out', 'vendor', 'Pods', 'DerivedData', 'venv', '__pycache__'])
const MAX_DEPTH = 3
const MAX_DIRS = 6000
const BUDGET_MS = 2500
const TTL_MS = 5 * 60_000

let cache: { at: number; repos: FoundRepo[] } | undefined
let running: Promise<FoundRepo[]> | undefined

/** Git repos (and worktrees) up to three folders below home. Cached; a stale list is served while a new scan runs. */
export function findRepos(): Promise<FoundRepo[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.repos)
  running ??= scan().then(repos => { cache = { at: Date.now(), repos }; return repos }).finally(() => { running = undefined })
  return cache ? Promise.resolve(cache.repos) : running
}

async function scan(): Promise<FoundRepo[]> {
  const home = homedir()
  const started = Date.now()
  const found: FoundRepo[] = []
  const add = (path: string, worktree: boolean, main?: string) => found.push({ path, name: path.split('/').pop() ?? path, display: '~' + path.slice(home.length), worktree, main })
  // A `.git` file points elsewhere: a linked worktree (listed) or a submodule (part of its parent repo, skipped).
  const mark = (dir: string) => {
    const marker = join(dir, '.git')
    try {
      if (statSync(marker).isDirectory()) return add(dir, false)
      const gitdir = readFileSync(marker, 'utf8')
      // "gitdir: /path/to/main/.git/worktrees/<name>" names the main repo.
      const m = /gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]/.exec(gitdir)
      if (m) add(dir, true, m[1].split(/[\\/]/).pop())
    } catch {
      // Unreadable: leave it out.
    }
  }
  let queue: string[] = [home]
  let visited = 0
  for (let depth = 0; depth < MAX_DEPTH && queue.length; depth++) {
    const next: string[] = []
    for (const dir of queue) {
      if (++visited > MAX_DIRS || Date.now() - started > BUDGET_MS) return sorted(found)
      let entries: Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      if (dir !== home && entries.some(e => e.name === '.git')) mark(dir)
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue
        const child = join(dir, e.name)
        if (depth + 1 < MAX_DEPTH) next.push(child)
        else {
          // The deepest level only asks whether the folder is a repo.
          if (existsSync(join(child, '.git'))) mark(child)
        }
      }
    }
    queue = next
  }
  return sorted(found)
}

const sorted = (repos: FoundRepo[]) => repos.sort((a, b) => a.path.localeCompare(b.path))
