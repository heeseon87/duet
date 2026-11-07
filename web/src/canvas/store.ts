import { create } from 'zustand'
import { diffMaps, labelOf, type CanvasMap, type Delivery, type MapDiff } from '../../../shared/canvas.ts'
import type { CanvasSummary, CanvasThread, MapCode } from '../../../shared/protocol.ts'
import { ApiError, api, q, subscribe } from '../api.ts'
import { local, useApp } from '../state.ts'
import { sendingTo } from '../terminalTarget.ts'
import { lastAgentRevision, revisedBoxes } from './revised.ts'
import { withDecision } from './decisionQueue.ts'
import type { PartLink } from './codeLinks.ts'
import { EMPTY, addPin, go, isPart, linkView, parsePins, partIds, shown, step, swap, unfoldFor, viewOf, type LiveView, type Pin, type Trail } from './codeNav.ts'

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
  /** The live code column's history; its shown entry is the code of what is selected. */
  trail: Trail
  /** Files kept beside the live column, oldest first; per workspace, remembered. */
  pins: Pin[]
  /** A part to bring on screen once (a link followed, back, forward); the stage centers it, after the next drawing when a fold opened. */
  reveal?: { ids: string[]; afterRender: boolean; nonce: number }
  /** Showing an older revision instead of the current one. */
  preview?: { revision: number; map: CanvasMap }
  /** Compare against this revision: removed things come back as ghosts, new ones glow. */
  compareFrom?: number
  compareMap?: CanvasMap
  /** What the agent changed since the person last looked. */
  seenRevision?: number
  glow?: MapDiff
  /** The boxes the agent's last revision added or changed, still as it left them (a △ on each). */
  revised?: { revision: number; ids: string[] }
  collapsed: Set<string>
  loading: boolean
  /** The agent changed a map the person is not looking at. */
  elsewhere?: { name: string; title: string; revision: number }
  loadList: () => Promise<void>
  open: (name: string) => Promise<void>
  reload: () => Promise<void>
  refreshThreads: () => Promise<void>
  /** Selects a part; the live code column follows to its code unless it shows that part already. `keep` pins what it showed first. */
  select: (target: string | undefined, o?: { keep?: boolean }) => void
  /**
   * Follows a link from code: selects its part (unfolding its packages), shows the declaring code and reveals the part.
   * `stay` only selects and reveals (the reader is on the declaration); `ref` opens that one of the part's files;
   * `keep` pins what the live column showed first.
   */
  goTo: (link: PartLink, o?: { stay?: boolean; ref?: string; keep?: boolean }) => void
  back: () => void
  forward: () => void
  /** Shows this file in doc `doc` of the live view (a tab, the menu's 코드 열기): no move in history. */
  showFile: (doc: number, ref: string) => void
  /** Pins doc `doc` of the live column where the reader is; with no doc, each of them. */
  pin: (doc?: number) => void
  unpin: (id: string) => void
  resizePin: (id: string, width: number) => void
  toggleCollapse: (groupId: string) => void
  /** Fold every package (nested ones too, so unfolding opens one level at a time), or unfold all. */
  setAllCollapsed: (fold: boolean) => void
  /** Unfold this package (and the ones around it), fold every other; what is inside keeps its state. False when nothing changes. */
  soloExpand: (groupId: string) => boolean
  setCompare: (rev: number | undefined) => Promise<void>
  setPreview: (rev: number | undefined) => Promise<void>
  acknowledge: () => void
  /** False when it could not be sent (a toast says why), so the draft stays. */
  comment: (target: string, text: string, threadId?: string) => Promise<boolean>
  /**
   * A side question on a decision or option: the terminal that opened the decision (else the one picked) answers it from
   * a fork of its conversation, beside its work. False when it could not be asked (a toast says why).
   */
  askSide: (target: string, text: string, threadId?: string) => Promise<boolean>
  setThread: (threadId: string, state: 'open' | 'resolved') => Promise<void>
  choose: (decision: string, option: string | null, rationale?: string, notify?: boolean) => Promise<void>
  /** Decision mode is open over the canvas: its keys win over the map's, the approval card's and esc's. */
  deciding: boolean
  setDeciding: (on: boolean) => void
  /**
   * A choice in decision mode: on the map at once; with `send`, kept for Claude until `flushDecisions` tells it all the
   * choices together. The revision it made, to undo it with, or undefined when it failed.
   */
  decide: (decision: string, option: string, rationale: string | undefined, send: boolean) => Promise<number | undefined>
  /** Takes back a choice just made (restores the revision before it), unless the map moved on since. */
  undoDecide: (decision: string, revision: number) => Promise<boolean>
  /** Tells Claude the choices kept for it on this map (or `map`), in one prompt. `quiet` leaves the agent panel as it is. */
  flushDecisions: (quiet?: boolean, map?: string) => Promise<void>
  restore: (rev: number) => Promise<void>
  /** The person's own edit, recorded as a revision like the agent's. */
  patch: (patch: import('../../../shared/canvas.ts').CanvasPatch, note: string) => Promise<string[] | undefined>
  create: (name: string, diagram: 'class' | 'sequence', title: string) => Promise<void>
  remove: (name: string) => Promise<void>
}

const ws = () => useApp.getState().workspace?.path

/** The terminal things go to; with none, it throws why in the person's words, before anything is sent. */
const target = (): { terminalId: string } => {
  const to = sendingTo(useApp.getState())
  if ('refused' in to) throw new Error(to.refused)
  return { terminalId: to.terminal }
}

/**
 * Choices made in decision mode that Claude has not heard of yet, per map, and the terminal they were made to go to
 * (none when none was connected): they outlive a reload or a closed tab.
 */
type Pending = { ids: string[]; to?: { terminalId: string } }
const pendingKey = (w: string, name: string) => `canvas.pendingDecisions:${w}:${name}`
export const pendingOf = (w: string, name: string): Pending => {
  try {
    const p = { ids: [], ...JSON.parse(local.get(pendingKey(w, name)) ?? '{}') } as Pending
    // Kept for a Duet conversation (before there were only terminals): they go to the terminal picked now.
    return p.to?.terminalId ? p : { ids: p.ids }
  } catch { return { ids: [] } }
}
const setPending = (w: string, name: string, p: Pending) => local.set(pendingKey(w, name), JSON.stringify(p))

/** The two sides of a revision the agent wrote, by workspace, map and revision: fetched once, as they never change. */
const agentRevs = new Map<string, Promise<[CanvasMap, CanvasMap]>>()
function revisionSides(w: string, name: string, rev: number, current: { revision: number; map: CanvasMap }): Promise<[CanvasMap, CanvasMap]> {
  const at = (r: number) => r === current.revision ? Promise.resolve(current.map) : api.get<{ map: CanvasMap }>(`/api/canvas/${name}/rev/${r}${q({ ws: w })}`).then(x => x.map)
  const key = `${w}\n${name}\n${rev}`
  let sides = agentRevs.get(key)
  if (!sides) {
    sides = Promise.all([at(rev - 1), at(rev)])
    // A failed fetch is tried again next time.
    sides.catch(() => agentRevs.delete(key))
    agentRevs.set(key, sides)
  }
  return sides
}

/** Sent items still with a terminal move on with it: refresh them as it goes, at most a few times a second. */
let refreshing: ReturnType<typeof setTimeout> | undefined
function followDeliveries() {
  if (refreshing) return
  refreshing = setTimeout(() => { refreshing = undefined; void useCanvas.getState().refreshThreads() }, 400)
}

/** Where the reader is in a live doc: its top line, and the file it reads (none for a part without files). */
export type LivePlace = { line: number; file?: { root: string; path: string } }
/** How the live column reads where its reader is, doc by doc. The store's only read of the screen. */
let livePlaces: () => LivePlace[] | undefined = () => undefined
export const setLivePosition = (f: typeof livePlaces) => { livePlaces = f }
const livePosition = () => livePlaces()?.map(p => p.line)
let seq = 0
const nonce = () => ++seq

/** The pins with the live column's docs (`doc`, else each) added where the reader is; the same array when none has a file. */
function pinned(s: CanvasState, doc?: number): Pin[] {
  const map = s.preview?.map ?? s.map, docs = shown(s.trail)?.view.docs, places = livePlaces()
  if (!map || !docs || !places) return s.pins
  const width = Number(local.get('canvas.codeWidth')) || 520
  return docs.reduce((pins, d, i) => {
    const file = places[i]?.file
    if ((doc !== undefined && i !== doc) || !file) return pins
    return addPin(pins, { ...file, line: places[i].line, label: labelOf(map, d.part), width }, `p${Date.now().toString(36)}${nonce()}`)
  }, s.pins)
}
function keepPins(pins: Pin[]) {
  const w = ws()
  if (w) local.set(`canvas.codePins:${w}`, JSON.stringify(pins))
  return pins
}

/** Opens the folded packages around these parts, remembered like a fold by hand; the same set when none was folded. */
function unfold(map: CanvasMap, collapsed: Set<string>, ids: string[]): Set<string> {
  const next = ids.reduce<Set<string>>((c, id) => unfoldFor(map, c, id) ?? c, collapsed)
  const w = ws(), name = useCanvas.getState().name
  if (next !== collapsed && w && name) local.set(`canvas.collapsed:${w}:${name}`, JSON.stringify([...next]))
  return next
}

/** Selects `target` with the live column on `trail`, bringing it on screen. */
function arrive(map: CanvasMap, target: string, trail: Trail, pins = useCanvas.getState().pins) {
  const ids = partIds(map, target), was = useCanvas.getState().collapsed, collapsed = unfold(map, was, ids)
  useCanvas.setState({ selected: target, trail, pins, collapsed, reveal: { ids, afterRender: collapsed !== was, nonce: nonce() } })
}

/** Back or forward in the live column, past parts the map lost. */
function move(by: -1 | 1) {
  const s = useCanvas.getState(), map = s.preview?.map ?? s.map
  if (!map) return
  const trail = step(s.trail, by, t => isPart(map, t), livePosition(), nonce())
  if (trail !== s.trail) arrive(map, shown(trail)!.view.target, trail)
}

export const useCanvas = create<CanvasState>((set, get) => ({
  list: [],
  revision: 0,
  trail: EMPTY,
  pins: [],
  history: [],
  threads: [],
  deliveries: {},
  collapsed: new Set(),
  loading: false,

  loadList: async () => {
    const w = ws()
    if (!w) return
    const before = new Set(get().list.map(m => m.name))
    const list = await api.get<CanvasSummary[]>(`/api/canvas${q({ ws: w })}`)
    set({ list, pins: parsePins(local.get(`canvas.codePins:${w}`)) })
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
    set({ name, selected: undefined, trail: EMPTY, reveal: undefined, preview: undefined, compareFrom: undefined, compareMap: undefined, collapsed, loading: true, glow: undefined, revised: undefined })
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
    // A comment or a thread changes no revision: the same map keeps its object, so the drawing is not rendered again.
    const same = before && get().mapName === name && get().revision === data.revision && JSON.stringify(before) === JSON.stringify(data.map)
    const map = same ? before : data.map
    const code = data.code && get().code && JSON.stringify(data.code) === JSON.stringify(get().code) ? get().code : data.code
    set({ map, mapName: name, code, revision: data.revision, history: data.history, threads: data.threads, deliveries: data.deliveries, loading: false })
    if (before && get().name === name && before !== map) {
      const d = diffMaps(before, map)
      set({ glow: d })
      setTimeout(() => { if (get().glow === d) set({ glow: undefined }) }, 5000)
    }
    if (get().compareFrom) await get().setCompare(get().compareFrom)
    const rev = lastAgentRevision(data.history)
    if (!rev) { set({ revised: undefined }); return }
    // Only marks: if a side will not load, the map shows without them.
    const sides = await revisionSides(w, name, rev, { revision: data.revision, map }).catch(() => undefined)
    if (get().name === name && get().map === map) set({ revised: sides && { revision: rev, ids: revisedBoxes(sides[0], sides[1], map) } })
  },

  refreshThreads: async () => {
    const w = ws(), name = get().name
    if (!w || !name) return
    const data = await api.get<{ threads: CanvasThread[]; deliveries: Record<string, Delivery> }>(`/api/canvas/${name}/threads${q({ ws: w })}`)
    if (get().name === name) set(data)
  },

  select: (target, o) => set(s => {
    const map = s.preview?.map ?? s.map
    const view = map && target ? viewOf(map, target) : undefined
    if (!view || shown(s.trail)?.view.target === target) return { selected: target }
    const pins = o?.keep ? pinned(s) : s.pins
    return { selected: target, trail: go(s.trail, view, livePosition(), nonce()), ...(pins !== s.pins && { pins: keepPins(pins) }) }
  }),

  goTo: (link, o) => {
    const s = get(), map = s.preview?.map ?? s.map
    if (!map) return
    const view = linkView(map, link)
    const opened: LiveView = o?.ref ? { ...view, docs: [{ ...view.docs[0], ref: o.ref }, ...view.docs.slice(1)] as LiveView['docs'] } : view
    const pins = o?.keep && !o.stay ? pinned(s) : s.pins
    arrive(map, link.target, o?.stay ? s.trail : go(s.trail, opened, livePosition(), nonce()), pins === s.pins ? pins : keepPins(pins))
  },
  back: () => move(-1),
  forward: () => move(1),

  showFile: (doc, ref) => set(s => {
    const cur = shown(s.trail)
    if (!cur || !cur.view.docs[doc]) return {}
    return { trail: swap(s.trail, { ...cur.view, docs: cur.view.docs.map((d, i) => (i === doc ? { ...d, ref } : d)) as LiveView['docs'] }) }
  }),
  pin: doc => set(s => {
    const pins = pinned(s, doc)
    return pins === s.pins ? {} : { pins: keepPins(pins) }
  }),
  unpin: id => set(s => ({ pins: keepPins(s.pins.filter(p => p.id !== id)) })),
  resizePin: (id, width) => set(s => ({ pins: keepPins(s.pins.map(p => (p.id === id ? { ...p, width } : p))) })),

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

  setCompare: async rev => {
    const w = ws(), name = get().name
    if (!rev || !w || !name || rev >= get().revision) { set({ compareFrom: undefined, compareMap: undefined }); return }
    // A past revision never changes: comparing with the same one keeps its map, and the ghosts drawn from it.
    if (rev === get().compareFrom && get().compareMap) return
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
      await api.post<{ thread: CanvasThread }>(`/api/canvas/${name}/comment`, { ws: w, target: part, text, threadId, ...target() })
    } catch (e) {
      useApp.getState().toast((e as Error).message, 'error')
      return false
    }
    await get().reload()
    return true
  },

  askSide: async (part, text, threadId) => {
    const w = ws(), name = get().name
    if (!w || !name) return false
    // The terminal that opened the decision answers when it is there; the one picked only stands in.
    const to = sendingTo(useApp.getState())
    try {
      await api.post<{ thread: CanvasThread }>(`/api/canvas/${name}/ask`, { ws: w, target: part, text, threadId, ...('terminal' in to ? { terminalId: to.terminal } : {}) })
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
    // Told to Claude: refused, with nothing chosen, when no terminal takes it.
    const sent = await Promise.resolve()
      .then(() => api.post<{ terminalId?: string }>(`/api/canvas/${name}/choose`, { ws: w, decision, option, rationale, notify, ...(notify ? target() : {}) }))
      .catch((e: Error) => { useApp.getState().toast(e.message, 'error') })
    if (!sent) return
    get().acknowledge()
    if (sent.terminalId) useApp.getState().toast('결정을 터미널에 보냈어')
  },

  deciding: false,
  setDeciding: on => set({ deciding: on }),

  decide: async (decision, option, rationale, send) => {
    const w = ws(), name = get().name
    if (!w || !name) return undefined
    const cur = await api.post<{ revision: number }>(`/api/canvas/${name}/choose`, { ws: w, decision, option, rationale })
      .catch((e: Error) => { useApp.getState().toast(e.message, 'error') })
    if (!cur) return undefined
    const p = pendingOf(w, name)
    const to = sendingTo(useApp.getState())
    setPending(w, name, { ids: withDecision(p.ids, decision, send), to: send && 'terminal' in to ? { terminalId: to.terminal } : p.to })
    get().acknowledge()
    return cur.revision
  },

  undoDecide: async (decision, revision) => {
    const w = ws(), name = get().name
    // Another revision since (the agent's, or another edit): taking this one back would take that with it.
    if (!w || !name || get().revision > revision) return false
    await api.post(`/api/canvas/${name}/restore`, { ws: w, revision: revision - 1 })
    const p = pendingOf(w, name)
    setPending(w, name, { ...p, ids: withDecision(p.ids, decision, false) })
    return true
  },

  flushDecisions: async (quiet, map) => {
    const w = ws(), name = map ?? get().name
    if (!w || !name) return
    const { ids, to } = pendingOf(w, name)
    if (!ids.length) return
    const now = sendingTo(useApp.getState())
    // No terminal to take them: they wait, unsent, for the next time this map closes decision mode or opens.
    if (!to && 'refused' in now) {
      if (!quiet) useApp.getState().toast(`결정을 보내지 못했어: ${now.refused} 다음에 이 지도를 열 때 다시 보낼게`, 'error')
      return
    }
    // Taken off before the request, so a second flush (the mode closing as the map reopens) does not send them twice.
    setPending(w, name, { ids: [] })
    type Sent = { sent: string[]; terminalId?: string }
    const post = (t: { terminalId: string }) => api.post<Sent>(`/api/canvas/${name}/decided`, { ws: w, decisions: ids, ...t }).catch((e: Error) => e)
    let sent = await post(to ?? { terminalId: (now as { terminal: string }).terminal })
    // The terminal they were made for is gone: the target now gets them.
    if (sent instanceof ApiError && sent.status < 500 && sent.status !== 409 && to && 'terminal' in now && now.terminal !== to.terminalId) sent = await post({ terminalId: now.terminal })
    if (sent instanceof Error) {
      // Refused for good (4xx but no terminal): the map keeps the choices, and saying so beats failing on every open of this map.
      if (sent instanceof ApiError && sent.status < 500 && sent.status !== 409 && sent.status !== 410) useApp.getState().toast(`결정을 Claude에게 보내지 못했어: ${sent.message}. 지도에는 남아 있어`, 'error')
      else {
        setPending(w, name, { ids: [...new Set([...pendingOf(w, name).ids, ...ids])], to })
        useApp.getState().toast(`결정을 보내지 못했어: ${sent.message}. 다음에 이 지도를 열 때 다시 보낼게`, 'error')
      }
      return
    }
    if (!sent.sent.length) return
    if (!quiet) useApp.getState().toast(`결정 ${sent.sent.length}개를 터미널에 보냈어`)
    if (get().name === name) await get().refreshThreads()
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
