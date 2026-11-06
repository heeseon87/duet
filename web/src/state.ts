import { create } from 'zustand'
import type { ContextItem, ServerEvent, TerminalInfo, Workspace } from '../../shared/protocol.ts'
import { api, q, setReconnectHandler, subscribe } from './api.ts'
import { sendingTo, targetTerminal } from './terminalTarget.ts'
import { setPalette } from './lib/highlight.ts'
import { themeAttr, themeFrom, type Theme } from './theme.ts'

export type Tab = 'canvas' | 'review'
export type { Theme } from './theme.ts'

const store = {
  get: (k: string) => { try { return localStorage.getItem(`duet.${k}`) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(`duet.${k}`, v) } catch { /* private mode */ } },
}

type Toast = { id: number; text: string; kind?: 'error' }

type AppState = {
  workspace?: Workspace
  workspaces: Workspace[]
  tab: Tab
  theme: Theme
  codePalette: string
  paletteOpen: boolean
  toasts: Toast[]
  /** Live terminals (Claude Code sessions running the Duet mod) of this workspace. */
  terminals: TerminalInfo[]
  /** The terminal the person picked; what things go to is `targetTerminal`. */
  currentTerminal?: string
  selectTerminal: (id: string) => void
  /** Text queued into the composer from elsewhere (canvas, review, empty states). */
  draft?: { text: string; context?: ContextItem[]; nonce: number }
  setTab: (t: Tab) => void
  setTheme: (t: Theme) => void
  setCodePalette: (id: string) => void
  toast: (text: string, kind?: 'error') => void
  openWorkspace: (path: string) => Promise<void>
  /** To the target terminal; with none, it throws the reason in the person's words and nothing is sent. */
  send: (text: string, context?: ContextItem[]) => Promise<void>
  setDraft: (text: string, context?: ContextItem[]) => void
  setPalette: (open: boolean) => void
}

export { targetTerminal }

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = themeAttr(theme, matchMedia('(prefers-color-scheme: dark)').matches)
}

let toastSeq = 0

export const useApp = create<AppState>((set, get) => ({
  workspaces: [],
  tab: (store.get('tab') as Tab) || 'review',
  theme: themeFrom(store.get('theme')),
  codePalette: store.get('codePalette') || 'github',
  paletteOpen: false,
  toasts: [],
  terminals: [],

  setTab: tab => { store.set('tab', tab); set({ tab }) },
  setTheme: theme => { store.set('theme', theme); applyTheme(theme); set({ theme }) },
  setCodePalette: id => { store.set('codePalette', id); setPalette(id); set({ codePalette: id }) },
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
    const terminals = await api.get<TerminalInfo[]>(`/api/terminals${q({ ws: ws.path })}`)
    set({ workspace: ws, workspaces, terminals, currentTerminal: undefined })
    const terminal = store.get(`terminal:${ws.path}`)
    if (terminal && terminals.some(t => t.id === terminal)) get().selectTerminal(terminal)
  },

  selectTerminal: id => {
    const ws = get().workspace
    if (ws) store.set(`terminal:${ws.path}`, id)
    set({ currentTerminal: id })
  },

  send: async (text, context) => {
    const to = sendingTo(get())
    if ('refused' in to) throw new Error(to.refused)
    await api.post(`/api/terminals/${to.terminal}/messages`, { text, context })
  },

  setDraft: (text, context) => set({ draft: { text, context, nonce: Date.now() } }),
  setPalette: open => set({ paletteOpen: open }),
}))

// ---------------------------------------------------------------- live events

subscribe((ev: ServerEvent) => {
  if (ev.topic !== 'terminals') return
  const ws = useApp.getState().workspace?.path
  useApp.setState({ terminals: ev.terminals.filter(t => t.workspace === ws) })
})

// After a reconnect the server may have moved on: read the terminals again.
setReconnectHandler(() => {
  const ws = useApp.getState().workspace
  if (ws) void api.get<TerminalInfo[]>(`/api/terminals${q({ ws: ws.path })}`).then(terminals => useApp.setState({ terminals }))
})

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(useApp.getState().theme))

export const local = store

setPalette(useApp.getState().codePalette)
