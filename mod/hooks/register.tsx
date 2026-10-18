import type { EngineInterface, HttpResponse, Register, Timer } from 'claude-code'

import { argsOf, duetHomeOf, labelOf, linkOf, noRepo, pinNote, runDuet, statusText, unreachable, unreachableForPerson } from './duet'
import type { Link, Maps, MapSummary } from './duet'
import { TOOLS } from './tools'

/** How long the server holds a poll open: under the 30 s one `$.http.fetch` may take. */
const WAIT_MS = 20_000
/** After Duet did not answer, or knew no workspace here, the next try waits this long. */
const RETRY_MS = 5_000

type Outgoing = { id: string; text: string; state: 'queued' | 'delivered' | 'working' }

/**
 * The module's state; a reload starts it over, and the server tells the new module what it holds.
 * `held` is the one message this terminal has from Duet: submitted, it runs once the session is idle.
 * `pin` is the map `/duet` pinned in this folder; `told` is the pin this session's model last heard of.
 * `isCompacted`: the conversation was compacted since, and its summary may have dropped what the model was told.
 */
const st = {
  session: '',
  label: '',
  cwd: '',
  duetHome: '',
  envToken: undefined as string | undefined,
  server: undefined as { base: string; token: string } | undefined,
  workspace: undefined as string | undefined,
  isRegistered: false,
  link: { kind: 'off' } as Link,
  shown: '',
  touched: undefined as { name: string; at: number } | undefined,
  maps: undefined as MapSummary[] | undefined,
  pin: undefined as string | undefined,
  told: undefined as { session: string; pin: string | undefined } | undefined,
  isCompacted: false,
  held: undefined as { id: string; text: string; turnId?: string; isWorking: boolean } | undefined,
  lastTurn: '',
  isPolling: false,
  retryAt: 0,
  timer: undefined as Timer | undefined,
}

function call($: EngineInterface, method: string, path: string, payload?: unknown): Promise<HttpResponse> {
  const server = st.server
  if (!server) return Promise.reject(new Error('no server'))
  return $.http.fetch(`${server.base}${path}`, {
    method,
    headers: { 'x-duet-token': server.token, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
}

function show($: EngineInterface, link: Link) {
  st.link = link
  const text = statusText(link)
  if (text === st.shown) return
  st.shown = text
  $.ui.status(text)
}

async function refreshStatus($: EngineInterface) {
  if (!st.workspace) return
  const res = await call($, 'GET', `/api/canvas?ws=${encodeURIComponent(st.workspace)}`)
  if (!res.ok) return
  const maps = JSON.parse(res.text) as MapSummary[]
  st.maps = maps
  // A map deleted since it was pinned takes the pin with it.
  if (st.pin !== undefined && !maps.some(m => m.name === st.pin)) await setPin($, undefined)
  show($, linkOf(maps, st.touched, st.pin))
  await tellPin($)
}

const pinKey = () => `pin:${st.cwd}`
const terminalBody = () => ({ id: st.session, workspace: st.workspace, cwd: st.cwd, label: st.label, map: st.pin })

/** Pins a map, or none: for this session, for the next one in this folder (the store), and in Duet's terminal list. */
async function setPin($: EngineInterface, pin: string | undefined) {
  if (pin === st.pin) return
  st.pin = pin
  await (pin === undefined ? $.store.delete(pinKey()) : $.store.set(pinKey(), pin)).catch(() => undefined)
  if (st.link.kind === 'on' && st.maps) show($, linkOf(st.maps, st.touched, st.pin))
  if (st.isRegistered) await call($, 'POST', '/api/terminals', terminalBody()).catch(() => undefined)
}

/** A session that has not heard of the pin as it stands (it started pinned, a /clear, a deleted map) is told, without a turn. */
async function tellPin($: EngineInterface) {
  const said = st.told?.session === st.session ? st.told.pin : undefined
  if (said === st.pin) return
  st.told = { session: st.session, pin: st.pin }
  const text = pinNote(st.pin, st.maps ?? [], said)
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } }).catch(() => undefined)
}

/** A /clear, /resume or /branch goes on under a new session id with no session.start: follow it. */
async function followSession($: EngineInterface) {
  const id = await $.session.id().catch(() => '')
  if (id === '' || id === st.session) return
  st.session = id
  st.label = labelOf(st.cwd, id)
  st.isRegistered = false
}

/** Finds the server (its port and token), the workspace this folder belongs to, and registers this terminal. */
async function connect($: EngineInterface): Promise<boolean> {
  await followSession($)
  if (st.isRegistered) return true
  try {
    const { port } = JSON.parse(await $.fs.read(`${st.duetHome}/server.json`)) as { port: number }
    const token = st.envToken || (await $.fs.read(`${st.duetHome}/token`)).trim()
    st.server = { base: `http://127.0.0.1:${port}`, token }
    // A server older than this route answers 404: to this terminal it is as good as off until `duet` restarts it.
    const found = await call($, 'GET', `/api/workspaces/for?path=${encodeURIComponent(st.cwd)}`)
    if (!found.ok) throw new Error(`workspaces/for ${found.status}`)
    const { workspace } = JSON.parse(found.text) as { workspace: string | null }
    if (!workspace) {
      st.workspace = undefined
      show($, { kind: 'no-workspace' })
      st.retryAt = Date.now() + RETRY_MS * 2
      return false
    }
    st.workspace = workspace
    // The list first: a pinned map that is gone is not announced.
    await refreshStatus($)
    const res = await call($, 'POST', '/api/terminals', terminalBody())
    if (!res.ok) throw new Error(`register ${res.status}`)
    const { holding } = JSON.parse(res.text) as { holding?: Outgoing }
    if (holding && st.held?.id !== holding.id) st.held = { id: holding.id, text: holding.text, isWorking: holding.state === 'working' }
    st.isRegistered = true
    st.retryAt = 0
    return true
  } catch {
    st.server = undefined
    show($, { kind: 'off' })
    st.retryAt = Date.now() + RETRY_MS
    return false
  }
}

/** Long-polls the server: the poll is the heartbeat, the inbox and the wake-up when a map changes. */
async function pump($: EngineInterface) {
  if (st.isPolling || Date.now() < st.retryAt) return
  st.isPolling = true
  try {
    if (!(await connect($))) return
    const res = await call($, 'GET', `/api/terminals/${st.session}/poll?wait=${WAIT_MS}`)
    // The server restarted and forgot this terminal.
    if (res.status === 404) { st.isRegistered = false; return }
    if (!res.ok) throw new Error(`poll ${res.status}`)
    const poll = JSON.parse(res.text) as { message?: Outgoing; canvas?: true }
    if (poll.message) take($, poll.message)
    if (poll.canvas) await refreshStatus($)
  } catch {
    st.isRegistered = false
    st.server = undefined
    show($, { kind: 'off' })
    st.retryAt = Date.now() + RETRY_MS
  } finally {
    st.isPolling = false
  }
}

/** Duet's message becomes a prompt of this session, as if the person typed it here: it runs once the session is idle. */
function take($: EngineInterface, m: Outgoing) {
  st.held = { id: m.id, text: m.text, isWorking: false }
  void $.prompt.submit({ text: m.text, asUser: true }).then(
    r => {
      if (r.drop !== undefined) return letGo($, m.id, undefined, `Duet에서 온 메시지를 훅이 막았어: ${r.drop}`)
      // Resolves as its turn starts; turn.start already bound it unless a hook changed the text.
      if (st.held?.id === m.id && !st.held.turnId) {
        st.held = { ...st.held, turnId: st.lastTurn, isWorking: true }
        void report($, m.id, { state: 'working' })
      }
    },
    (error: unknown) => letGo($, m.id, undefined, `Duet에서 온 메시지를 넣지 못했어: ${error instanceof Error ? error.message : String(error)}`),
  )
}

async function report($: EngineInterface, id: string, change: { state: 'working' } | { state: 'done'; answer?: string }) {
  await call($, 'POST', `/api/terminals/${st.session}/messages/${id}`, change).catch(() => undefined)
}

async function letGo($: EngineInterface, id: string, answer: string | undefined, notice?: string) {
  if (st.held?.id === id) st.held = undefined
  if (notice) await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: notice }] } }).catch(() => undefined)
  await report($, id, { state: 'done', answer })
}

async function relay($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  const spec = TOOLS.find(t => `mcp__duet__${t.spec.name}` === tool)
  if (!spec) return { deny: `No Duet tool ${tool}.` }
  const isCreate = spec.relays === 'canvas_create'
  // A tool call need not wait out a retry: Duet may have come back since.
  st.retryAt = 0
  if (!(await connect($))) {
    // Only a new map starts a workspace: this folder's repository opens in Duet as the workspace picker opens it.
    if (!isCreate || st.link.kind !== 'no-workspace') return { deny: unreachable(st.link, st.cwd) }
    const opened = await call($, 'POST', '/api/workspaces', { path: st.cwd })
    if (!opened.ok) return { deny: opened.status === 400 ? noRepo(st.cwd) : `Duet answered ${opened.status}.` }
    if (!(await connect($))) return { deny: unreachable(st.link, st.cwd) }
  }
  let res = await call($, 'POST', `/api/terminals/${st.session}/tools/${spec.relays}`, args)
  if (res.status === 410 || res.status === 404) {
    st.isRegistered = false
    if (!(await connect($))) return { deny: unreachable(st.link, st.cwd) }
    res = await call($, 'POST', `/api/terminals/${st.session}/tools/${spec.relays}`, args)
  }
  const out = JSON.parse(res.text) as { text?: string; isError?: boolean; error?: string }
  if (!res.ok || out.isError) return { deny: out.text ?? out.error ?? `Duet answered ${res.status}.` }
  const text = out.text ?? ''
  const map = typeof args.name === 'string' ? args.name : undefined
  if (map === undefined || !['canvas_read', 'canvas_create', 'canvas_update'].includes(spec.relays)) return { result: text }
  st.touched = { name: map, at: Date.now() }
  await refreshStatus($).catch(() => undefined)
  if (!isCreate || st.pin !== undefined) return { result: text }
  // A new map is pinned as `/duet <map>` pins one. The model hears of it in the result: a row appended now could land between the call and its result.
  st.told = { session: st.session, pin: map }
  await setPin($, map)
  return { result: `${text}\n\n${pinNote(map, st.maps ?? [])}` }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Duet's own conversations have Duet's own canvas tools, and are no terminal.
    if ((await $.env.get('DUET_CONVERSATION')) === '1') return next(e)
    st.cwd = e.cwd
    st.session = await $.session.id()
    st.label = labelOf(e.cwd, st.session)
    st.duetHome = duetHomeOf(await $.env.get('DUET_HOME'), (await $.env.get('HOME')) ?? '')
    st.envToken = await $.env.get('DUET_TOKEN')
    const saved = await $.store.get(`pin:${e.cwd}`).catch(() => undefined)
    st.pin = typeof saved === 'string' && saved !== '' ? saved : undefined
    for (const t of TOOLS) await $.tool.register(t.spec)
    st.timer?.cancel()
    st.timer = $.clock.every(1_000, () => void pump($))
    await $.command.register({ name: 'duet', description: '이 터미널의 기준 지도를 고정해: /duet [지도 이름이나 제목 | off]', argumentHint: '[지도 | off]' }).catch(() => undefined)
    return next(e)
  })

  // `/duet` shows the pin and the maps, `/duet <map>` pins one, `/duet off` unpins; the model hears of a change with the answer.
  on('command.run', { command: 'duet' }, async ($, e) => {
    st.retryAt = 0
    const isOn = await connect($)
    if (isOn) await refreshStatus($).catch(() => undefined)
    const source: Maps = isOn && st.maps ? { kind: 'maps', maps: st.maps } : { kind: 'unreachable', why: unreachableForPerson(st.link, st.cwd) }
    const before = st.pin
    const done = runDuet(e.args, before, source)
    if (done.pin === before) return { text: done.text }
    st.told = { session: st.session, pin: done.pin }
    await setPin($, done.pin)
    return { text: done.text, context: [pinNote(done.pin, st.maps ?? [], before)] }
  })

  on('session.end', async ($, e, next) => {
    // /clear, /resume and /branch go on in this process under a new id: the poll follows it.
    if (e.reason !== 'clear' && e.reason !== 'resume') {
      st.timer?.cancel()
      st.timer = undefined
    }
    if (st.isRegistered) await call($, 'DELETE', `/api/terminals/${st.session}`).catch(() => undefined)
    st.isRegistered = false
    return next(e)
  })

  // After a compaction the model hears of the pin again, at the next turn: a note added by the compaction's own
  // hooks lands before the compacted conversation is put in place, and is gone with the rest.
  on('command.run', { command: 'compact' }, async ($, e, next) => {
    const result = await next(e)
    st.isCompacted = true
    return result
  })
  // A headless session (-p, the SDK) compacts as a /compact prompt instead, without this event.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) st.isCompacted = true
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    st.lastTurn = e.turnId
    if (st.isCompacted) {
      st.isCompacted = false
      st.told = undefined
      await tellPin($)
    }
    const held = st.held
    if (held && !held.turnId && e.text === held.text) {
      st.held = { ...held, turnId: e.turnId, isWorking: true }
      void report($, held.id, { state: 'working' })
    }
    return next(e)
  })

  // The turn's answer is the reply: it goes to the canvas thread the message came from, as in Duet.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const held = st.held
    if (e.agentId === undefined && held?.isWorking && (held.turnId === undefined || held.turnId === e.turnId)) {
      await letGo($, held.id, e.isAborted ? undefined : e.answer)
    }
    return result
  })

  on('tool.call', { tool: /^mcp__duet__duet_map_/ }, async ($, e) => relay($, String(e.tool), argsOf(e as unknown as Record<string, unknown>)))
    .catch(async ($, e, next) => ({ deny: `The Duet mod failed on this call (${next.error?.kind ?? 'error'}).` }))
}
