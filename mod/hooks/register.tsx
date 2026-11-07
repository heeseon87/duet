import type { EngineInterface, HttpResponse, Register, Timer } from 'claude-code'

import { argsOf, duetHomeOf, followsSpawn, heardPin, heldEnds, heldPrune, heldQuiet, heldSpawned, heldStarts, labelOf, linkOf, newMapOf, noRepo, notConnected, pinNote, runDuet, saidOf, statusText, unreachable, unreachableForPerson, waitingOf } from './duet'
import type { Held, Link, Maps, MapSummary, Waiting } from './duet'
import { TOOLS } from './tools'

/** How long the server holds a poll open: under the 30 s one `$.http.fetch` may take. */
const WAIT_MS = 20_000
/** After Duet did not answer, or knew no workspace here, the next try waits this long. */
const RETRY_MS = 5_000
/** How long an ask goes unheard by Duet: the auto mode's classifier settles most asks sooner (1 to 2.5 s), and no person sees those. */
const ASK_MS = 3_000

type Outgoing = { id: string; text: string; state: 'queued' | 'delivered' | 'working' }

/**
 * The module's state; a reload starts it over, and the server tells the new module what it holds.
 * `held` is the one message this terminal has from Duet: submitted, it runs once the session is idle, and holds on
 * through the hand-back turns of the background agents it starts. `quietAt`: when the last turn, a main or an agent's, ended.
 * `isOn`: the person connected this terminal with `/duet`; until then it neither polls nor shows a status line.
 * `pin` is the map `/duet` pinned in this terminal; `told` is the pin this session's model last heard of.
 */
const st = {
  session: '',
  label: '',
  cwd: '',
  duetHome: '',
  envToken: undefined as string | undefined,
  server: undefined as { base: string; token: string } | undefined,
  workspace: undefined as string | undefined,
  isOn: false,
  hasTerminal: false,
  hasTools: false,
  isRegistered: false,
  link: { kind: 'off' } as Link,
  shown: '',
  touched: undefined as { name: string; at: number } | undefined,
  maps: undefined as MapSummary[] | undefined,
  pin: undefined as string | undefined,
  told: undefined as { session: string; pin: string | undefined } | undefined,
  held: undefined as Held | undefined,
  lastTurn: '',
  isTurnRunning: false,
  /** The main agent's last words, and the tool calls waiting on the person by `tool_use_id` (`isShown` once Duet heard). */
  said: undefined as string | undefined,
  waits: new Map<string, { waiting: Waiting; isShown: boolean }>(),
  quietAt: 0,
  isPruning: false,
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

/**
 * The terminal draws the line dim at the end of the prompt hint (`ui.status` would draw it as a ⚠ notice);
 * a session with no terminal (the SDK, -p) has no hint, and keeps the status line.
 */
function draw($: EngineInterface) {
  if (st.hasTerminal) $.ui.invalidate('ui.render')
  else $.ui.status(st.shown === '' ? undefined : st.shown)
}

function show($: EngineInterface, link: Link) {
  st.link = link
  // A poll still in flight when `/duet off` ran answers after it: the line stays cleared.
  if (!st.isOn) return
  const text = statusText(link)
  if (text === st.shown) return
  st.shown = text
  draw($)
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

/** `asks`: this mod answers side questions (`answerAsk`); Duet sends none to a terminal that does not say so. */
const terminalBody = () => ({ id: st.session, workspace: st.workspace, cwd: st.cwd, label: st.label, map: st.pin, isWorking: st.isTurnRunning, asks: true })

/** Reports reach Duet in the order made: a wait cleared must not land before the wait it clears, nor after the turn's end. */
let reporting: Promise<unknown> = Promise.resolve()

/** Each main turn's start and end, the person's own too: Duet's rail shows whether this terminal works. */
function reportTurn($: EngineInterface, turnId: string, edge: 'start' | 'end') {
  if (!st.isRegistered) return
  const path = `/api/terminals/${st.session}/turns`
  reporting = reporting.then(() => call($, 'POST', path, { turnId, edge })).catch(() => undefined)
}

/** What this terminal does, for Duet's rail: its last words, and the oldest call Duet heard waits on the person. */
function reportActivity($: EngineInterface) {
  if (!st.isRegistered) return
  const waiting = [...st.waits.values()].find(w => w.isShown)?.waiting
  const path = `/api/terminals/${st.session}/activity`
  const body = { said: st.said, waiting }
  reporting = reporting.then(() => call($, 'POST', path, body)).catch(() => undefined)
}

/** A tool call waits on the person; after `afterMs`, if it still does, Duet hears of it. */
function waitOn($: EngineInterface, id: string, waiting: Waiting, afterMs: number) {
  st.waits.set(id, { waiting, isShown: false })
  void $.clock.sleep(afterMs).then(() => {
    const w = st.waits.get(id)
    if (!w || w.isShown) return
    w.isShown = true
    reportActivity($)
  })
}

/** The call no longer waits on the person: answered, refused, running or done. */
function settle($: EngineInterface, id: string) {
  const w = st.waits.get(id)
  if (!w) return
  st.waits.delete(id)
  if (w.isShown) reportActivity($)
}

/** Pins a map, or none: for this terminal and in Duet's terminal list. A new session starts with none. */
async function setPin($: EngineInterface, pin: string | undefined) {
  if (pin === st.pin) return
  st.pin = pin
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
  st.said = undefined
  st.waits.clear()
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
    // A server started anew knows nothing of what this terminal did before it.
    if (st.said !== undefined || st.waits.size) reportActivity($)
    return true
  } catch {
    st.server = undefined
    show($, { kind: 'off' })
    st.retryAt = Date.now() + RETRY_MS
    return false
  }
}

/** `/duet` connects this terminal: the map tools appear, and the poll starts. */
async function turnOn($: EngineInterface) {
  if (st.isOn) return
  st.isOn = true
  st.retryAt = 0
  st.hasTerminal = (await $.session.surfaces()).includes('terminal')
  if (!st.hasTools) {
    for (const t of TOOLS) await $.tool.register(t.spec)
    st.hasTools = true
  }
  st.timer?.cancel()
  st.timer = $.clock.every(1_000, () => void pump($))
}

/** `/duet off` lets go: Duet forgets the terminal, the poll stops and the status line clears. The tools stay, and refuse. */
async function turnOff($: EngineInterface) {
  if (!st.isOn) return
  st.isOn = false
  st.timer?.cancel()
  st.timer = undefined
  if (st.isRegistered) await call($, 'DELETE', `/api/terminals/${st.session}`).catch(() => undefined)
  st.isRegistered = false
  st.server = undefined
  st.workspace = undefined
  st.maps = undefined
  st.link = { kind: 'off' }
  st.shown = ''
  st.waits.clear()
  draw($)
}

/** An agent of the held message that ended without an end this mod heard lets go of it; the hand-back turn still gets QUIET_MS. */
async function pruneAgents($: EngineInterface) {
  if (!st.held?.running?.length || st.isPruning) return
  st.isPruning = true
  try {
    const agents = await $.agent.list()
    const pruned = heldPrune(st.held, agents)
    if (pruned !== st.held) {
      st.held = pruned
      st.quietAt = Date.now()
    }
  } catch {
    // The next tick asks again.
  } finally {
    st.isPruning = false
  }
}

/** Long-polls the server: the poll is the heartbeat, the inbox and the wake-up when a map changes. */
async function pump($: EngineInterface) {
  // Before the poll's guard: a poll is held open for up to WAIT_MS.
  const held = st.held
  const quiet = held && !st.isTurnRunning ? heldQuiet(held, Date.now() - st.quietAt) : undefined
  if (held && quiet) void letGo($, held.id, quiet.answer)
  void pruneAgents($)
  if (!st.isOn || st.isPolling || Date.now() < st.retryAt) return
  st.isPolling = true
  try {
    if (!(await connect($))) return
    const res = await call($, 'GET', `/api/terminals/${st.session}/poll?wait=${WAIT_MS}`)
    // The server restarted and forgot this terminal.
    if (res.status === 404) { st.isRegistered = false; return }
    if (!res.ok) throw new Error(`poll ${res.status}`)
    const poll = JSON.parse(res.text) as { message?: Outgoing; ask?: { id: string; prompt: string }; canvas?: true }
    if (!st.isOn) return
    // Not awaited: the next poll goes out while the fork answers.
    if (poll.ask) void answerAsk($, poll.ask)
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

/**
 * A side question from Duet's decision screen: a fork of this conversation answers it at once, with no tools, whether or
 * not a turn runs, and nothing of it is kept here (the message Duet may hold is not touched). No `effort`: a level other
 * than the session's can cost a cache write of the whole conversation, so the prompt asks for haste instead.
 */
async function answerAsk($: EngineInterface, ask: { id: string; prompt: string }) {
  const r = await $.model.fork({ prompt: ask.prompt }).catch((e: unknown) => ({ isAnswered: false as const, reason: e instanceof Error ? e.message : String(e) }))
  const body = r.isAnswered ? { answer: r.text } : { reason: r.reason, status: 'status' in r ? r.status : undefined }
  await call($, 'POST', `/api/terminals/${st.session}/asks/${ask.id}`, body).catch(() => undefined)
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
  if (!st.isOn) return { deny: notConnected }
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
    st.duetHome = duetHomeOf(await $.env.get('DUET_HOME'), await $.env.get('HOME'), await $.env.get('USERPROFILE'))
    st.envToken = await $.env.get('DUET_TOKEN')
    // Nothing connects until the person runs /duet: no poll, no tools, no status line.
    await $.command.register({ name: 'duet', description: 'Duet에 연결하고 기준 지도를 고정해: /duet [지도 이름이나 제목 | new <이름> [제목](빈 지도 만들기) | off(연결 끊기)]', argumentHint: '[지도 | new <이름> [제목] | off]' }).catch(() => undefined)
    return next(e)
  })

  // `/duet` connects and shows the pin and the maps, `/duet <map>` connects and pins one, `/duet off` unpins and disconnects;
  // the model hears of a change with the answer.
  on('command.run', { command: 'duet' }, async ($, e) => {
    // `/duet new <name> [title]` makes an empty map without a model turn, asks its diagram, and pins it.
    const made = newMapOf(e.args)
    if (made !== undefined) {
      if (made.name === '') return { text: '만들 지도 이름을 적어 줘: /duet new <이름> [제목]' }
      await turnOn($)
      const diagram = await $.ui.ask(`"${made.name}" 지도를 어떤 다이어그램으로 만들까?`, { options: ['class', 'sequence'], header: '종류' }).catch(() => undefined)
      if (diagram !== 'class' && diagram !== 'sequence') return { text: '지도를 만들지 않았어' }
      const before = st.pin
      const out = await relay($, 'mcp__duet__duet_map_create', { name: made.name, diagram, title: made.title })
      if ('deny' in out) return { text: out.deny }
      st.told = { session: st.session, pin: made.name }
      await setPin($, made.name)
      return { text: `빈 ${diagram} 지도 "${made.title}"(${made.name})를 만들고 이 터미널에 고정했어`, context: [pinNote(made.name, st.maps ?? [], before)] }
    }
    if (e.args.trim() === 'off') {
      const wasOn = st.isOn
      const done = runDuet(e.args, st.pin, { kind: 'maps', maps: [] })
      await setPin($, undefined)
      await turnOff($)
      if (!wasOn) return { text: done.text }
      st.told = { session: st.session, pin: undefined }
      return { text: `${done.text}\nDuet 연결을 끊었어`, context: [notConnected] }
    }
    await turnOn($)
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

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    st.lastTurn = e.turnId
    st.isTurnRunning = true
    reportTurn($, e.turnId, 'start')
    // A compaction (/compact, the threshold) may drop the pin note: the model hears it again before it answers.
    // Read from what the model is sent, not from session.compact, which the built-in cc-plugin-sec-default (seated for Team and Enterprise organizations) keeps from installed plugins.
    if (st.isOn && st.pin !== undefined) {
      const sent = await $.session.messages({ as: 'api' }).catch(() => undefined)
      if (sent && !heardPin(sent, st.pin)) {
        st.told = undefined
        await tellPin($)
      }
    }
    const started = heldStarts(st.held, e)
    st.held = started.held
    if (started.isNew && started.held) void report($, started.held.id, { state: 'working' })
    return next(e)
  })

  // A background agent started from the message's turn answers in a turn its hand-back starts: the message waits for it.
  on('agent.spawn', { background: true }, async ($, e, next) => {
    const result = await next(e)
    if (followsSpawn(e) && result.agentId !== undefined) st.held = heldSpawned(st.held, result.agentId)
    return result
  })

  // The answer of the message's last turn is the reply: it goes to the canvas thread the message came from, as in Duet.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      st.isTurnRunning = false
      // Duet clears the wait with the turn's end; the calls left here have no answer to wait for.
      st.waits.clear()
      reportTurn($, e.turnId, 'end')
    }
    st.quietAt = Date.now()
    const held = st.held
    const ended = heldEnds(held, e)
    if (held && ended.done) await letGo($, held.id, ended.done.answer)
    else st.held = ended.held
    return result
  })

  on('ui.render', { component: 'PromptHint' }, ($, e, next) =>
    st.isOn && st.hasTerminal && st.shown !== '' ? next({ ...e, props: { ...e.props, tail: st.shown } }) : next(e))

  // The main agent's words, row by row, as they are kept: Duet's rail shows the last.
  on('session.append', { door: 'response' }, ($, e, next) => {
    const said = e.agentId === undefined && e.message.type === 'assistant' ? saidOf(e.message.content) : undefined
    if (said !== undefined && said !== st.said) {
      st.said = said
      reportActivity($)
    }
    return next(e)
  })

  // An ask goes to the mode's decider: the dialog, a host, or the auto mode's classifier, which no one sees. Where no one
  // can be asked it is a deny, done long before ASK_MS; `e.approver` is not read, as the SDK's engine (2.1.301) leaves it out.
  // A subagent's asks are left out: its commands get no background hint, so one the classifier let through would read
  // as waiting until it ends.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (st.isOn && verdict.decision === 'ask' && e.tool_use_id !== undefined && e.agentId === undefined && e.tool !== 'AskUserQuestion') {
      waitOn($, e.tool_use_id, waitingOf(e.tool, e.input, st.cwd), ASK_MS)
    }
    return verdict
  })

  // A question is its dialog: it waits from the call on. Any call waits no more once it resolves.
  on('tool.call', async ($, e, next) => {
    if (st.isOn && e.tool === 'AskUserQuestion') waitOn($, e.tool_use_id, waitingOf(e.tool, argsOf(e as unknown as Record<string, unknown>)), 0)
    try {
      return await next(e)
    } finally {
      settle($, e.tool_use_id)
    }
  })

  // A foreground command offered to the background runs: it was approved, or the classifier let it through.
  on('ui.render', { component: 'ToolProgress' }, ($, e, next) => {
    settle($, e.props.tool_use_id)
    return next(e)
  })

  on('tool.call', { tool: /^mcp__duet__duet_map_/ }, async ($, e) => relay($, String(e.tool), argsOf(e as unknown as Record<string, unknown>)))
    .catch(async ($, e, next) => ({ deny: `The Duet mod failed on this call (${next.error?.kind ?? 'error'}).` }))
}
