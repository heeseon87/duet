import { create } from 'zustand'
import type { SideAnchor, SideChatView } from '../../../shared/side.ts'
import { ApiError, api, q, subscribe } from '../api.ts'
import { useApp } from '../state.ts'
import { sendingTo } from '../terminalTarget.ts'

type SideState = {
  /** The workspace's side chats; the server sends the most recently active first. */
  chats: SideChatView[]
  /** What was typed and not sent yet, by chat id ('new' for a chat not started). */
  drafts: Record<string, string>
  setDraft: (chat: string, text: string) => void
  load: () => Promise<void>
  /**
   * A follow-up on `chat` (`moveTo` when its session is gone), else a new chat on `about` or on the workspace, started
   * on the rail's terminal. Undefined when it could not be asked (a toast says why).
   */
  ask: (a: { text: string; chat?: string; moveTo?: string; about?: SideAnchor }) => Promise<SideChatView | undefined>
  /** Sends the chat's Q&A and its last question to the main conversation. */
  toMain: (chat: string) => Promise<boolean>
}

const ws = () => useApp.getState().workspace?.path

/** The terminal picked on the rail, if any: the server refuses in words when one is needed and there is none. */
const railTerminal = () => {
  const to = sendingTo(useApp.getState())
  return 'terminal' in to ? to.terminal : undefined
}

const put = (chats: SideChatView[], c: SideChatView) => (chats.some(x => x.id === c.id) ? chats.map(x => (x.id === c.id ? c : x)) : [c, ...chats])

export const useSide = create<SideState>(set => ({
  chats: [],
  drafts: {},
  setDraft: (chat, text) => set(s => ({ drafts: { ...s.drafts, [chat]: text } })),

  load: async () => {
    const w = ws()
    if (!w) { set({ chats: [] }); return }
    try {
      const chats = await api.get<SideChatView[]>(`/api/side${q({ ws: w })}`)
      if (ws() === w) set({ chats })
    } catch (e) {
      // A server running older code than this page has no side chats yet.
      if (e instanceof ApiError && e.status === 404 && ws() === w) set({ chats: [] })
    }
  },

  ask: async a => {
    const w = ws()
    if (!w) return undefined
    try {
      const c = await api.post<SideChatView>('/api/side/ask', { ws: w, ...a, ...(a.chat ? {} : { terminalId: railTerminal() }) })
      set(s => ({ chats: put(s.chats, c) }))
      return c
    } catch (e) {
      useApp.getState().toast((e as Error).message, 'error')
      return undefined
    }
  },

  toMain: async chat => {
    const w = ws()
    if (!w) return false
    try {
      await api.post(`/api/side/${chat}/main`, { ws: w, terminalId: railTerminal() })
    } catch (e) {
      useApp.getState().toast((e as Error).message, 'error')
      return false
    }
    useApp.getState().toast('메인 대화로 보냈어')
    return true
  },
}))

/** One chat read again after the server said it changed; gone when the server no longer has it. */
async function refetch(id: string) {
  const w = ws()
  if (!w) return
  try {
    const c = await api.get<SideChatView>(`/api/side/${id}${q({ ws: w })}`)
    if (ws() === w) useSide.setState(s => ({ chats: put(s.chats, c) }))
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) useSide.setState(s => ({ chats: s.chats.filter(c => c.id !== id) }))
  }
}

subscribe(ev => {
  // After a reconnect (the server may have restarted), what was asked has been answered or dropped.
  if (ev.topic === 'hello') void useSide.getState().load()
  if (ev.topic === 'side' && ev.workspace === ws()) void refetch(ev.chat)
})
useApp.subscribe((s, prev) => { if (s.workspace?.path !== prev.workspace?.path) void useSide.getState().load() })
