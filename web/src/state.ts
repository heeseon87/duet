import { create } from 'zustand'
import type { ContextItem, Effort, ImageUpload, PermissionDecision, PermissionMode, ServerEvent, SessionEvent, SessionInfo, TerminalInfo, Workspace } from '../../shared/protocol.ts'
import { api, q, setReconnectHandler, subscribe } from './api.ts'
import { Transcript } from './agent/transcript.ts'
import { setPalette } from './lib/highlight.ts'

export type Tab = 'canvas' | 'review'
export type Theme = 'system' | 'light' | 'dark'

const store = {
  get: (k: string) => { try { return localStorage.getItem(`duet.${k}`) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(`duet.${k}`, v) } catch { /* private mode */ } },
}

type Toast = { id: number; text: string; kind?: 'error' }

/**
 * What a new conversation starts with. Model and effort are the last ones picked by hand.
 * The mode always starts at "auto", like Claude Code's own default mode; a mode picked
 * before the first message applies to that one conversation only.
 */
export type Prefs = { model: string | null; effort: Effort | null; permissionMode: PermissionMode }
type ConfigPatch = { model?: string | null; effort?: Effort | null; permissionMode?: PermissionMode; title?: string }
const DEFAULT_MODE: PermissionMode = 'auto'

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(store.get('prefs') ?? '{}') as Partial<Prefs>
    return { model: saved.model ?? null, effort: saved.effort ?? null, permissionMode: DEFAULT_MODE }
  } catch {
    return { model: null, effort: null, permissionMode: DEFAULT_MODE }
  }
}

type AppState = {
  workspace?: Workspace
  workspaces: Workspace[]
  tab: Tab
  theme: Theme
  codePalette: string
  sideWidth: number
  sideOpen: boolean
  paletteOpen: boolean
  toasts: Toast[]
  sessions: SessionInfo[]
  currentSession?: string
  /** Live terminals (Claude Code sessions running the Duet mod) of this workspace. */
  terminals: TerminalInfo[]
  /**
   * The terminal everything the person sends goes to instead of a conversation. It stays picked after the
   * terminal closes, so a send fails out loud rather than landing in a conversation unasked.
   */
  currentTerminal?: string
  selectTerminal: (id: string) => void
  /** Bumped when any transcript changes, per session id. */
  versions: Record<string, number>
  /** Text queued into the composer from elsewhere (canvas, review, empty states). */
  draft?: { text: string; context?: ContextItem[]; nonce: number }
  /** Focus: each turn shows only what was asked, what waits for the person, the last words and the changed files. */
  focus: boolean
  setFocus: (on: boolean) => void
  /** A long answer opened wide over the stage. */
  reader?: { sessionId: string; key: string }
  openReader: (sessionId: string, key: string) => void
  closeReader: () => void
  setTab: (t: Tab) => void
  setTheme: (t: Theme) => void
  setCodePalette: (id: string) => void
  setSide: (w: number, open?: boolean) => void
  toast: (text: string, kind?: 'error') => void
  openWorkspace: (path: string) => Promise<void>
  selectSession: (id: string | undefined) => Promise<void>
  newSession: () => Promise<string>
  send: (text: string, context?: ContextItem[], images?: ImageUpload[]) => Promise<void>
  interrupt: () => Promise<void>
  decide: (permissionId: string, decision: PermissionDecision) => Promise<void>
  prefs: Prefs
  configure: (patch: ConfigPatch) => Promise<void>
  setDraft: (text: string, context?: ContextItem[]) => void
  setPalette: (open: boolean) => void
}

const transcripts = new Map<string, Transcript>()
export function transcriptOf(id: string | undefined): Transcript | undefined {
  return id ? transcripts.get(id) : undefined
}

let bumpScheduled = new Set<string>()
let frame = 0
function bump(id: string) {
  bumpScheduled.add(id)
  if (frame) return
  // Many deltas per frame collapse into one render.
  frame = requestAnimationFrame(() => {
    frame = 0
    const ids = bumpScheduled
    bumpScheduled = new Set()
    useApp.setState(s => {
      const versions = { ...s.versions }
      for (const i of ids) versions[i] = transcripts.get(i)?.version ?? 0
      return { versions }
    })
  })
}

async function loadSession(id: string): Promise<Transcript> {
  const data = await api.get<{ info: SessionInfo; log: SessionEvent[]; init: unknown }>(`/api/sessions/${id}`)
  const t = new Transcript()
  for (const ev of data.log) t.apply(ev)
  t.status = data.info.status
  if (data.init) t.init = data.init as Transcript['init']
  transcripts.set(id, t)
  bump(id)
  return t
}

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

let toastSeq = 0

export const useApp = create<AppState>((set, get) => ({
  workspaces: [],
  tab: (store.get('tab') as Tab) || 'review',
  theme: (store.get('theme') as Theme) || 'system',
  codePalette: store.get('codePalette') || 'github',
  sideWidth: Number(store.get('sideWidth')) || 460,
  sideOpen: store.get('sideOpen') !== '0',
  paletteOpen: false,
  toasts: [],
  prefs: loadPrefs(),
  focus: store.get('focus') === '1',
  sessions: [],
  terminals: [],
  versions: {},

  setTab: tab => { store.set('tab', tab); set({ tab }) },
  setTheme: theme => { store.set('theme', theme); applyTheme(theme); set({ theme }) },
  setCodePalette: id => { store.set('codePalette', id); setPalette(id); set({ codePalette: id }) },
  setSide: (w, open) => {
    const sideWidth = Math.max(340, Math.min(w, window.innerWidth - 420))
    store.set('sideWidth', String(sideWidth))
    if (open !== undefined) store.set('sideOpen', open ? '1' : '0')
    set({ sideWidth, sideOpen: open ?? get().sideOpen })
  },
  toast: (text, kind) => {
    const id = ++toastSeq
    set(s => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), kind === 'error' ? 6000 : 3200)
  },

  openWorkspace: async path => {
    const ws = await api.post<Workspace>('/api/workspaces', { path })
    const workspaces = await api.get<Workspace[]>('/api/workspaces')
    store.set('workspace', ws.path)
    const url = new URL(location.href)
    url.searchParams.set('ws', ws.path)
    history.replaceState(null, '', url)
    const sessions = await api.get<SessionInfo[]>(`/api/sessions${q({ ws: ws.path })}`)
    const terminals = await api.get<TerminalInfo[]>(`/api/terminals${q({ ws: ws.path })}`)
    set({ workspace: ws, workspaces, sessions, terminals, reader: undefined })
    const remembered = store.get(`session:${ws.path}`)
    const pick = sessions.find(s => s.id === remembered) ?? sessions[0]
    await get().selectSession(pick?.id)
    const terminal = store.get(`terminal:${ws.path}`)
    if (terminal && terminals.some(t => t.id === terminal)) get().selectTerminal(terminal)
  },

  selectSession: async id => {
    const ws = get().workspace
    if (ws && id) store.set(`session:${ws.path}`, id)
    if (ws) store.set(`terminal:${ws.path}`, '')
    // The reader shows one conversation's answer; another conversation closes it.
    set(s => ({ currentSession: id, currentTerminal: undefined, reader: s.reader?.sessionId === id ? s.reader : undefined }))
    if (id && !transcripts.has(id)) await loadSession(id)
  },

  selectTerminal: id => {
    const ws = get().workspace
    if (ws) store.set(`terminal:${ws.path}`, id)
    set({ currentTerminal: id, reader: undefined })
  },

  newSession: async () => {
    const ws = get().workspace
    if (!ws) throw new Error('no workspace')
    const { model, effort, permissionMode } = get().prefs
    const info = await api.post<SessionInfo>('/api/sessions', { ws: ws.path, model: model ?? undefined, permissionMode, effort: effort ?? undefined })
    set(s => ({ prefs: { ...s.prefs, permissionMode: DEFAULT_MODE } }))
    transcripts.set(info.id, new Transcript())
    set(s => ({ sessions: [info, ...s.sessions.filter(x => x.id !== info.id)] }))
    await get().selectSession(info.id)
    return info.id
  },

  send: async (text, context, images) => {
    const terminal = get().currentTerminal
    if (terminal) {
      await api.post(`/api/terminals/${terminal}/messages`, { text, context, images })
      return
    }
    let id = get().currentSession
    if (!id) id = await get().newSession()
    await api.post(`/api/sessions/${id}/messages`, { text, context, images })
  },

  interrupt: async () => {
    const id = get().currentSession
    if (id) await api.post(`/api/sessions/${id}/interrupt`)
  },

  decide: async (permissionId, decision) => {
    const id = get().currentSession
    if (id) await api.post(`/api/sessions/${id}/permissions/${permissionId}`, decision)
  },

  configure: async patch => {
    const id = get().currentSession
    const prefs = { ...get().prefs }
    if (patch.model !== undefined) prefs.model = patch.model
    if (patch.effort !== undefined) prefs.effort = patch.effort
    // Before the first message there is no conversation yet: the picks wait in prefs for it.
    if (patch.permissionMode && !id) prefs.permissionMode = patch.permissionMode
    store.set('prefs', JSON.stringify({ model: prefs.model, effort: prefs.effort }))
    set({ prefs })
    if (!id) return
    // `null` (not undefined) so "기본" survives JSON and clears the setting.
    const info = await api.patch<SessionInfo>(`/api/sessions/${id}`, patch)
    set(s => ({ sessions: s.sessions.map(x => (x.id === id ? info : x)) }))
  },

  setFocus: on => { store.set('focus', on ? '1' : '0'); set({ focus: on }) },
  openReader: (sessionId, key) => set({ reader: { sessionId, key } }),
  closeReader: () => set({ reader: undefined }),
  setDraft: (text, context) => set({ draft: { text, context, nonce: Date.now() }, sideOpen: true }),
  setPalette: open => set({ paletteOpen: open }),
}))

// ---------------------------------------------------------------- live events

subscribe((ev: ServerEvent) => {
  if (ev.topic === 'sessions') {
    const ws = useApp.getState().workspace?.path
    useApp.setState({ sessions: ev.sessions.filter(s => s.workspace === ws).sort((a, b) => b.updated - a.updated) })
    for (const s of ev.sessions) {
      const t = transcripts.get(s.id)
      if (t && t.status !== s.status) { t.status = s.status; t.version++; bump(s.id) }
    }
  } else if (ev.topic === 'terminals') {
    const ws = useApp.getState().workspace?.path
    useApp.setState({ terminals: ev.terminals.filter(t => t.workspace === ws) })
  } else if (ev.topic === 'session') {
    const t = transcripts.get(ev.sessionId)
    if (!t) return
    t.apply(ev.event)
    bump(ev.sessionId)
  } else if (ev.topic === 'delta') {
    const t = transcripts.get(ev.sessionId)
    if (!t) return
    t.applyDelta(ev.msg)
    bump(ev.sessionId)
  }
})

// After a reconnect the server may have moved on: rebuild every open transcript from its log.
setReconnectHandler(() => {
  for (const id of [...transcripts.keys()]) void loadSession(id)
  const ws = useApp.getState().workspace
  if (ws) void api.get<SessionInfo[]>(`/api/sessions${q({ ws: ws.path })}`).then(sessions => useApp.setState({ sessions }))
  if (ws) void api.get<TerminalInfo[]>(`/api/terminals${q({ ws: ws.path })}`).then(terminals => useApp.setState({ terminals }))
})

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(useApp.getState().theme))

export function useTranscript(id: string | undefined): Transcript | undefined {
  useApp(s => (id ? s.versions[id] : 0))
  return transcriptOf(id)
}

export const local = store

setPalette(useApp.getState().codePalette)
