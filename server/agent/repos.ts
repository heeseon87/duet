import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { SessionEvent } from '../../shared/protocol.ts'
import { git } from '../util.ts'

/** Tools that write a file, and where the path sits in their input. */
const WRITERS: Record<string, string> = { Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' }

/** The file a tool call writes, as an absolute path; undefined for any other tool. */
export function writtenPath(tool: string, input: unknown, cwd: string): string | undefined {
  const key = WRITERS[tool]
  const p = key && input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined
  if (typeof p !== 'string' || !p) return undefined
  return isAbsolute(p) ? p : resolve(cwd, p)
}

const tops = new Map<string, string | undefined>()

/**
 * The git working tree that holds this path (a file that does not exist yet counts by its folder).
 * Claude Code's own folder (plans, memory) is never a repo the conversation works in, even when it is
 * a git repo: snapshotting it each turn writes its large untracked files into its object store.
 */
export async function repoOf(path: string): Promise<string | undefined> {
  const own = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  if (path === own || path.startsWith(own + sep)) return undefined
  let dir = path
  while (!existsSync(dir) || !statSync(dir).isDirectory()) {
    const up = dirname(dir)
    if (up === dir) return undefined
    dir = up
  }
  if (tops.has(dir)) return tops.get(dir)
  const top = (await git(dir, ['rev-parse', '--show-toplevel'], { allowFail: true })).trim() || undefined
  tops.set(dir, top)
  return top
}

/** The files an event's tool calls write. */
function written(e: SessionEvent, cwd: string): string[] {
  if (e.kind !== 'sdk' || e.msg.type !== 'assistant') return []
  const content = (e.msg as { message?: { content?: unknown } }).message?.content
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const b of content as { type?: string; name?: string; input?: unknown }[]) {
    const p = b.type === 'tool_use' && b.name ? writtenPath(b.name, b.input, cwd) : undefined
    if (p) out.push(p)
  }
  return out
}

/** Repos other than the workspace that a session's log shows the agent writing to (for sessions older than the tracking). */
export async function reposInLog(log: SessionEvent[], workspace: string): Promise<string[]> {
  const paths = new Set(log.flatMap(e => written(e, workspace)))
  const repos = new Set<string>()
  for (const p of paths) {
    const r = await repoOf(p)
    if (r && r !== workspace) repos.add(r)
  }
  return [...repos]
}

type TurnEnd = Extract<SessionEvent, { kind: 'turn-end' }>

/** A turn of a log: when it started, how it ended, and how many files its edit tools wrote in each tree. */
export type LoggedTurn = { turnId: string; n: number; started: number; end?: TurnEnd; wrote: Map<string, number> }

export async function turnsOf(log: SessionEvent[], workspace: string): Promise<LoggedTurn[]> {
  const turns: LoggedTurn[] = []
  const paths = new Map<LoggedTurn, Set<string>>()
  let cur: LoggedTurn | undefined
  for (const e of log) {
    if (e.kind === 'turn-start') {
      cur = { turnId: e.turnId, n: turns.length + 1, started: e.ts, wrote: new Map() }
      turns.push(cur)
      paths.set(cur, new Set())
    } else if (e.kind === 'turn-end') {
      const t = turns.find(x => x.turnId === e.turnId)
      if (t) t.end = e
      if (cur === t) cur = undefined
    } else if (cur) for (const p of written(e, workspace)) paths.get(cur)!.add(p)
  }
  for (const [t, set] of paths) {
    for (const p of set) {
      const r = await repoOf(p)
      if (r) t.wrote.set(r, (t.wrote.get(r) ?? 0) + 1)
    }
  }
  return turns
}

/** What a turn changed in one tree per its snapshots; undefined when it kept no snapshot of that tree. */
export function recordedFiles(t: LoggedTurn, tree: string, workspace: string): number | undefined {
  const s = t.end?.summary
  if (!s?.changes) return undefined
  if (tree === workspace) return s.changes.files - (s.repos ?? []).reduce((n, r) => n + r.files, 0)
  if (!t.end?.repos?.some(r => r.path === tree && r.before)) return undefined
  // Repos that came out unchanged are left out of the summary.
  return s.repos?.find(r => r.path === tree)?.files ?? 0
}

/** The tree with the most changed files; a tie goes to the repo that is not the workspace, as the turn link does. */
export function busiest(counts: [string, number][], workspace: string): string | undefined {
  let best: [string, number] | undefined
  for (const c of counts) if (c[1] > 0 && (!best || c[1] > best[1] || (c[1] === best[1] && best[0] === workspace))) best = c
  return best?.[0]
}

/**
 * Where a conversation works: the tree its latest file-changing turn changed most. A turn's snapshots
 * count where it kept them; for a tree it kept none of (turns older than the tracking), the log does.
 */
export function workTreeOf(turns: LoggedTurn[], workspace: string): string | undefined {
  for (const t of [...turns].reverse()) {
    const trees = new Set([workspace, ...t.wrote.keys(), ...(t.end?.repos ?? []).map(r => r.path)])
    const tree = busiest([...trees].map(r => [r, recordedFiles(t, r, workspace) ?? t.wrote.get(r) ?? 0]), workspace)
    if (tree) return tree
  }
  return undefined
}
