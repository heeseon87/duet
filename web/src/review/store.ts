import { create } from 'zustand'
import type { DiffFile, DiffResult, DiffSource, GitInfo, ReviewComment, ReviewRepo, SessionInfo, TurnRef } from '../../../shared/protocol.ts'
import { api, q, subscribe } from '../api.ts'
import { local, useApp } from '../state.ts'
import { reanchor } from './anchor.ts'
import { filesUnder, labelOf, type CanvasMap } from '../../../shared/canvas.ts'

export type ViewMode = 'unified' | 'split'
export type Draft = { path: string; side: 'old' | 'new'; start: number; end: number; excerpt: string; editing?: string }

type ReviewState = {
  /** The workspace the review belongs to. */
  home?: string
  /** The working tree under review: the workspace itself, another worktree of it, or a repo its conversations wrote in. */
  root?: string
  /** The workspace's own git info (the top bar's branch and worktrees), whichever tree is under review. */
  homeInfo?: GitInfo
  /** Repos other than the workspace that its conversations wrote in, or its maps point at. */
  repos: ReviewRepo[]
  /** The file list as folders, or as the map's packages and boxes. */
  group: 'folders' | 'map'
  /** Only the files of one part of a map (a package or a box): their absolute paths. */
  scope?: { target: string; label: string; paths: string[] }
  /** The file list's filter box. */
  filter: string
  info?: GitInfo
  source: DiffSource
  diff?: DiffResult
  loading: boolean
  error?: string
  selected?: string
  mode: ViewMode
  ignoreWhitespace: boolean
  context: number
  wrap: boolean
  viewed: Record<string, string>
  comments: ReviewComment[]
  draft?: Draft
  /** A whole file opened on its own (from a link, search, or the file tree). */
  fileView?: { path: string; ref: string; line?: number }
  focusLine?: { path: string; line: number; nonce: number }
  /** What to show once the tree being opened is there. */
  pending?: DiffSource
  /** Paths written on disk in the last few seconds (the agent at work). */
  recent: Record<string, number>
  /** Opens the review of a workspace, on the tree the current conversation calls for. */
  init: (home: string) => Promise<void>
  open: (root: string) => Promise<void>
  /** The person picks the tree to review (for the current conversation). */
  setRoot: (root: string) => Promise<void>
  loadRepos: () => Promise<void>
  setGroup: (g: 'folders' | 'map') => void
  setScope: (scope: ReviewState['scope']) => void
  setFilter: (filter: string) => void
  /** From the canvas: review only the files of this part, in the repo that holds them. */
  showPart: (map: CanvasMap, target: string) => Promise<void>
  setSource: (s: DiffSource) => void
  /** A turn's changes; `root` picks the repo to show them in (the one the turn wrote in). */
  setTurnSource: (sessionId: string, turnId?: string, root?: string) => void
  /** The last turn of a conversation that changed files in the tree under review; `move` first goes to the tree the conversation works in. */
  showLastTurn: (sessionId: string, move?: boolean) => Promise<void>
  /** For a turn that kept no record of the tree: everything since the commit it started on. */
  sinceTurn: (turn: TurnRef) => void
  refresh: (quiet?: boolean) => Promise<void>
  select: (path: string | undefined) => void
  setMode: (m: ViewMode) => void
  toggle: (k: 'ignoreWhitespace' | 'wrap') => void
  setContext: (n: number) => void
  toggleViewed: (f: DiffFile) => void
  openFile: (path: string, line?: number, ref?: string) => Promise<void>
  closeFile: () => void
  setDraft: (d: Draft | undefined) => void
  saveComment: (body: string) => Promise<ReviewComment | undefined>
  updateComment: (id: string, patch: Partial<ReviewComment>) => Promise<void>
  removeComment: (id: string) => Promise<void>
  send: (ids: string[], extra?: string, newSession?: boolean) => Promise<void>
}

const sig = (f: DiffFile) => `${f.additions}:${f.deletions}:${f.hunks.map(h => h.lines.length).join(',')}`
const keyOf = (s: DiffSource) => JSON.stringify(s)

function sourceLabel(s: DiffSource): string {
  if (s.kind === 'working') return 'Changes'
  if (s.kind === 'branch') return `${s.compare === 'WORKTREE' ? 'Working tree' : s.compare} ← ${s.base}`
  if (s.kind === 'commits') return s.from ? `${s.from.slice(0, 7)}..${s.to.slice(0, 7)}` : `커밋 ${s.to.slice(0, 7)}`
  if (s.kind === 'pr') return s.number ? `PR #${s.number}` : '이 브랜치의 PR'
  return 'Turns'
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined
let generation = 0

const pickKey = (home: string, sessionId?: string) => (sessionId ? `review.root:${home}:${sessionId}` : `review.root:${home}`)

/** The tree the review shows for a conversation: the one picked for it, else where it works, else the workspace's last pick, else the workspace. */
function treeFor(home: string, repos: ReviewRepo[], session?: SessionInfo): string {
  const known = (p?: string | null) => (p && (p === home || repos.some(r => r.path === p)) ? p : undefined)
  return known(session && local.get(pickKey(home, session.id))) ?? known(session?.workTree) ?? known(local.get(pickKey(home))) ?? home
}

function conversation(home?: string): SessionInfo | undefined {
  const app = useApp.getState()
  return app.sessions.find(s => s.id === app.currentSession && s.workspace === home)
}

export const turnRefs = (sessionId: string, root: string) => api.get<TurnRef[]>(`/api/sessions/${sessionId}/turns${q({ root })}`)

/** A turn that changed files in the tree: per its snapshots, or, where it kept none, per what its edit tools wrote. */
export const changedFiles = (t: TurnRef) => (t.files ?? 0) > 0 || (t.files === undefined && t.wrote)

const since = (t: TurnRef): DiffSource | undefined => (t.base ? { kind: 'branch', base: t.base.sha, compare: 'WORKTREE' } : undefined)

/** Says the view stands in for a turn that kept no record of the tree, or that there is nothing to stand in with. */
function tellSince(t: TurnRef) {
  const { toast } = useApp.getState()
  if (t.base) toast(`턴 ${t.n} 기록이 없어 시작 직전 커밋 기준으로 보는 중 (추정)`)
  else toast(`턴 ${t.n}의 시작 커밋을 찾지 못했어`, 'error')
}

/** The home whose repos are loaded: until then the rule has nothing to check picks against. */
let ready: string | undefined

/** Moves the review where the rule says; this is not the person's pick. */
async function follow() {
  const { home, repos, loadRepos } = useReview.getState()
  if (!home) return
  const session = conversation(home)
  if (session?.workTree && session.workTree !== home && !repos.some(r => r.path === session.workTree)) await loadRepos()
  const tree = treeFor(home, useReview.getState().repos, session)
  if (tree !== useReview.getState().root) await useReview.getState().open(tree)
}

export const useReview = create<ReviewState>((set, get) => ({
  source: { kind: 'working' },
  loading: false,
  mode: (local.get('review.mode') as ViewMode) || 'unified',
  ignoreWhitespace: local.get('review.ws') !== '0',
  context: Number(local.get('review.context')) || 3,
  wrap: local.get('review.wrap') === '1',
  viewed: {},
  comments: [],
  recent: {},
  repos: [],
  group: local.get('review.group') === 'map' ? 'map' : 'folders',
  filter: '',

  init: async home => {
    set({ home, repos: [], homeInfo: undefined })
    void api.get<GitInfo>(`/api/git/info${q({ ws: home })}`).then(homeInfo => { if (get().home === home) set({ homeInfo }) }).catch(() => undefined)
    const repos = await api.get<ReviewRepo[]>(`/api/review/repos${q({ ws: home })}`).catch(() => [] as ReviewRepo[])
    if (get().home !== home) return
    set({ repos })
    ready = home
    await follow()
  },

  loadRepos: async () => {
    const home = get().home
    if (!home) return
    const repos = await api.get<ReviewRepo[]>(`/api/review/repos${q({ ws: home })}`).catch(() => undefined)
    if (repos && get().home === home) set({ repos })
  },

  setGroup: group => { local.set('review.group', group); set({ group }) },
  setScope: scope => set({ scope }),
  setFilter: filter => set({ filter }),

  showPart: async (map, target) => {
    const { home, repos, root } = get()
    if (!home) return
    const paths = filesUnder(map, target).map(r => (r.startsWith('/') ? r : `${home}/${r.replace(/^\.\//, '')}`))
    // The tree that holds most of them: the workspace, or a repo inside or beside it.
    const trees = [home, ...repos.map(r => r.path)].sort((a, b) => b.length - a.length)
    const tally = new Map<string, number>()
    for (const p of paths) { const t = trees.find(t => p.startsWith(t + '/')); if (t) tally.set(t, (tally.get(t) ?? 0) + 1) }
    const best = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? root
    local.set('review.group', 'map')
    set({ scope: { target, label: labelOf(map, target), paths }, group: 'map' })
    if (best && best !== root) await get().setRoot(best)
  },

  open: async root => {
    const saved = local.get(`review.source:${root}`)
    const source: DiffSource = saved ? JSON.parse(saved) : { kind: 'working' }
    const pending = get().pending
    set({ root, source: pending ?? (source.kind === 'turn' ? { kind: 'working' } : source), diff: undefined, selected: undefined, fileView: undefined, pending: undefined })
    const info = await api.get<GitInfo>(`/api/git/info${q({ ws: root })}`).catch(() => undefined)
    set({ info })
    await get().refresh()
  },

  setRoot: async root => {
    const home = get().home
    const known = () => root === home || get().repos.some(r => r.path === root)
    if (!known()) await get().loadRepos()
    // Another worktree of the workspace opens as a workspace of its own; a repo the conversations wrote in is reviewed from here.
    if (!known()) await api.post('/api/workspaces', { path: root })
    if (home) local.set(pickKey(home, useApp.getState().currentSession), root)
    await get().open(root)
  },

  setSource: source => {
    const root = get().root
    if (root && source.kind !== 'turn') local.set(`review.source:${root}`, JSON.stringify(source))
    set({ source, diff: undefined, selected: undefined, draft: undefined, fileView: undefined })
    void get().refresh()
  },

  setTurnSource: (sessionId, turnId, root) => {
    const source: DiffSource = { kind: 'turn', sessionId, turnId }
    if (!get().root || (root && root !== get().root)) {
      set({ pending: source })
      if (root && get().home) void get().setRoot(root)
      return
    }
    get().setSource(source)
  },

  showLastTurn: async (sessionId, move) => {
    const { sessions, toast } = useApp.getState()
    const root = (move && sessions.find(s => s.id === sessionId)?.workTree) || get().root
    if (!root) return
    const turns = await turnRefs(sessionId, root).catch((e: Error) => { toast(e.message, 'error'); return undefined })
    if (!turns) return
    const last = turns.filter(changedFiles).pop()
    const source = last && (last.files === undefined ? since(last) : { kind: 'turn', sessionId, turnId: last.turnId } as DiffSource)
    if (root !== get().root) { set({ pending: source }); await get().setRoot(root) }
    else if (source) get().setSource(source)
    if (!last) toast('이 대화에는 이 저장소의 파일을 바꾼 턴이 없어')
    else if (last.files === undefined) tellSince(last)
  },

  sinceTurn: turn => {
    const source = since(turn)
    if (source) get().setSource(source)
    tellSince(turn)
  },

  refresh: async quiet => {
    const { root, source, context, ignoreWhitespace } = get()
    if (!root) return
    const gen = ++generation
    if (!quiet) set({ loading: true, error: undefined })
    try {
      const [diff, comments, info] = await Promise.all([
        api.post<DiffResult>('/api/review/diff', { ws: root, source, context, ignoreWhitespace }),
        api.post<ReviewComment[]>('/api/review/comments/get', { ws: root, source }),
        quiet ? Promise.resolve(get().info) : api.get<GitInfo>(`/api/git/info${q({ ws: root })}`).catch(() => get().info),
      ])
      if (gen !== generation) return
      const viewedSaved = JSON.parse(local.get(`review.viewed:${root}:${keyOf(source)}`) ?? '{}') as Record<string, string>
      // A file stays "viewed" only while its diff is the one that was viewed.
      const viewed: Record<string, string> = {}
      for (const f of diff.files) if (viewedSaved[f.path] === sig(f)) viewed[f.path] = viewedSaved[f.path]
      const anchored = reanchor(comments, diff.files)
      const selected = get().selected && diff.files.some(f => f.path === get().selected) ? get().selected : diff.files[0]?.path
      set({ diff, comments: anchored, viewed, selected, loading: false, info, ...(root === get().home && info ? { homeInfo: info } : {}) })
      if (JSON.stringify(anchored) !== JSON.stringify(comments)) void api.post('/api/review/comments/put', { ws: root, source, comments: anchored })
    } catch (e) {
      if (gen !== generation) return
      set({ loading: false, error: (e as Error).message, diff: undefined })
    }
  },

  select: path => set({ selected: path, fileView: undefined, draft: get().draft?.path === path ? get().draft : undefined }),
  setMode: mode => { local.set('review.mode', mode); set({ mode }) },
  toggle: k => {
    const v = !get()[k]
    local.set(k === 'wrap' ? 'review.wrap' : 'review.ws', v ? '1' : '0')
    set({ [k]: v } as Partial<ReviewState>)
    if (k === 'ignoreWhitespace') void get().refresh()
  },
  setContext: n => { local.set('review.context', String(n)); set({ context: n }); void get().refresh() },

  toggleViewed: f => {
    const { root, source, viewed } = get()
    const next = { ...viewed }
    if (next[f.path]) delete next[f.path]
    else next[f.path] = sig(f)
    if (root) local.set(`review.viewed:${root}:${keyOf(source)}`, JSON.stringify(next))
    set({ viewed: next })
  },

  openFile: async (path, line, ref) => {
    const { root, home, diff } = get()
    if (!root) return
    // Paths come relative to the workspace (or absolute); the tree under review may sit inside it.
    const abs = path.startsWith('/') ? path : `${home ?? root}/${path.replace(/^\.\//, '')}`
    const rel = abs.startsWith(root + '/') ? abs.slice(root.length + 1) : path.replace(/^\.\//, '')
    const inDiff = diff?.files.find(f => f.path === rel)
    if (inDiff && !ref) {
      set({ selected: rel, fileView: undefined, focusLine: line ? { path: rel, line, nonce: Date.now() } : undefined })
      return
    }
    set({ fileView: { path: rel, ref: ref ?? 'WORKTREE', line } })
  },
  closeFile: () => set({ fileView: undefined }),

  setDraft: draft => set({ draft }),

  saveComment: async body => {
    const { draft, root, source, comments } = get()
    if (!draft || !root || !body.trim()) return
    let next: ReviewComment[]
    let saved: ReviewComment
    if (draft.editing) {
      next = comments.map(c => (c.id === draft.editing ? { ...c, body } : c))
      saved = next.find(c => c.id === draft.editing)!
    } else {
      saved = {
        id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        path: draft.path, side: draft.side, startLine: draft.start, endLine: draft.end, excerpt: draft.excerpt,
        body, created: Date.now(), state: 'draft',
      }
      next = [...comments, saved]
    }
    set({ comments: next, draft: undefined })
    await api.post('/api/review/comments/put', { ws: root, source, comments: next })
    return saved
  },

  updateComment: async (id, patch) => {
    const { root, source, comments } = get()
    const next = comments.map(c => (c.id === id ? { ...c, ...patch } : c))
    set({ comments: next })
    if (root) await api.post('/api/review/comments/put', { ws: root, source, comments: next })
  },

  removeComment: async id => {
    const { root, source, comments } = get()
    const next = comments.filter(c => c.id !== id)
    set({ comments: next })
    if (root) await api.post('/api/review/comments/put', { ws: root, source, comments: next })
  },

  send: async (ids, extra, newSession) => {
    const { root, home, source, diff } = get()
    if (!root) return
    const app = useApp.getState()
    // Paths in the comments are relative to the tree under review: name it when it is not the workspace.
    const where = root !== home ? ` · 저장소 ${root}` : ''
    const header = `리뷰: ${sourceLabel(source)}${diff ? ` (${diff.oldLabel} → ${diff.newLabel})` : ''}${where}`
    const to = newSession ? {} : app.currentTerminal ? { terminalId: app.currentTerminal } : { sessionId: app.currentSession }
    const res = await api.post<{ sessionId?: string; terminalId?: string }>('/api/review/send', { ws: root, source, ids, header, extra, ...to })
      .catch((e: Error) => { app.toast(e.message, 'error') })
    if (!res) return
    if (res.terminalId) {
      await get().refresh(true)
      app.toast(`코멘트 ${ids.length}개를 터미널에 보냈어`)
      return
    }
    if (res.sessionId && res.sessionId !== app.currentSession) {
      const sessions = await api.get<import('../../../shared/protocol.ts').SessionInfo[]>(`/api/sessions${q({ ws: app.workspace?.path })}`)
      // The new conversation is about this tree: the review stays on it when that conversation becomes current.
      if (home) local.set(pickKey(home, res.sessionId), root)
      useApp.setState({ sessions })
      await app.selectSession(res.sessionId)
    }
    useApp.setState({ sideOpen: true })
    await get().refresh(true)
    app.toast(`코멘트 ${ids.length}개를 에이전트에게 보냈어`)
  },
}))

export { sourceLabel }

// The tree changed on disk, or a turn ended: refresh what is on screen without a spinner.
subscribe(ev => {
  const s = useReview.getState()
  if (!s.root) return
  if (ev.topic === 'repo-changed' && ev.workspace === s.root) {
    const now = Date.now()
    const recent = Object.fromEntries(Object.entries(s.recent).filter(([, t]) => now - t < 15_000))
    for (const p of ev.paths) if (!p.startsWith('.git/')) recent[p] = now
    useReview.setState({ recent })
  }
  // A turn that ended may have written in a new repo.
  if (ev.topic === 'session' && ev.event.kind === 'turn-end' && ev.event.summary?.repos?.some(r => !s.repos.some(x => x.path === r.path))) void s.loadRepos()
  const live = s.source.kind === 'working' || (s.source.kind === 'branch' && s.source.compare === 'WORKTREE') || s.source.kind === 'turn'
  const relevant = (ev.topic === 'repo-changed' && ev.workspace === s.root && live) ||
    (ev.topic === 'session' && s.source.kind === 'turn' && ev.sessionId === s.source.sessionId && (ev.event.kind === 'turn-end' || ev.event.kind === 'turn-start'))
  if (!relevant) return
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => void useReview.getState().refresh(true), 250)
})

// The review follows the conversation: when another one becomes current, and when the current one starts working
// somewhere new while the person has not picked a tree for it.
let seen: { id?: string; workTree?: string } = {}
useApp.subscribe(app => {
  const home = useReview.getState().home
  if (!home || ready !== home || app.workspace?.path !== home) return
  const now = { id: app.currentSession, workTree: conversation(home)?.workTree }
  if (now.id === seen.id && now.workTree === seen.workTree) return
  const switched = now.id !== seen.id
  seen = now
  if (switched || !(now.id && local.get(pickKey(home, now.id)))) void follow()
})
