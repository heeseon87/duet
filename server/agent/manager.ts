import { getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { Effort, PermissionMode, SdkMessage, SessionEvent, SessionInfo } from '../../shared/protocol.ts'
import { appendJsonl, DUET_HOME, HttpError, newId, readJson, writeJson } from '../util.ts'
import { Session, type SessionHooks } from './session.ts'
import { reposInLog, turnsOf, workTreeOf } from './repos.ts'

const INDEX = () => join(DUET_HOME, 'sessions', 'index.json')

export type ClaudeSessionSummary = { claudeId: string; title: string; updated: number; branch?: string; liveHint: boolean; imported?: string }

export class SessionManager {
  private sessions = new Map<string, Session>()
  private worked = new Set<string>()

  constructor(private hooks: SessionHooks) {
    for (const info of readJson<SessionInfo[]>(INDEX(), [])) {
      // A process does not survive a server restart; the next prompt resumes it.
      info.status = info.status === 'error' ? 'error' : 'stopped'
      this.sessions.set(info.id, new Session(info, this.wrap()))
    }
  }

  private wrap(): SessionHooks {
    return {
      ...this.hooks,
      changed: info => {
        this.save()
        this.hooks.changed(info)
      },
    }
  }

  private save() {
    writeJson(INDEX(), [...this.sessions.values()].map(s => s.info))
  }

  list(workspace?: string): SessionInfo[] {
    return [...this.sessions.values()].map(s => s.info).filter(i => !workspace || i.workspace === workspace).sort((a, b) => b.updated - a.updated)
  }

  /** Repos other than the workspace that its conversations wrote in, each with those conversations. Older ones are read from their logs once. */
  async touchedRepos(workspace: string): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>()
    for (const s of this.sessions.values()) {
      if (s.info.workspace !== workspace) continue
      if (!s.info.repos) { s.info.repos = await reposInLog(s.log(), workspace); this.save() }
      for (const r of s.info.repos) out.set(r, [...(out.get(r) ?? []), s.info.id])
    }
    return out
  }

  /** Conversations older than the tracking learn where they work from their logs, once per server run. */
  async learnWorkTrees(workspace: string) {
    for (const s of this.sessions.values()) {
      if (s.info.workspace !== workspace || s.info.workTree || !s.info.turns || this.worked.has(s.info.id)) continue
      this.worked.add(s.info.id)
      s.info.workTree = workTreeOf(await turnsOf(s.log(), workspace), workspace)
      if (s.info.workTree) this.save()
    }
  }

  /** The workspace whose conversations wrote in this repo. */
  ownerOf(repo: string): string | undefined {
    return [...this.sessions.values()].find(s => s.info.repos?.includes(repo))?.info.workspace
  }

  get(id: string): Session {
    const s = this.sessions.get(id)
    if (!s) throw new HttpError(404, `session ${id} not found`)
    return s
  }

  find(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  create(args: { workspace: string; model?: string; permissionMode?: PermissionMode; effort?: Effort; claudeId?: string; title?: string }): Session {
    const now = Date.now()
    const info: SessionInfo = {
      id: newId('s-'),
      claudeId: args.claudeId,
      workspace: args.workspace,
      title: args.title ?? '새 대화',
      model: args.model,
      effort: args.effort,
      permissionMode: args.permissionMode ?? 'auto',
      status: 'idle',
      created: now,
      updated: now,
      costUsd: 0,
      turns: 0,
    }
    const session = new Session(info, this.wrap())
    this.sessions.set(info.id, session)
    this.save()
    this.hooks.changed(info)
    return session
  }

  /** Claude Code sessions recorded for this folder (terminal ones included), newest first. */
  async claudeSessions(workspace: string): Promise<ClaudeSessionSummary[]> {
    const imported = new Map([...this.sessions.values()].filter(s => s.info.claudeId).map(s => [s.info.claudeId!, s.info.id]))
    const list = await listSessions({ dir: workspace, limit: 40 })
    return list.map(s => ({
      claudeId: s.sessionId,
      title: s.customTitle || s.summary || s.firstPrompt || s.sessionId.slice(0, 8),
      updated: s.lastModified,
      branch: s.gitBranch,
      // A transcript written in the last two minutes is probably open in a terminal.
      liveHint: Date.now() - s.lastModified < 120_000,
      imported: imported.get(s.sessionId),
    }))
  }

  /** Bring a terminal session into Duet: its history is copied into the log, the next prompt resumes it. */
  async importClaude(workspace: string, claudeId: string, title?: string): Promise<Session> {
    const existing = [...this.sessions.values()].find(s => s.info.claudeId === claudeId)
    if (existing) return existing
    const messages = await getSessionMessages(claudeId, { dir: workspace })
    const session = this.create({ workspace, claudeId, title: title ?? '가져온 대화' })
    let seq = 0
    const ts = Date.now()
    for (const m of messages) {
      const msg = { ...(m as unknown as SdkMessage), imported: true }
      const event: SessionEvent = { seq: ++seq, ts, kind: 'sdk', msg }
      appendJsonl(session.logPath, event)
    }
    // Rebuild the session so its sequence counter sees the imported history.
    const rebuilt = new Session(session.info, this.wrap())
    this.sessions.set(session.info.id, rebuilt)
    return rebuilt
  }

  remove(id: string) {
    const s = this.get(id)
    s.close()
    this.sessions.delete(id)
    this.save()
  }

  transcriptAge(claudeId: string, workspace: string): number | undefined {
    try {
      const slug = workspace.replace(/[^A-Za-z0-9]/g, '-')
      return Date.now() - statSync(join(process.env.HOME ?? '', '.claude', 'projects', slug, `${claudeId}.jsonl`)).mtimeMs
    } catch {
      return undefined
    }
  }

  shutdown() {
    for (const s of this.sessions.values()) s.close()
  }
}
