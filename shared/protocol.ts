// The wire contract between the Duet server and the browser.
// Everything the server persists or streams is described here; the browser never sees
// raw process state, only these events.

/** A git working tree Duet works in: the agent's cwd and the review's default target. */
export type Workspace = {
  /** Absolute path of the working tree root. */
  path: string
  /** Display name: the folder name, or `repo/worktree` for a linked worktree. */
  name: string
  /** The main repository's root when this is a linked worktree. */
  mainRoot?: string
  branch?: string
  lastOpened: number
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'auto' | 'dontAsk'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type SessionStatus = 'idle' | 'starting' | 'running' | 'waiting' | 'stopped' | 'error'

export type SessionInfo = {
  id: string
  /** Claude Code's own session id (the transcript file), once the process has started. */
  claudeId?: string
  workspace: string
  title: string
  model?: string
  effort?: Effort
  permissionMode: PermissionMode
  status: SessionStatus
  created: number
  updated: number
  /** Running totals over every finished turn. */
  costUsd: number
  turns: number
  /** The context the main agent's latest call read: what its next call starts from. */
  contextTokens?: number
  /** The context window of that call's model, from the turn's result. */
  contextWindow?: number
  /** Git repos other than the workspace that the agent wrote files in (a worktree under it, a sibling repo). */
  repos?: string[]
  /** Where the conversation works: the tree (the workspace or another repo) the latest turn that changed files changed most. */
  workTree?: string
}

/** Something the person attached to a prompt: where it came from, and the text the agent reads. */
export type ContextItem =
  | { kind: 'canvas'; map: string; target: string; label: string }
  | { kind: 'review'; path: string; lines?: string; label: string }
  | { kind: 'file'; path: string; label: string }
  /**
   * The review on screen when the person wrote. `base`/`head` are the diff's refs ('WORKTREE' = the tree on disk);
   * `files` are the first 60 of the `total` files listed, after the map scope and the filter.
   */
  | { kind: 'review-view'; label: string; root: string; source: DiffSource; base: string; head: string; files: string[]; total: number; scope?: string }
  /** The map on screen when the person wrote; `selected` is the selected part's id and label. */
  | { kind: 'map-view'; label: string; map: string; title: string; revision: number; selected?: string }

/** A picture the person pasted: kept beside the log, served back by name. */
export type ImageRef = { file: string; mediaType: string }
export type ImageUpload = { mediaType: string; data: string }

export type PermissionSuggestion = Record<string, unknown>

export type PermissionRequest = {
  id: string
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  suggestions?: PermissionSuggestion[]
  blockedPath?: string
  reason?: string
  /** For MCP tools: which server serves it ('sdk' = Duet's own). */
  mcpServer?: { name: string; source: string }
}

export type PermissionDecision =
  | { behavior: 'allow'; always?: boolean; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message?: string; interrupt?: boolean }

export type TurnSummary = {
  durationMs: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  isError: boolean
  subtype: string
  /** The final text, when the turn ended with one. */
  result?: string
  /** What the turn changed (from its snapshots), the workspace and every other repo it wrote in together. */
  changes?: { files: number; additions: number; deletions: number }
  /** The part of `changes` in each repo other than the workspace. */
  repos?: ({ path: string } & RepoChanges)[]
}

export type RepoChanges = { files: number; additions: number; deletions: number }

/** One turn of a conversation, as seen from one tree. */
export type TurnRef = {
  turnId: string
  /** 턴 n, counted the way the review labels turns. */
  n: number
  started: number
  ended?: number
  /** Files the turn changed in the tree per its snapshots; undefined when it kept no snapshot of the tree. */
  files?: number
  /** An edit tool aimed into the tree, per the log. */
  wrote: boolean
  /** HEAD of the tree when the turn started (only for turns that wrote or changed files there). */
  base?: { sha: string; subject: string; date: number }
}

/** A repo other than the workspace that its conversations wrote in, or its maps point at: reviewable from the workspace. */
export type ReviewRepo = { path: string; name: string; branch?: string; label: string; sessions: string[]; maps: string[] }

/**
 * One entry of a session's log. `seq` orders the entries of one session; the browser replays the
 * log, then applies live events with a higher seq.
 */
export type SessionEvent = { seq: number; ts: number } & (
  /** `display` is what the person typed when `text` (what the agent reads) wraps it in a template. */
  | { kind: 'user'; id: string; text: string; display?: string; context?: ContextItem[]; queued?: boolean; images?: ImageRef[] }
  /** A message from the agent process, kept as the SDK sent it (minus streaming deltas). */
  | { kind: 'sdk'; msg: SdkMessage }
  | { kind: 'turn-start'; turnId: string; snapshot?: string }
  /** `prompts`: the person's messages (ids) this turn answered, or was working on when it was cut off. */
  | { kind: 'turn-end'; turnId: string; snapshot?: string; summary?: TurnSummary; repos?: { path: string; before?: string; after?: string }[]; prompts?: string[] }
  | { kind: 'permission'; request: PermissionRequest }
  | { kind: 'permission-resolved'; id: string; decision: 'allow' | 'deny' | 'cancel'; always?: boolean; message?: string }
  | { kind: 'status'; status: SessionStatus; detail?: string }
  | { kind: 'notice'; level: 'info' | 'warn' | 'error'; text: string }
)

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
/** A session event before the log numbers and stamps it. */
export type SessionEventBody = DistributiveOmit<SessionEvent, 'seq' | 'ts'>

/** A loose view of an SDK message; the browser reads the fields it needs. */
export type SdkMessage = { type: string; subtype?: string; [key: string]: unknown }

/** What the server pushes over the one SSE connection. */
export type ServerEvent =
  | { topic: 'session'; sessionId: string; event: SessionEvent }
  /** Streaming deltas: shown live, never stored. */
  | { topic: 'delta'; sessionId: string; msg: SdkMessage }
  | { topic: 'sessions'; sessions: SessionInfo[] }
  | { topic: 'repo-changed'; workspace: string; paths: string[] }
  | { topic: 'canvas'; workspace: string; name: string; revision: number; by: 'agent' | 'person' }
  | { topic: 'canvas-list'; workspace: string }
  | { topic: 'terminals'; terminals: TerminalInfo[] }
  /** `stale`: the server's code changed on disk after it started, so the browser may run newer UI than it. */
  | { topic: 'hello'; version: string; stale?: boolean }
  | { topic: 'stale' }

// ------------------------------------------------------------------ review

/** Which changes the review shows. */
export type DiffSource =
  /** Everything not committed in the tree: staged, unstaged and untracked. */
  | { kind: 'working' }
  /** compare's changes since it left base (`base...compare`); compare 'WORKTREE' = the tree on disk. */
  | { kind: 'branch'; base: string; compare: string }
  /** One commit, or a range `from..to`. */
  | { kind: 'commits'; from?: string; to: string }
  /** What one agent turn changed (two snapshots of the tree). */
  | { kind: 'turn'; sessionId: string; turnId?: string }
  /** A pull request's changes, as GitHub sees them; the PR for the checked-out branch when no number. */
  | { kind: 'pr'; number?: number }

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'binary'

export type DiffLine = {
  type: 'ctx' | 'add' | 'del'
  text: string
  oldNo?: number
  newNo?: number
}

export type DiffHunk = {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export type DiffFile = {
  path: string
  oldPath?: string
  status: FileStatus
  additions: number
  deletions: number
  hunks: DiffHunk[]
  binary?: boolean
  /** Too big to show inline; the browser offers to load it. */
  large?: boolean
}

export type DiffResult = {
  workspace: string
  source: DiffSource
  /** Labels for the header: what is being compared with what. */
  oldLabel: string
  newLabel: string
  /** Refs the browser passes back to read whole files: a commit/tree id, or 'WORKTREE'. */
  oldRef: string
  newRef: string
  files: DiffFile[]
  generatedAt: number
}

export type ReviewComment = {
  id: string
  path: string
  /** 'new' anchors to the new side's line numbers, 'old' to the deleted side. */
  side: 'old' | 'new'
  startLine: number
  endLine: number
  /** The anchored lines' text when written, to find them again after the diff moves. */
  excerpt: string
  body: string
  created: number
  state: 'draft' | 'sent' | 'resolved'
  /** The conversation or terminal and the prompt it went out with. */
  sentTo?: { sessionId: string; messageId: string } | { terminal: string; messageId: string }
  /** The anchor could not be found in the latest diff. */
  outdated?: boolean
}

export type GitInfo = {
  root: string
  branch?: string
  head?: string
  branches: { name: string; remote: boolean; current: boolean; upstream?: string; updated: number }[]
  worktrees: { path: string; branch?: string; head?: string; current: boolean; bare?: boolean }[]
  defaultBase?: string
  dirtyCount: number
}

// ------------------------------------------------------------------ canvas

export type { CanvasMap, CanvasElement, CanvasRelation, CanvasDecision, CanvasMessage, CanvasFragment } from './canvas.ts'

/**
 * The code a map is about, kept beside the map rather than in its revisions: the tree it is reviewed in and what to
 * compare there. A map drawn before the code is bound to its tree from the commit it was made at (`base...WORKTREE`),
 * so what is built from it shows up; a map made to review code is bound to that PR, branch or commits.
 */
export type MapCode = { root: string; source: DiffSource; set: number }

/** A source in words, for the agent: what a map's review shows. */
export function describeSource(s: DiffSource): string {
  if (s.kind === 'working') return 'what is not committed'
  if (s.kind === 'branch') return `${s.compare === 'WORKTREE' ? 'the working tree' : s.compare} since ${/^[0-9a-f]{40}$/.test(s.base) ? s.base.slice(0, 7) : s.base}`
  if (s.kind === 'commits') return s.from ? `commits ${s.from}..${s.to}` : `commit ${s.to}`
  if (s.kind === 'pr') return s.number ? `PR #${s.number}` : 'the PR of the checked-out branch'
  return 'one turn'
}

export type CanvasSummary = {
  name: string
  title: string
  diagram: 'class' | 'sequence'
  revision: number
  updated: number
  elements: number
  decisions: number
  openDecisions: number
  openThreads: number
  code?: MapCode
}

/** A conversation pinned to a spot on the canvas. */
export type CanvasThread = {
  id: string
  /** Element id, relation key (`from->to`), message id, decision id, or '' for the whole map. */
  target: string
  targetLabel: string
  revision: number
  state: 'open' | 'resolved'
  /** `terminal`: the terminal it went to or came from, instead of a conversation. */
  items: { id: string; who: 'person' | 'agent'; text: string; ts: number; sessionId?: string; terminal?: string; messageId?: string }[]
  created: number
}

// ------------------------------------------------------------------ terminals

/** A Claude Code session in a terminal that runs the Duet mod: it reads and changes maps, and takes what Duet sends it. */
export type TerminalInfo = {
  /** Claude Code's session id. */
  id: string
  workspace: string
  cwd: string
  /** `<cwd folder> · <id8>` */
  label: string
  /** The map the terminal works from, pinned there with `/duet <map>`. */
  map?: string
  lastSeen: number
}
