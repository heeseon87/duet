import { query, type Query, type SDKUserMessage, type PermissionResult, type CanUseTool, type HookCallback } from '@anthropic-ai/claude-agent-sdk'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ContextItem, DiffSource, ImageRef, ImageUpload, PermissionDecision, PermissionRequest, RepoChanges, SdkMessage, SessionEvent, SessionEventBody, SessionInfo, TurnRef, TurnSummary,
} from '../../shared/protocol.ts'
import { appendJsonl, DUET_HOME, ensureDir, HttpError, newId, readJsonl } from '../util.ts'
import { writeFileSync } from 'node:fs'
import { snapshot } from '../git/diff.ts'
import { headAt } from '../git/repo.ts'
import { git } from '../util.ts'
import { canvasServer } from './canvasTools.ts'
import { busiest, recordedFiles, repoOf, turnsOf, writtenPath } from './repos.ts'
import { metered, type Meter } from './meter.ts'
import type { CanvasStore } from '../canvas/store.ts'
import type { PromptState } from '../../shared/canvas.ts'

/** Appended to Claude Code's own system prompt: what the person sees, and how they talk to you. */
const DUET_APPEND = `
# Duet
You are running inside Duet, a local browser workspace. The person watches your work live beside a Review tab (diffs of the working tree, where they comment on lines) and a Canvas tab (design maps you edit with the mcp__duet__canvas_* tools).
- Write replies in GitHub-flavored Markdown: the browser renders headings, lists, tables and fenced code with a language tag.
- Review comments arrive as a prompt listing file:line ranges with the code and the person's note. Address every comment, and say which ones you changed and which you did not (and why).
- Canvas comments name the map and the element or line they are about. Answer in chat, and update the map when the design changes.
- A message can carry the review or the map the person is looking at. Then "this", "these changes" or "review it" mean that review or map.
- That review may be of a repo other than your cwd: run git there with \`git -C <repo>\`, as the message shows.
- Refer to code as \`path:line\`; the browser links it to the file.`

/**
 * The design-map plugin drives its own canvas; inside Duet it would be a second, competing one. Duet's own
 * terminal mod would register this conversation as a terminal, and its tools would sit beside these.
 */
function pluginDirsForDuet(): string | undefined {
  const dirs = process.env.CLAUDE_CODE_PLUGIN_DIRS
  if (!dirs) return undefined
  return dirs.split(':').filter(d => !/(design-map|duet|duet\/mod)\/?$/.test(d)).join(':')
}

/** A queue the SDK reads prompts from; it stays open for the life of the process. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiting?: (r: IteratorResult<SDKUserMessage>) => void
  private closed = false
  push(m: SDKUserMessage) {
    if (this.waiting) { const w = this.waiting; this.waiting = undefined; w({ value: m, done: false }) }
    else this.items.push(m)
  }
  close() {
    this.closed = true
    if (this.waiting) { const w = this.waiting; this.waiting = undefined; w({ value: undefined, done: true }) }
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise(r => { this.waiting = r })
      },
    }
  }
}

type Pending = { request: PermissionRequest; resolve: (r: PermissionResult) => void }

export type SessionHooks = {
  emit: (sessionId: string, event: SessionEvent) => void
  delta: (sessionId: string, msg: SdkMessage) => void
  changed: (info: SessionInfo) => void
  canvas: CanvasStore
}

/** Messages that only matter while they stream; the log keeps the final forms. */
const LIVE_ONLY = new Set(['stream_event', 'tool_progress', 'rate_limit_event'])
const LIVE_ONLY_SYSTEM = new Set(['thinking_tokens', 'ui_panes', 'ui_invalidate', 'hook_started', 'hook_progress', 'hook_response', 'commands_changed', 'status'])

export class Session {
  private q?: Query
  private inbox?: Inbox
  private restartWhenIdle = false
  private pending = new Map<string, Pending>()
  private seq: number
  /** The turn in flight; `repos` holds the before-trees of other repos, taken before the agent first writes there. */
  private turn?: { id: string; before?: string; number: number; repos: Map<string, Promise<string | undefined>> }
  /** The person's prompts the agent has not answered yet, oldest first: SDK uuid, Duet message id, and whether a turn has taken it up. */
  private prompts: { uuid: string; id: string; taken?: boolean }[] = []
  private get awaitingResults() { return this.prompts.length }
  private uuidsSeen = false
  private wokeByTask = false
  private idleTimer?: NodeJS.Timeout
  private startup?: Promise<void>
  /** Session-level details from the process's init message (tools, slash commands, model). */
  init?: SdkMessage
  private meter: Meter

  constructor(public info: SessionInfo, private hooks: SessionHooks) {
    const log = this.log()
    this.seq = log.length
    // Read from the log, so a conversation logged before the meter followed each call shows its real context.
    this.meter = log.reduce((m, e) => (e.kind === 'sdk' ? metered(m, e.msg) : m), {} as Meter)
    info.contextTokens = this.meter.tokens
    info.contextWindow = this.meter.window
  }

  get logPath(): string {
    return join(DUET_HOME, 'sessions', `${this.info.id}.jsonl`)
  }

  log(): SessionEvent[] {
    return readJsonl<SessionEvent>(this.logPath)
  }

  private record(event: SessionEventBody): SessionEvent {
    const full = { ...event, seq: ++this.seq, ts: Date.now() } as SessionEvent
    appendJsonl(this.logPath, full)
    this.hooks.emit(this.info.id, full)
    return full
  }

  private setStatus(status: SessionInfo['status'], detail?: string) {
    if (this.info.status === status && !detail) return
    this.info.status = status
    this.info.updated = Date.now()
    // A setting fixed per process (effort) changed mid-turn: restart once the turn is over.
    if (status === 'idle' && this.restartWhenIdle) { this.restartWhenIdle = false; this.retire() }
    this.hooks.changed(this.info)
    this.hooks.emit(this.info.id, { seq: this.seq, ts: Date.now(), kind: 'status', status, detail })
  }

  private ensureStarted(): Promise<void> {
    if (this.q && this.inbox) return Promise.resolve()
    if (this.startup) return this.startup
    this.startup = (async () => {
      this.setStatus('starting')
      const inbox = new Inbox()
      const env: Record<string, string | undefined> = { ...process.env }
      const dirs = pluginDirsForDuet()
      if (dirs !== undefined) env.CLAUDE_CODE_PLUGIN_DIRS = dirs
      // The terminal mod stays out of Duet's own conversations however it was installed.
      env.DUET_CONVERSATION = '1'
      const q = query({
        prompt: inbox,
        options: {
          cwd: this.info.workspace,
          model: this.info.model,
          effort: this.info.effort,
          permissionMode: this.info.permissionMode,
          allowDangerouslySkipPermissions: this.info.permissionMode === 'bypassPermissions',
          includePartialMessages: true,
          thinking: { type: 'adaptive', display: 'summarized' },
          // Tests run without the person's own CLAUDE.md and hooks (DUET_SETTING_SOURCES=project,local).
          settingSources: (process.env.DUET_SETTING_SOURCES?.split(',') as ('user' | 'project' | 'local')[] | undefined) ?? ['user', 'project', 'local'],
          systemPrompt: { type: 'preset', preset: 'claude_code', append: DUET_APPEND },
          mcpServers: { duet: canvasServer(this.hooks.canvas, this.info.workspace, () => this.info.workTree ?? this.info.workspace) },
          canUseTool: this.canUseTool,
          hooks: { PreToolUse: [{ hooks: [this.beforeTool] }] },
          resume: this.info.claudeId,
          env,
          stderr: data => { if (/error/i.test(data)) console.error(`[session ${this.info.id}]`, data.trim().slice(0, 500)) },
        },
      })
      this.q = q
      this.inbox = inbox
      void this.pump(q)
    })().finally(() => { this.startup = undefined })
    return this.startup
  }

  private async pump(q: Query) {
    // A retired process may still be winding down while a new one runs: only the current one counts.
    const current = () => this.q === q || (this.q === undefined && !this.startup)
    try {
      for await (const raw of q) {
        if (this.q !== q) continue
        const msg = raw as unknown as SdkMessage
        this.handle(msg)
      }
      if (current()) this.onExit()
    } catch (e) {
      if (!current()) return
      this.record({ kind: 'notice', level: 'error', text: `에이전트 프로세스가 멈췄어: ${(e as Error).message}` })
      this.onExit('error')
    }
  }

  /** Ends the idle agent process now; the next prompt starts a fresh one that resumes the conversation. */
  private retire() {
    const inbox = this.inbox
    this.q = undefined
    this.inbox = undefined
    inbox?.close()
  }

  private onExit(status: 'stopped' | 'error' = 'stopped') {
    this.q = undefined
    this.inbox = undefined
    for (const [id, p] of this.pending) {
      p.resolve({ behavior: 'deny', message: 'session ended' })
      this.record({ kind: 'permission-resolved', id, decision: 'cancel' })
    }
    this.pending.clear()
    if (this.turn) void this.endTurn(undefined, this.prompts.filter(p => p.taken).map(p => p.id))
    this.prompts = []
    this.setStatus(status)
  }

  private handle(msg: SdkMessage) {
    // The CLI took a prompt off its queue: it opens a turn, or joins the running one between tool rounds.
    if (msg.type === 'command_lifecycle' && msg.state === 'started') {
      const p = this.prompts.find(x => x.uuid === msg.command_uuid)
      if (p) p.taken = true
    }
    // The agent can wake on its own (a background task finished): show it as working.
    if ((msg.type === 'stream_event' || msg.type === 'assistant') && this.info.status === 'idle') this.setStatus('running')
    if (msg.type === 'stream_event' || msg.type === 'tool_progress' || (msg.type === 'system' && msg.subtype === 'thinking_tokens')) {
      this.hooks.delta(this.info.id, msg)
      return
    }
    if (msg.type === 'system' && msg.subtype === 'init') {
      this.init = msg
      const claudeId = msg.session_id as string | undefined
      if (claudeId && claudeId !== this.info.claudeId) {
        this.info.claudeId = claudeId
        this.hooks.changed(this.info)
      }
      if (!this.info.model && typeof msg.model === 'string') this.info.model = msg.model
      this.hooks.delta(this.info.id, msg)
      return
    }
    if (msg.type === 'system' && msg.subtype === 'status') {
      this.hooks.delta(this.info.id, msg)
      if (typeof msg.permissionMode === 'string' && msg.permissionMode !== this.info.permissionMode) {
        this.info.permissionMode = msg.permissionMode as SessionInfo['permissionMode']
        this.hooks.changed(this.info)
      }
      return
    }
    if (LIVE_ONLY.has(msg.type) || (msg.type === 'system' && LIVE_ONLY_SYSTEM.has(msg.subtype ?? ''))) {
      this.hooks.delta(this.info.id, msg)
      return
    }
    this.record({ kind: 'sdk', msg })
    const meter = metered(this.meter, msg)
    if (meter !== this.meter) {
      this.meter = meter
      this.info.contextTokens = meter.tokens
      this.info.contextWindow = meter.window
      this.hooks.changed(this.info)
    }
    if (msg.type === 'system' && msg.subtype === 'task_notification') this.wokeByTask = true
    if (msg.type === 'result') void this.onResult(msg)
  }

  private async onResult(msg: SdkMessage) {
    const ids = [msg.user_message_uuid, ...((msg.user_message_uuids as string[] | undefined) ?? [])].filter((x): x is string => typeof x === 'string')
    if (ids.length) this.uuidsSeen = true
    const answered = ids.filter(id => this.prompts.some(p => p.uuid === id))
    const woke = this.wokeByTask
    this.wokeByTask = false
    // Without uuids, a result is the agent's own only when the CLI is known to send them, or it followed a task notification.
    const autonomous = ids.length ? !answered.length : this.uuidsSeen || woke || msg.num_turns === 0
    if (autonomous) {
      // A result nobody asked for (the agent woke on a task notification): count its cost, keep the turn.
      this.info.costUsd += Number(msg.total_cost_usd ?? 0)
      if (!this.prompts.length) this.setStatus(this.pending.size ? 'waiting' : 'idle')
      this.hooks.changed(this.info)
      return
    }
    // Older CLIs send no uuids: answers then come in order.
    const done = ids.length ? this.prompts.filter(p => answered.includes(p.uuid)) : this.prompts.slice(0, 1)
    const usage = (msg.usage ?? {}) as Record<string, number>
    const summary: TurnSummary = {
      durationMs: Number(msg.duration_ms ?? 0),
      costUsd: Number(msg.total_cost_usd ?? 0),
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      isError: Boolean(msg.is_error) || msg.subtype !== 'success',
      subtype: String(msg.subtype ?? ''),
      result: typeof msg.result === 'string' ? msg.result : undefined,
    }
    this.info.costUsd += summary.costUsd
    this.info.turns += 1
    // They leave the list only once the turn-end is written: until then they still count as worked on.
    await this.endTurn(summary, done.map(p => p.id))
    this.prompts = this.prompts.filter(p => !done.includes(p))
    if (this.awaitingResults > 0) await this.beginTurn()
    else this.setStatus(this.pending.size ? 'waiting' : 'idle')
    this.armIdle()
  }

  private async beginTurn() {
    // The oldest prompt opens the turn (one sent to an idle agent already has).
    if (this.prompts[0]) this.prompts[0].taken = true
    const before = await snapshot(this.info.workspace)
    const number = this.log().filter(e => e.kind === 'turn-start').length + 1
    // Repos written in earlier turns are likely written again: their trees now, so nothing is missed.
    const repos = new Map((this.info.repos ?? []).map(r => [r, snapshot(r)] as const))
    this.turn = { id: newId('turn-'), before, number, repos }
    this.record({ kind: 'turn-start', turnId: this.turn.id, snapshot: before })
    this.setStatus('running')
  }

  /** `prompts`: the message ids this turn answered or was working on. */
  private async endTurn(summary?: TurnSummary, prompts?: string[]) {
    const turn = this.turn
    if (!turn) return
    this.turn = undefined
    const after = await snapshot(this.info.workspace)
    const own = turn.before && after ? await changeStats(this.info.workspace, turn.before, after) : undefined
    const repos = await Promise.all([...turn.repos].map(async ([path, p]) => {
      const before = await p
      const later = before ? await snapshot(path) : undefined
      return { path, before, after: later, changes: before && later ? await changeStats(path, before, later) : undefined }
    }))
    // A repo that only a shell command changed counts as written once the change shows.
    const wrote = repos.filter(r => r.changes?.files).map(r => r.path).filter(r => !this.info.repos?.includes(r))
    if (wrote.length) this.info.repos = [...(this.info.repos ?? []), ...wrote]
    const where = busiest([[this.info.workspace, own?.files ?? 0], ...repos.map(r => [r.path, r.changes?.files ?? 0] as [string, number])], this.info.workspace)
    if (where) this.info.workTree = where
    if (wrote.length || where) this.hooks.changed(this.info)
    if (summary && own) {
      const all = [own, ...repos.map(r => r.changes).filter((c): c is RepoChanges => !!c)]
      summary.changes = { files: sum(all, 'files'), additions: sum(all, 'additions'), deletions: sum(all, 'deletions') }
      const touched = repos.filter(r => r.changes?.files).map(r => ({ path: r.path, ...r.changes! }))
      if (touched.length) summary.repos = touched
    }
    this.record({ kind: 'turn-end', turnId: turn.id, snapshot: after, summary, repos: repos.length ? repos.map(({ path, before, after }) => ({ path, before, after })) : undefined, prompts: prompts?.length ? prompts : undefined })
  }

  /**
   * Before a tool runs: when it writes into a repo other than the workspace (a file edit there, or a
   * shell command run there), take that repo's tree first, so the turn's review can show what changed.
   */
  private beforeTool: HookCallback = async input => {
    if (input.hook_event_name !== 'PreToolUse') return { continue: true }
    const turn = this.turn
    const written = writtenPath(input.tool_name, input.tool_input, input.cwd || this.info.workspace)
    const where = written ?? (input.tool_name === 'Bash' ? input.cwd : undefined)
    const repo = where ? await repoOf(where) : undefined
    const elsewhere = Boolean(written && repo && repo !== this.info.workspace && !this.info.repos?.includes(repo))
    if (elsewhere) this.info.repos = [...(this.info.repos ?? []), repo!]
    // A conversation's first write says where it works; the turn's end settles it by what changed.
    const first = Boolean(written && repo && !this.info.workTree)
    if (first) this.info.workTree = repo
    if (elsewhere || first) this.hooks.changed(this.info)
    if (!repo || repo === this.info.workspace) return { continue: true }
    if (turn && !turn.repos.has(repo)) turn.repos.set(repo, snapshot(repo))
    await turn?.repos.get(repo)
    return { continue: true }
  }

  private armIdle() {
    clearTimeout(this.idleTimer)
    // An idle process holds memory; it comes back with `resume` on the next prompt.
    this.idleTimer = setTimeout(() => { if (this.info.status === 'idle') this.retire() }, 30 * 60_000)
  }

  /** Pasted pictures live beside the log: `<session>.files/<name>`. */
  get filesDir(): string {
    return join(DUET_HOME, 'sessions', `${this.info.id}.files`)
  }

  async send(text: string, context?: ContextItem[], id = newId('m-'), display?: string, uploads: ImageUpload[] = []): Promise<string> {
    const images: ImageRef[] = []
    for (const [i, u] of uploads.entries()) {
      const ext = u.mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
      const file = `${id}-${i}.${ext}`
      ensureDir(this.filesDir)
      writeFileSync(join(this.filesDir, file), Buffer.from(u.data, 'base64'))
      images.push({ file, mediaType: u.mediaType })
    }
    clearTimeout(this.idleTimer)
    // Reserve the slot before any await, so two quick prompts never both open a turn.
    const busy = this.awaitingResults > 0
    const uuid = randomUUID()
    this.prompts.push({ uuid, id, taken: !busy })
    this.record({ kind: 'user', id, text, display, context, queued: busy, images: images.length ? images : undefined })
    if (this.info.title === '새 대화' && text.trim()) {
      const first = (display ?? text).trim().split('\n')[0]
      const where = context?.[0]?.kind === 'canvas' ? '캔버스 · ' : context?.[0]?.kind === 'review' ? '리뷰 · ' : ''
      this.info.title = `${where}${first}`.slice(0, 60)
      this.hooks.changed(this.info)
    }
    try {
      await this.ensureStarted()
      if (!busy) await this.beginTurn()
    } catch (e) {
      this.prompts = this.prompts.filter(p => p.uuid !== uuid)
      throw e
    }
    this.inbox!.push({
      type: 'user',
      uuid,
      // Typed by the person: the CLI's trust gates treat unattributed input as untrusted.
      origin: { kind: 'human' },
      message: {
        role: 'user',
        content: uploads.length
          ? [...uploads.map(u => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: u.mediaType as 'image/png', data: u.data } })), { type: 'text' as const, text: composePrompt(text, context) }]
          : composePrompt(text, context),
      },
      parent_tool_use_id: null,
      session_id: this.info.claudeId ?? '',
    } as SDKUserMessage)
    return id
  }

  async interrupt() {
    if (!this.q) return
    for (const [id, p] of this.pending) {
      p.resolve({ behavior: 'deny', message: 'The person interrupted.', interrupt: true })
      this.record({ kind: 'permission-resolved', id, decision: 'cancel' })
    }
    this.pending.clear()
    try {
      const receipt = await this.q.interrupt()
      // Queued prompts the CLI dropped will never get an answer.
      const cancelled = receipt?.cancelled ?? []
      if (cancelled.length) {
        this.prompts = this.prompts.filter(p => !cancelled.includes(p.uuid))
        this.record({ kind: 'notice', level: 'info', text: `대기열 메시지 ${cancelled.length}개는 보내지 않았어` })
      }
    } catch (e) {
      this.record({ kind: 'notice', level: 'warn', text: `중단 요청이 실패했어: ${(e as Error).message}` })
    }
  }

  async configure(patch: { model?: string | null; permissionMode?: SessionInfo['permissionMode']; effort?: SessionInfo['effort'] | null; title?: string }) {
    if (patch.title !== undefined) this.info.title = patch.title
    if (patch.permissionMode && patch.permissionMode !== this.info.permissionMode) {
      this.info.permissionMode = patch.permissionMode
      if (this.q) await this.q.setPermissionMode(patch.permissionMode).catch(() => undefined)
    }
    if (patch.model !== undefined && patch.model !== this.info.model) {
      this.info.model = patch.model ?? undefined
      if (this.q) await this.q.setModel(patch.model ?? undefined).catch(() => undefined)
    }
    if (patch.effort !== undefined && patch.effort !== this.info.effort) {
      this.info.effort = patch.effort ?? undefined
      // Effort is fixed per process; the next start picks it up.
      if (this.q && this.info.status === 'idle') this.retire()
      else if (this.q) this.restartWhenIdle = true
    }
    this.info.updated = Date.now()
    this.hooks.changed(this.info)
  }

  decide(permissionId: string, decision: PermissionDecision): boolean {
    const p = this.pending.get(permissionId)
    if (!p) return false
    this.pending.delete(permissionId)
    if (decision.behavior === 'allow') {
      const updatedPermissions = decision.always ? (p.request.suggestions as never[] | undefined) : undefined
      p.resolve({ behavior: 'allow', updatedInput: decision.updatedInput ?? p.request.input, updatedPermissions })
      this.record({ kind: 'permission-resolved', id: permissionId, decision: 'allow', always: decision.always })
    } else {
      p.resolve({ behavior: 'deny', message: decision.message || 'The person declined this action.', interrupt: decision.interrupt })
      this.record({ kind: 'permission-resolved', id: permissionId, decision: 'deny', message: decision.message })
    }
    if (!this.pending.size && this.info.status === 'waiting') this.setStatus(this.awaitingResults ? 'running' : 'idle')
    return true
  }

  private canUseTool: CanUseTool = (toolName, input, opts) => {
    // Duet's own canvas tools are the point of the session; never ask for them.
    if (opts.mcpServer?.source === 'sdk' && opts.mcpServer.name === 'duet') return Promise.resolve({ behavior: 'allow', updatedInput: input })
    const o = opts as unknown as Record<string, unknown>
    const request: PermissionRequest = {
      id: newId('p-'),
      toolName,
      toolUseId: typeof o.toolUseID === 'string' ? o.toolUseID : undefined,
      input,
      suggestions: opts.suggestions as unknown as PermissionRequest['suggestions'],
      blockedPath: opts.blockedPath,
      reason: typeof o.decisionReason === 'string' ? o.decisionReason : undefined,
      mcpServer: opts.mcpServer,
    }
    return new Promise<PermissionResult>(resolve => {
      this.pending.set(request.id, { request, resolve })
      this.record({ kind: 'permission', request })
      this.setStatus('waiting')
      opts.signal.addEventListener('abort', () => {
        if (!this.pending.delete(request.id)) return
        resolve({ behavior: 'deny', message: 'aborted' })
        this.record({ kind: 'permission-resolved', id: request.id, decision: 'cancel' })
      }, { once: true })
    })
  }

  /** A prompt this session still holds: waiting behind others, or taken up by the running turn. */
  promptState(id: string): PromptState | undefined {
    const at = this.prompts.filter(p => !p.taken).findIndex(p => p.id === id)
    if (at >= 0) return { state: 'queued', position: at + 1 }
    return this.prompts.some(p => p.id === id) ? { state: 'working' } : undefined
  }

  pendingRequests(): PermissionRequest[] {
    return [...this.pending.values()].map(p => p.request)
  }

  /** The before/after trees of a turn in `root` (the workspace, or another repo it wrote in), for the review's "turn" source. */
  async turnSnapshots(turnId?: string, root = this.info.workspace): Promise<{ before: string; after?: string; label: string } | undefined> {
    const log = this.log()
    const starts = log.filter((e): e is Extract<SessionEvent, { kind: 'turn-start' }> => e.kind === 'turn-start')
    const start = turnId ? starts.find(s => s.turnId === turnId) : starts[starts.length - 1]
    if (!start?.snapshot) return undefined
    const end = log.find((e): e is Extract<SessionEvent, { kind: 'turn-end' }> => e.kind === 'turn-end' && e.turnId === start.turnId)
    const label = `턴 ${starts.indexOf(start) + 1}`
    if (root === this.info.workspace) return { before: start.snapshot, after: end?.snapshot, label }
    const recorded = end?.repos?.find(r => r.path === root)
    if (recorded?.before) return { before: recorded.before, after: recorded.after, label }
    const live = !end && this.turn?.id === start.turnId ? await this.turn.repos.get(root) : undefined
    if (live) return { before: live, label }
    throw new HttpError(404, `${label}에는 이 저장소의 변경 기록이 없어`)
  }

  /** Each turn as seen from one tree: what it changed there, whether it wrote there, the commit it started on. */
  async turns(root: string): Promise<TurnRef[]> {
    const ws = this.info.workspace
    return Promise.all((await turnsOf(this.log(), ws)).map(async t => {
      let files = recordedFiles(t, root, ws)
      // A turn still running (or cut off) has its snapshots but no counts yet.
      if (files === undefined && !t.end?.summary) {
        const snap = await this.turnSnapshots(t.turnId, root).catch(() => undefined)
        const after = snap && (snap.after ?? (await snapshot(root)))
        if (snap && after) files = (await changeStats(root, snap.before, after)).files
      }
      const wrote = t.wrote.has(root)
      const base = wrote || (files ?? 0) > 0 ? await headAt(root, t.started) : undefined
      return { turnId: t.turnId, n: t.n, started: t.started, ended: t.end?.ts, files, wrote, base }
    }))
  }

  close() {
    clearTimeout(this.idleTimer)
    this.inbox?.close()
  }
}

const sum = (list: RepoChanges[], k: keyof RepoChanges) => list.reduce((n, c) => n + c[k], 0)

async function changeStats(root: string, before: string, after: string): Promise<{ files: number; additions: number; deletions: number }> {
  if (before === after) return { files: 0, additions: 0, deletions: 0 }
  const out = await git(root, ['diff', '--numstat', before, after], { allowFail: true })
  let files = 0, additions = 0, deletions = 0
  for (const line of out.split('\n')) {
    const [a, d] = line.split('\t')
    if (a === undefined || d === undefined) continue
    files++
    additions += Number(a) || 0
    deletions += Number(d) || 0
  }
  return { files, additions, deletions }
}

/** The prompt text the agent reads: the person's words, then what they pointed at or were looking at. */
export function composePrompt(text: string, context?: ContextItem[]): string {
  if (!context?.length) return text
  return `${text}\n\n<context from Duet>\n${context.map(refOf).join('\n')}\n</context from Duet>`
}

function refOf(c: ContextItem): string {
  switch (c.kind) {
    case 'canvas': return `- canvas map "${c.map}", ${c.target ? `target ${c.target}` : 'whole map'} (${c.label})`
    case 'review': return `- ${c.path}${c.lines ? `:${c.lines}` : ''} (${c.label})`
    case 'file': return `- ${c.path}`
    case 'map-view': return `- The map on screen: "${c.title}" (canvas map "${c.map}", rev ${c.revision})${c.selected ? `, ${c.selected} selected` : ''}. Read it with mcp__duet__canvas_read.`
    case 'review-view': {
      const more = c.total - c.files.length
      return [
        `- The review on screen: ${sourceWords(c.source)}, in the repo ${c.root}`,
        `  Whole diff: ${diffCommand(c)}`,
        ...(c.scope ? [`  Narrowed to the map part "${c.scope}".`] : []),
        `  The ${c.total} files on screen:`,
        ...c.files.map(f => `  - ${f}`),
        ...(more > 0 ? [`  - … and ${more} more`] : []),
      ].join('\n')
    }
  }
}

function sourceWords(s: DiffSource): string {
  switch (s.kind) {
    case 'working': return 'uncommitted changes (HEAD to the working tree)'
    case 'branch': return `${s.compare === 'WORKTREE' ? 'the working tree' : s.compare} since it left ${s.base}`
    case 'commits': return s.from ? `commits ${s.from}..${s.to}` : `commit ${s.to}`
    case 'turn': return 'what one agent turn changed (Duet snapshots of the tree)'
    case 'pr': return s.number ? `pull request #${s.number}` : 'the pull request of the checked-out branch'
  }
}

const shellWord = (s: string) => (/^[\w./@:+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

function diffCommand(c: Extract<ContextItem, { kind: 'review-view' }>): string {
  const root = shellWord(c.root)
  if (c.source.kind === 'pr') return `\`cd ${root} && gh pr diff${c.source.number ? ` ${c.source.number}` : ''}\``
  if (c.head === 'WORKTREE') return `\`git -C ${root} diff ${c.base}\`; untracked files are not in git diff: \`git -C ${root} ls-files --others --exclude-standard\``
  return `\`git -C ${root} diff ${c.base} ${c.head}\``
}
