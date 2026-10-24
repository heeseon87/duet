import { create } from 'zustand'
import { diffMaps, type CanvasMap, type Delivery, type MapDiff } from '../../../shared/canvas.ts'
import type { CanvasSummary, CanvasThread, MapCode, SessionInfo } from '../../../shared/protocol.ts'
import { api, q, subscribe } from '../api.ts'
import { local, useApp } from '../state.ts'

export type HistoryItem = { revision: number; by: 'agent' | 'person'; note?: string; ts: number }

type CanvasState = {
  list: CanvasSummary[]
  name?: string
  map?: CanvasMap
  /** Which map `map` is: `name` runs ahead of it while the next map loads. */
  mapName?: string
  /** The code the map is about; the review shows it while the map is open. */
  code?: MapCode
  revision: number
  history: HistoryItem[]
  threads: CanvasThread[]
  /** Where each sent thread item stands with the agent, by item id: the server works it out on every read. */
  deliveries: Record<string, Delivery>
  selected?: string
  /** Showing an older revision instead of the current one. */
  preview?: { revision: number; map: CanvasMap }
  /** Compare against this revision: removed things come back as ghosts, new ones glow. */
  compareFrom?: number
  compareMap?: CanvasMap
  /** What the agent changed since the person last looked. */
  seenRevision?: number
  glow?: MapDiff
  collapsed: Set<string>
  /** Explore: clicking only highlights; the info card stays as it is. Remembered. */
  explore: boolean
  loading: boolean
  /** The agent changed a map the person is not looking at. */
  elsewhere?: { name: string; title: string; revision: number }
  loadList: () => Promise<void>
  open: (name: string) => Promise<void>
  reload: () => Promise<void>
  refreshThreads: () => Promise<void>
  select: (target: string | undefined) => void
  toggleCollapse: (groupId: string) => void
  /** Fold every package (nested ones too, so unfolding opens one level at a time), or unfold all. */
  setAllCollapsed: (fold: boolean) => void
  setExplore: (on: boolean) => void
  /** Unfold this package (and the ones around it), fold every other; what is inside keeps its state. False when nothing changes. */
  soloExpand: (groupId: string) => boolean
  setCompare: (rev: number | undefined) => Promise<void>
  setPreview: (rev: number | undefined) => Promise<void>
  acknowledge: () => void
  /** False when it could not be sent (a toast says why), so the draft stays. */
  comment: (target: string, text: string, threadId?: string) => Promise<boolean>
  setThread: (threadId: string, state: 'open' | 'resolved') => Promise<void>
  choose: (decision: string, option: string | null, rationale?: string, notify?: boolean) => Promise<void>
  restore: (rev: number) => Promise<void>
  /** The person's own edit, recorded as a revision like the agent's. */
  patch: (patch: import('../../../shared/canvas.ts').CanvasPatch, note: string) => Promise<string[] | undefined>
  create: (name: string, diagram: 'class' | 'sequence', title: string) => Promise<void>
  remove: (name: string) => Promise<void>
}

const ws = () => useApp.getState().workspace?.path

/** Where the agent panel sends: the terminal picked there, else the conversation. */
const target = () => {
  const { currentTerminal, currentSession } = useApp.getState()
  return currentTerminal ? { terminalId: currentTerminal } : { sessionId: currentSession }
}

/** What the canvas sent to a conversation shows up in the agent panel: that conversation, opened. */
async function showConversation(w: string, sessionId: string) {
  const app = useApp.getState()
  if (sessionId !== app.currentSession) {
    useApp.setState({ sessions: await api.get<SessionInfo[]>(`/api/sessions${q({ ws: w })}`) })
    await app.selectSession(sessionId)
  }
  useApp.setState({ sideOpen: true })
}

/** Sent items still with the agent move on with its conversation: refresh them as it goes, at most a few times a second. */
let refreshing: ReturnType<typeof setTimeout> | undefined
function followDeliveries() {
  if (refreshing) return
  refreshing = setTimeout(() => { refreshing = undefined; void useCanvas.getState().refreshThreads() }, 400)
}

export const useCanvas = create<CanvasState>((set, get) => ({
  list: [],
  revision: 0,
  history: [],
  threads: [],
  deliveries: {},
  collapsed: new Set(),
  explore: local.get('canvas.explore') === '1',
  loading: false,

  loadList: async () => {
    const w = ws()
    if (!w) return
    const before = new Set(get().list.map(m => m.name))
    const list = await api.get<CanvasSummary[]>(`/api/canvas${q({ ws: w })}`)
    set({ list })
    // A map that just appeared (the agent made it) opens by itself.
    const fresh = before.size ? list.filter(m => !before.has(m.name)) : []
    if (fresh.length === 1) { await get().open(fresh[0].name); return }
    const cur = get().name
    if (!cur || !list.some(m => m.name === cur)) {
      const remembered = local.get(`canvas.current:${w}`)
      const pick = list.find(m => m.name === remembered) ?? list[0]
      if (pick) await get().open(pick.name)
      else set({ name: undefined, map: undefined, mapName: undefined, code: undefined })
    }
  },

  open: async name => {
    const w = ws()
    if (!w) return
    if (get().elsewhere?.name === name) set({ elsewhere: undefined })
    local.set(`canvas.current:${w}`, name)
    const collapsed = new Set<string>(JSON.parse(local.get(`canvas.collapsed:${w}:${name}`) ?? '[]'))
    const seen = Number(local.get(`canvas.seen:${w}:${name}`) ?? 0)
    set({ name, selected: undefined, preview: undefined, compareFrom: undefined, compareMap: undefined, collapsed, loading: true, glow: undefined })
    await get().reload()
    const rev = get().revision
    // First visit: nothing is "new". Later visits: show what changed since then.
    if (!seen) { local.set(`canvas.seen:${w}:${name}`, String(rev)); set({ seenRevision: rev }) }
    else set({ seenRevision: seen })
    if (seen && seen < rev) await get().setCompare(seen)
  },

  reload: async () => {
    const w = ws(), name = get().name
    if (!w || !name) return
    const data = await api.get<{ revision: number; map: CanvasMap; code?: MapCode; history: HistoryItem[]; threads: CanvasThread[]; deliveries: Record<string, Delivery> }>(`/api/canvas/${name}${q({ ws: w })}`)
    const before = get().map
    const code = data.code && get().code && JSON.stringify(data.code) === JSON.stringify(get().code) ? get().code : data.code
    set({ map: data.map, mapName: name, code, revision: data.revision, history: data.history, threads: data.threads, deliveries: data.deliveries, loading: false })
    if (before && get().name === name && before !== data.map) {
      const d = diffMaps(before, data.map)
      set({ glow: d })
      setTimeout(() => { if (get().glow === d) set({ glow: undefined }) }, 5000)
    }
    if (get().compareFrom) await get().setCompare(get().compareFrom)
  },

  refreshThreads: async () => {
    const w = ws(), name = get().name
    if (!w || !name) return
    const data = await api.get<{ threads: CanvasThread[]; deliveries: Record<string, Delivery> }>(`/api/canvas/${name}/threads${q({ ws: w })}`)
    if (get().name === name) set(data)
  },

  select: target => set({ selected: target }),

  toggleCollapse: groupId => {
    const w = ws(), name = get().name
    const next = new Set(get().collapsed)
    if (next.has(groupId)) next.delete(groupId)
    else next.add(groupId)
    if (w && name) local.set(`canvas.collapsed:${w}:${name}`, JSON.stringify([...next]))
    set({ collapsed: next })
  },

  setAllCollapsed: fold => {
    const w = ws(), name = get().name
    const map = get().preview?.map ?? get().map
    const parents = new Set((map?.elements ?? []).map(e => e.parent).filter(Boolean))
    const next = new Set(fold ? (map?.elements ?? []).filter(e => e.kind === 'group' && parents.has(e.id)).map(e => e.id) : [])
    if (w && name) local.set(`canvas.collapsed:${w}:${name}`, JSON.stringify([...next]))
    set({ collapsed: next })
  },

  soloExpand: groupId => {
    const w = ws(), name = get().name
    const map = get().preview?.map ?? get().map
    if (!map) return false
    const byId = new Map(map.elements.map(e => [e.id, e]))
    const parents = new Set(map.elements.map(e => e.parent).filter(Boolean))
    const open = new Set<string>()
    for (let p: string | undefined = groupId; p; p = byId.get(p)?.parent) open.add(p)
    const within = (id: string) => { for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) if (p === groupId) return true; return false }
    const next = new Set([...get().collapsed].filter(id => !open.has(id)))
    for (const e of map.elements) if (e.kind === 'group' && parents.has(e.id) && !open.has(e.id) && !within(e.id)) next.add(e.id)
    const cur = get().collapsed
    if (next.size === cur.size && [...next].every(id => cur.has(id))) return false
    if (w && name) local.set(`canvas.collapsed:${w}:${name}`, JSON.stringify([...next]))
    set({ collapsed: next })
    return true
  },

  setExplore: on => {
    local.set('canvas.explore', on ? '1' : '0')
    set({ explore: on })
  },

  setCompare: async rev => {
    const w = ws(), name = get().name
    if (!rev || !w || !name || rev >= get().revision) { set({ compareFrom: undefined, compareMap: undefined }); return }
    const r = await api.get<{ map: CanvasMap }>(`/api/canvas/${name}/rev/${rev}${q({ ws: w })}`)
    set({ compareFrom: rev, compareMap: r.map })
  },

  setPreview: async rev => {
    const w = ws(), name = get().name
    if (!rev || !w || !name || rev === get().revision) { set({ preview: undefined }); return }
    const r = await api.get<{ map: CanvasMap }>(`/api/canvas/${name}/rev/${rev}${q({ ws: w })}`)
    set({ preview: { revision: rev, map: r.map } })
  },

  acknowledge: () => {
    const w = ws(), name = get().name
    if (w && name) local.set(`canvas.seen:${w}:${name}`, String(get().revision))
    set({ seenRevision: get().revision, compareFrom: undefined, compareMap: undefined })
  },

  comment: async (part, text, threadId) => {
    const w = ws(), name = get().name
    if (!w || !name) return false
    try {
      const res = await api.post<{ sessionId?: string; thread: CanvasThread }>(`/api/canvas/${name}/comment`, { ws: w, target: part, text, threadId, ...target() })
      if (res.sessionId) await showConversation(w, res.sessionId)
      else useApp.setState({ sideOpen: true })
    } catch (e) {
      useApp.getState().toast((e as Error).message, 'error')
      return false
    }
    await get().reload()
    return true
  },

  setThread: async (threadId, state) => {
    const w = ws(), name = get().name
    if (!w || !name) return
    await api.post(`/api/canvas/${name}/threads/${threadId}`, { ws: w, state })
    await get().reload()
  },

  choose: async (decision, option, rationale, notify) => {
    const w = ws(), name = get().name
    if (!w || !name) return
    const sent = await api.post<{ sessionId?: string; terminalId?: string }>(`/api/canvas/${name}/choose`, { ws: w, decision, option, rationale, notify, ...target() })
      .catch((e: Error) => { useApp.getState().toast(e.message, 'error') })
    if (!sent) return
    get().acknowledge()
    if (sent.terminalId) useApp.getState().toast('결정을 터미널에 보냈어')
    if (!sent.sessionId) return
    await showConversation(w, sent.sessionId)
    useApp.getState().toast('결정을 보냈어')
  },

  patch: async (patch, note) => {
    const w = ws(), name = get().name
    if (!w || !name) return
    const res = await api.post<{ ok: boolean; errors?: string[] }>(`/api/canvas/${name}/patch`, { ws: w, patch, note, baseRevision: get().revision })
    if (!res.ok) return res.errors
    return undefined
  },

  restore: async rev => {
    const w = ws(), name = get().name
    if (!w || !name) return
    await api.post(`/api/canvas/${name}/restore`, { ws: w, revision: rev })
    set({ preview: undefined })
  },

  create: async (name, diagram, title) => {
    const w = ws()
    if (!w) return
    await api.post('/api/canvas', { ws: w, name, diagram, title })
    await get().loadList()
    await get().open(name)
  },

  remove: async name => {
    const w = ws()
    if (!w) return
    await api.del(`/api/canvas/${name}${q({ ws: w })}`)
    set({ name: undefined, map: undefined })
    await get().loadList()
  },
}))

subscribe(ev => {
  const s = useCanvas.getState()
  // After a reconnect (the server may have restarted), what was in flight has ended or been answered.
  if (ev.topic === 'hello' && s.name) void s.refreshThreads()
  const pending = Object.values(s.deliveries).some(d => d.state === 'queued' || d.state === 'delivered' || d.state === 'working')
  if (ev.topic === 'session' && pending) {
    const e = ev.event
    if (e.kind === 'turn-start' || e.kind === 'turn-end' || e.kind === 'status' || e.kind === 'user' || (e.kind === 'sdk' && e.msg.type === 'command_lifecycle')) followDeliveries()
  }
  // A terminal took a message, started on it, or closed with it.
  if (ev.topic === 'terminals' && pending) followDeliveries()
  if (ev.topic === 'canvas-list' && ev.workspace === ws()) void s.loadList()
  if (ev.topic === 'canvas' && ev.workspace === ws()) {
    const prev = s.revision
    if (ev.name === s.name) void s.reload().then(() => {
      const now = useCanvas.getState()
      // The person's own edits count as seen; the agent's wait for a look. Comments add no revision.
      if (ev.by === 'person' && ev.revision > prev) now.acknowledge()
      // An agent change shows what moved since the person last looked, ghosts included.
      else if (ev.by === 'agent' && ev.revision > prev && now.seenRevision && now.seenRevision < now.revision && !now.preview) void now.setCompare(now.seenRevision)
    })
    void api.get<CanvasSummary[]>(`/api/canvas${q({ ws: ws() })}`).then(list => {
      useCanvas.setState({ list })
      const m = list.find(x => x.name === ev.name)
      if (ev.by === 'agent' && ev.name !== useCanvas.getState().name && m) useCanvas.setState({ elsewhere: { name: m.name, title: m.title, revision: ev.revision } })
    })
    if (!s.name) void s.loadList()
  }
})
