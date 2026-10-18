// Turns a session's log (and live streaming deltas) into blocks the panel draws.
// Mutable on purpose: deltas arrive dozens of times a second, so blocks change in place and
// carry a `rev` that memoized components compare.

import type { ContextItem, ImageRef, PermissionRequest, SdkMessage, SessionEvent, SessionStatus, TurnSummary } from '../../../shared/protocol.ts'

type Base = { key: string; rev: number }
export type UserBlock = Base & { kind: 'user'; id: string; text: string; display?: string; context?: ContextItem[]; queued?: boolean; ts: number; imported?: boolean; images?: ImageRef[]; summary?: boolean }
/** `ts`: when its final form was logged. */
export type TextBlock = Base & { kind: 'text'; text: string; streaming: boolean; ts?: number }
export type ThinkingBlock = Base & { kind: 'thinking'; text: string; streaming: boolean; started: number; ended?: number }
export type PermissionState = { request: PermissionRequest; state: 'pending' | 'allow' | 'deny' | 'cancel'; always?: boolean; message?: string }
export type ToolBlock = Base & {
  kind: 'tool'
  id: string
  name: string
  inputText: string
  input?: Record<string, unknown>
  state: 'input' | 'running' | 'done' | 'error'
  result?: string
  resultMeta?: unknown
  started: number
  ended?: number
  elapsed?: number
  children: Block[]
  permission?: PermissionState
}
export type TurnBlock = Base & { kind: 'turn'; turnId: string; summary?: TurnSummary; started?: number; ended: number }
export type NoticeBlock = Base & { kind: 'notice'; level: 'info' | 'warn' | 'error'; text: string }
export type OrphanPermissionBlock = Base & { kind: 'permission'; permission: PermissionState }
export type Block = UserBlock | TextBlock | ThinkingBlock | ToolBlock | TurnBlock | NoticeBlock | OrphanPermissionBlock

export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }

/** A card waiting on the person: a question, a plan to approve, or a permission. */
export type Waiting = { id: string; kind: 'ask' | 'plan' | 'perm' }

/** Per kind: how the strip names and counts it, what a click there is for, and what the agent is doing meanwhile. */
const WAITS: Record<Waiting['kind'], { name: string; counted: boolean; act: string; doing: string }> = {
  ask: { name: '질문', counted: true, act: '답하기', doing: '답 대기' },
  perm: { name: '승인', counted: true, act: '보기', doing: '승인 대기' },
  plan: { name: '계획 확인', counted: false, act: '보기', doing: '계획 확인 대기' },
}

let keySeq = 0
const nextKey = () => `b${++keySeq}`

type ContentBlock = { type: string; id?: string; name?: string; text?: string; thinking?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(c => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '')).filter(Boolean).join('\n')
  return ''
}

export class Transcript {
  blocks: Block[] = []
  version = 0
  lastSeq = 0
  status: SessionStatus = 'idle'
  turnStarted?: number
  todos?: Todo[]
  init?: SdkMessage
  apiStatus?: string
  private tools = new Map<string, ToolBlock>()
  private perms = new Map<string, PermissionState & { owner: Block }>()
  /** Streamed blocks of each assistant message, waiting for its final form. */
  private streamed = new Map<string, Block[]>()
  private live = new Map<string, Block>()
  private currentMsg = new Map<string, string>()
  /** A nested block's subagent tool: changing the child must redraw every card around it. */
  private parentOf = new Map<string, ToolBlock>()

  private touch(b: Block) {
    b.rev++
    let p = this.parentOf.get(b.key)
    while (p) { p.rev++; p = this.parentOf.get(p.key) }
    this.version++
  }

  /** Adds a block under its subagent (or at the top), and redraws the cards that hold it. */
  private place(parent: unknown, block: Block) {
    const owner = typeof parent === 'string' && parent ? this.tools.get(parent) : undefined
    if (owner) { owner.children.push(block); this.parentOf.set(block.key, owner); this.touch(owner) }
    else this.blocks.push(block)
  }

  pending(): PermissionState[] {
    return [...this.perms.values()].filter(p => p.state === 'pending')
  }

  /** What waits on the person, oldest first. */
  waiting(): Waiting[] {
    return this.pending().map(p => ({ id: p.request.id, kind: p.request.toolName === 'AskUserQuestion' ? 'ask' : p.request.toolName === 'ExitPlanMode' ? 'plan' : 'perm' }))
  }

  // ---------------------------------------------------------------- stored events

  /** When the event before this one happened: a thinking block read back from the log ran from then until it was written. */
  private prevTs?: number
  private lastTs?: number

  apply(ev: SessionEvent) {
    this.prevTs = this.lastTs
    this.lastTs = ev.ts
    if (ev.seq && ev.seq <= this.lastSeq && ev.kind !== 'status') return
    if (ev.seq) this.lastSeq = Math.max(this.lastSeq, ev.seq)
    switch (ev.kind) {
      case 'user':
        this.blocks.push({ kind: 'user', key: nextKey(), rev: 0, id: ev.id, text: ev.text, display: ev.display, context: ev.context, queued: ev.queued, ts: ev.ts, images: ev.images })
        break
      case 'sdk':
        this.applySdk(ev.msg, ev.ts)
        break
      case 'turn-start':
        this.turnStarted = ev.ts
        break
      case 'turn-end':
        this.finishStreaming()
        this.blocks.push({ kind: 'turn', key: nextKey(), rev: 0, turnId: ev.turnId, summary: ev.summary, started: this.turnStarted, ended: ev.ts })
        this.turnStarted = undefined
        this.apiStatus = undefined
        break
      case 'permission': {
        const owner = ev.request.toolUseId ? this.tools.get(ev.request.toolUseId) : undefined
        const state: PermissionState = { request: ev.request, state: 'pending' }
        if (owner) {
          owner.permission = state
          this.perms.set(ev.request.id, { ...state, owner })
          this.touch(owner)
        } else {
          const block: OrphanPermissionBlock = { kind: 'permission', key: nextKey(), rev: 0, permission: state }
          this.blocks.push(block)
          this.perms.set(ev.request.id, { ...state, owner: block })
        }
        break
      }
      case 'permission-resolved': {
        const p = this.perms.get(ev.id)
        if (!p) break
        p.state = ev.decision
        p.always = ev.always
        p.message = ev.message
        const target = p.owner.kind === 'tool' ? p.owner.permission : p.owner.kind === 'permission' ? p.owner.permission : undefined
        if (target) { target.state = ev.decision; target.always = ev.always; target.message = ev.message }
        this.touch(p.owner)
        break
      }
      case 'status':
        this.status = ev.status
        if (ev.status !== 'running' && ev.status !== 'waiting') this.apiStatus = undefined
        break
      case 'notice':
        this.blocks.push({ kind: 'notice', key: nextKey(), rev: 0, level: ev.level, text: ev.text })
        break
    }
    this.version++
  }

  private finishStreaming() {
    for (const list of this.streamed.values()) for (const b of list) {
      if ((b.kind === 'text' || b.kind === 'thinking') && b.streaming) { b.streaming = false; this.touch(b) }
    }
    this.streamed.clear()
    this.live.clear()
    for (const t of this.tools.values()) {
      // A background subagent's steps, and a question still waiting, outlive the turn.
      if (this.parentOf.has(t.key) || t.permission?.state === 'pending') continue
      if (t.state === 'input' || t.state === 'running') {
        // A tool with no result when the turn ended was cut off (interrupt or crash).
        t.state = 'error'
        t.result = t.result ?? '중단됨'
        t.ended = Date.now()
        this.touch(t)
      }
    }
  }

  private applySdk(msg: SdkMessage, ts: number) {
    const parent = msg.parent_tool_use_id
    if (msg.type === 'assistant') {
      const message = msg.message as { id?: string; content?: ContentBlock[] }
      const list = message.id ? this.streamed.get(message.id) : undefined
      for (const c of message.content ?? []) {
        if (c.type === 'redacted_thinking') continue
        const kind = c.type === 'tool_use' ? 'tool' : c.type === 'thinking' ? 'thinking' : c.type === 'text' ? 'text' : undefined
        if (!kind) continue
        const i = list ? list.findIndex(b => b.kind === kind && (kind !== 'tool' || (b as ToolBlock).id === c.id)) : -1
        let block = i >= 0 ? list!.splice(i, 1)[0] : undefined
        if (!block) {
          block = this.createBlock(kind, c, ts)
          // Not streamed (read back from the log): it took from the previous event until now.
          if (block.kind === 'thinking' && this.prevTs && this.prevTs < ts) { block.started = this.prevTs; block.ended = ts }
          this.place(parent, block)
        }
        this.finalize(block, c, ts)
      }
      return
    }
    if (msg.type === 'user') {
      const content = (msg.message as { content?: unknown })?.content
      if (Array.isArray(content)) {
        const results = (content as ContentBlock[]).filter(c => c.type === 'tool_result')
        for (const r of results) {
          const tool = r.tool_use_id ? this.tools.get(r.tool_use_id) : undefined
          if (!tool) continue
          tool.state = r.is_error ? 'error' : 'done'
          tool.result = textOf(r.content)
          if (results.length === 1) tool.resultMeta = msg.tool_use_result
          tool.ended = ts
          this.touch(tool)
        }
        if (!results.length && (msg.imported || msg.isCompactSummary)) {
          const text = textOf(content)
          if (text && !text.startsWith('<')) this.pushHistoryUser(msg, text, ts)
        }
      } else if (typeof content === 'string' && (msg.imported || msg.isCompactSummary) && !content.startsWith('<')) {
        this.pushHistoryUser(msg, content, ts)
      }
      return
    }
    if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
      this.blocks.push({ kind: 'notice', key: nextKey(), rev: 0, level: 'info', text: '대화를 요약했어' })
      return
    }
    if (msg.type === 'system' && msg.subtype === 'task_notification') {
      const status = msg.status === 'completed' ? '끝났어' : msg.status === 'failed' ? '실패했어' : '멈췄어'
      this.blocks.push({ kind: 'notice', key: nextKey(), rev: 0, level: msg.status === 'failed' ? 'warn' : 'info', text: `백그라운드 작업이 ${status}${msg.summary ? `: ${String(msg.summary).slice(0, 160)}` : ''}` })
      return
    }
    if (msg.type === 'system' && msg.subtype === 'api_retry') {
      this.blocks.push({ kind: 'notice', key: nextKey(), rev: 0, level: 'warn', text: `API 재시도 중 (${msg.attempt}/${msg.max_retries})` })
    }
  }

  /** A user turn from history (an imported session), or the summary Claude Code wrote when it compacted. */
  private pushHistoryUser(msg: SdkMessage, text: string, ts: number) {
    const summary = msg.isCompactSummary === true
    this.blocks.push({ kind: 'user', key: nextKey(), rev: 0, id: String(msg.uuid ?? nextKey()), text: summary ? summaryBody(text) : text, ts, imported: Boolean(msg.imported), summary })
  }

  private createBlock(kind: 'tool' | 'thinking' | 'text', c: ContentBlock, ts: number): Block {
    if (kind === 'tool') {
      const t: ToolBlock = { kind: 'tool', key: nextKey(), rev: 0, id: c.id ?? nextKey(), name: c.name ?? '?', inputText: '', state: 'input', started: ts, children: [] }
      this.tools.set(t.id, t)
      return t
    }
    if (kind === 'thinking') return { kind: 'thinking', key: nextKey(), rev: 0, text: '', streaming: false, started: ts }
    return { kind: 'text', key: nextKey(), rev: 0, text: '', streaming: false }
  }

  private finalize(block: Block, c: ContentBlock, ts: number) {
    if (block.kind === 'text') { block.text = c.text ?? block.text; block.streaming = false; block.ts = ts }
    // A streamed thinking block was timed as it ran; one read back from the log was given its span above.
    else if (block.kind === 'thinking') { block.text = c.thinking || block.text; block.streaming = false; block.ended = block.ended ?? block.started }
    else if (block.kind === 'tool') {
      block.input = (c.input ?? {}) as Record<string, unknown>
      block.inputText = JSON.stringify(block.input)
      if (block.state === 'input') block.state = 'running'
      if (block.name === 'TodoWrite' && Array.isArray(block.input.todos)) this.todos = block.input.todos as Todo[]
    }
    this.touch(block)
  }

  // ---------------------------------------------------------------- live deltas

  applyDelta(msg: SdkMessage) {
    if (msg.type === 'stream_event') return this.applyStream(msg)
    if (msg.type === 'tool_progress') {
      const t = this.tools.get(String(msg.tool_use_id))
      if (t) { t.elapsed = Number(msg.elapsed_time_seconds); this.touch(t) }
      return
    }
    // Token counts are bookkeeping, not something the person reads.
    if (msg.type === 'system' && msg.subtype === 'thinking_tokens') return
    if (msg.type === 'system' && msg.subtype === 'init') { this.init = msg; this.version++; return }
    if (msg.type === 'system' && msg.subtype === 'status') {
      this.apiStatus = (msg.status as string | null) ?? undefined
      this.version++
    }
  }

  private applyStream(msg: SdkMessage) {
    const ev = msg.event as { type: string; index?: number; message?: { id: string }; content_block?: ContentBlock; delta?: { type: string; text?: string; thinking?: string; partial_json?: string } }
    const parent = (msg.parent_tool_use_id as string | null) ?? ''
    if (ev.type === 'message_start' && ev.message) {
      this.currentMsg.set(parent, ev.message.id)
      if (!this.streamed.has(ev.message.id)) this.streamed.set(ev.message.id, [])
      return
    }
    const msgId = this.currentMsg.get(parent)
    if (!msgId) return
    const liveKey = `${msgId}:${ev.index}`
    if (ev.type === 'content_block_start' && ev.content_block) {
      const c = ev.content_block
      const kind = c.type === 'tool_use' ? 'tool' : c.type === 'thinking' ? 'thinking' : c.type === 'text' ? 'text' : undefined
      if (!kind) return
      const block = this.createBlock(kind, c, Date.now())
      if (block.kind === 'text' || block.kind === 'thinking') block.streaming = true
      this.place(parent, block)
      this.streamed.get(msgId)?.push(block)
      this.live.set(liveKey, block)
      this.version++
      return
    }
    const block = this.live.get(liveKey)
    if (!block) return
    if (ev.type === 'content_block_delta' && ev.delta) {
      const d = ev.delta
      if (d.type === 'text_delta' && block.kind === 'text') block.text += d.text ?? ''
      else if (d.type === 'thinking_delta' && block.kind === 'thinking') block.text += d.thinking ?? ''
      else if (d.type === 'input_json_delta' && block.kind === 'tool') block.inputText += d.partial_json ?? ''
      else return
      this.touch(block)
    } else if (ev.type === 'content_block_stop') {
      if (block.kind === 'thinking') block.ended = Date.now()
      if (block.kind === 'tool' && block.state === 'input') block.state = 'running'
      this.live.delete(liveKey)
      this.touch(block)
    }
  }

  // ---------------------------------------------------------------- derived

  /** What the agent is doing right now, in a few words. */
  activity(): { label: string; tone: 'think' | 'write' | 'tool' | 'wait' | 'idle' } {
    const waits = this.waiting()
    if (waits.length) return { label: WAITS[waits[0].kind].doing, tone: 'wait' }
    if (this.apiStatus === 'compacting') return { label: '대화를 요약하는 중', tone: 'think' }
    const last = lastLeaf(this.blocks)
    if (this.status === 'starting') return { label: '시작하는 중', tone: 'think' }
    if (this.status !== 'running') return { label: '', tone: 'idle' }
    if (last?.kind === 'thinking' && last.streaming) return { label: '생각하는 중', tone: 'think' }
    if (last?.kind === 'text' && last.streaming) return { label: '답을 쓰는 중', tone: 'write' }
    if (last?.kind === 'tool' && (last.state === 'running' || last.state === 'input')) return { label: toolVerb(last), tone: 'tool' }
    return { label: '생각하는 중', tone: 'think' }
  }
}

/** "질문 1개 · 승인 2개 · 답하기": what waits, by kind in the order it came, then what the first one asks for. */
export function waitLabel(waits: Waiting[]): string {
  const kinds = [...new Set(waits.map(w => w.kind))]
  const parts = kinds.map(k => (WAITS[k].counted ? `${WAITS[k].name} ${waits.filter(w => w.kind === k).length}개` : WAITS[k].name))
  return [...parts, WAITS[waits[0].kind].act].join(' · ')
}

/**
 * The main agent's latest words in the turn under way: the last sentence of its last finished
 * top-level text (a subagent's words sit inside its card). `since` is set once it is half a minute old.
 */
export function narration(blocks: Block[], now: number): { key: string; text: string; since?: number } | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (b.kind === 'turn') return undefined
    if (b.kind !== 'text' || b.streaming) continue
    const text = lastSentence(b.text)
    if (text) return { key: b.key, text, since: b.ts && now - b.ts > 30_000 ? b.ts : undefined }
  }
  return undefined
}

/** The last sentence of a message, on one line, without code blocks or markdown marks. */
function lastSentence(text: string): string {
  const lines = text.replace(/```[\s\S]*?(```|$)/g, '').split('\n').map(l => l.replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/, '').replace(/\*\*|`/g, '').trim()).filter(Boolean)
  return lines.pop()?.split(/(?<=[.!?])\s+/).pop() ?? ''
}

function lastLeaf(blocks: Block[]): Block | undefined {
  const last = blocks[blocks.length - 1]
  if (last?.kind === 'tool' && last.children.length && (last.state === 'running' || last.state === 'input')) return lastLeaf(last.children) ?? last
  return last
}

export function toolVerb(t: ToolBlock): string {
  const n = t.name
  if (n === 'Bash') return '명령 실행 중'
  if (n === 'Read') return '파일 읽는 중'
  if (n === 'Edit' || n === 'MultiEdit' || n === 'Write' || n === 'NotebookEdit') return t.state === 'input' ? '수정 준비 중' : '파일 수정 중'
  if (n === 'Grep' || n === 'Glob') return '검색 중'
  if (n === 'WebFetch' || n === 'WebSearch') return '웹 검색 중'
  if (n === 'Task' || n === 'Agent') return '하위 에이전트 실행 중'
  if (n.startsWith('mcp__duet__canvas')) return '지도 그리는 중'
  if (n === 'TodoWrite') return '할 일 정리 중'
  return `${n} 실행 중`
}

/** Parse the partial JSON of a streaming tool input as far as it goes. */
export function partialInput(t: ToolBlock): Record<string, unknown> {
  if (t.input) return t.input
  const s = t.inputText
  if (!s) return {}
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    // Close what is open: good enough to show a command or a path while it streams.
    let fixed = s
    const quotes = (fixed.match(/(?<!\\)"/g) ?? []).length
    if (quotes % 2) fixed += '"'
    const opens = (fixed.match(/[{[]/g) ?? []).length - (fixed.match(/[}\]]/g) ?? []).length
    for (let i = 0; i < opens; i++) fixed += '}'
    try {
      return JSON.parse(fixed) as Record<string, unknown>
    } catch {
      const m = /"(command|file_path|pattern|url|query|description)"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(s)
      return m ? { [m[1]]: m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"') } : {}
    }
  }
}

/** The summary without Claude Code's framing (the lead-in line and the "continue from here" instructions). */
export function summaryBody(text: string): string {
  let t = text
  const start = t.indexOf('Summary:\n')
  if (start >= 0 && start < 400) t = t.slice(start + 'Summary:\n'.length)
  const end = t.search(/\n\n(If you need specific details from before compaction|Continue the conversation from where it left off|Please continue the conversation)/)
  if (end > 0) t = t.slice(0, end)
  return t.trim()
}

/** Blocks worth opening in the reader: the agent's answers and compaction summaries, top level only. */
export function readableBlocks(blocks: Block[]): (TextBlock | UserBlock)[] {
  return blocks.filter((b): b is TextBlock | UserBlock => (b.kind === 'text' && b.text.trim().length > 0) || (b.kind === 'user' && Boolean(b.summary)))
}

/** Markdown marks dropped, whitespace folded: text fit for one line. */
export function plain(text: string): string {
  return text.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * One line that says what a thinking block was about. Summarized thinking opens its parts with
 * bold titles ("**Checking the diff**"); those read best joined. Without titles, the opening words.
 */
export function thinkingGist(text: string): string {
  const titles = [...text.matchAll(/^\s*\*\*(.+?)\*\*\s*$/gm)].map(m => plain(m[1])).filter(Boolean)
  if (titles.length) return titles.join(' · ')
  return plain(text).slice(0, 400)
}
