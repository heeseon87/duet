// The mod's parts that need no `$`: tests run them without a session.

/** Where the Duet server keeps its files: DUET_HOME as the server reads it, else ~/.duet. */
export const duetHomeOf = (duetHome: string | undefined, home: string) => duetHome || `${home}/.duet`

/** How Duet names a terminal: its folder and the start of its session id. */
export const labelOf = (cwd: string, id: string) => `${cwd.split('/').filter(p => p !== '').at(-1) ?? '~'} · ${id.slice(0, 8)}`

/** A map as `GET /api/canvas` lists it, newest first. */
export type MapSummary = { name: string; title: string; revision: number; updated: number; decisions: number; openDecisions: number; openThreads: number }

/** What this terminal knows of Duet. `isPinned`: the map is the one `/duet` pinned here. */
export type Link = { kind: 'off' } | { kind: 'no-workspace' } | { kind: 'on'; map?: MapSummary; isPinned?: boolean }

/** The map to show: the one this terminal last read or changed, unless another map changed since. */
export function shownMap(maps: MapSummary[], touched?: { name: string; at: number }): MapSummary | undefined {
  const newest = maps.reduce<MapSummary | undefined>((a, m) => (!a || m.updated > a.updated ? m : a), undefined)
  const mine = touched && maps.find(m => m.name === touched.name)
  if (!mine || !newest) return newest
  return newest.updated > Math.max(touched.at, mine.updated) ? newest : mine
}

/** The status line's link: the pinned map while it exists, else the shown one. */
export function linkOf(maps: MapSummary[], touched?: { name: string; at: number }, pin?: string): Link {
  const pinned = pin === undefined ? undefined : maps.find(m => m.name === pin)
  return pinned ? { kind: 'on', map: pinned, isPinned: true } : { kind: 'on', map: shownMap(maps, touched) }
}

const decided = (m: MapSummary) => (m.decisions ? [`결정 ${m.decisions - m.openDecisions}/${m.decisions}`] : [])

export function statusText(link: Link): string {
  if (link.kind === 'off') return 'Duet 꺼짐'
  if (link.kind === 'no-workspace') return 'Duet 작업 공간 없음'
  const m = link.map
  if (!m) return 'Duet · 지도 없음'
  return ['Duet', `${link.isPinned ? '📌 ' : ''}${m.title}`, `rev ${m.revision}`, ...decided(m), `코멘트 ${m.openThreads}`].join(' · ')
}

/** What `/duet <map>` finds: a name exactly, else the one map whose name or title holds the text. */
export type MapMatch = { kind: 'one'; map: MapSummary } | { kind: 'many'; maps: MapSummary[] } | { kind: 'none' }

export function matchMap(maps: MapSummary[], query: string): MapMatch {
  const exact = maps.find(m => m.name === query)
  if (exact) return { kind: 'one', map: exact }
  const q = query.toLowerCase()
  const found = maps.filter(m => m.name.toLowerCase().includes(q) || m.title.toLowerCase().includes(q))
  if (found.length === 1) return { kind: 'one', map: found[0]! }
  return found.length ? { kind: 'many', maps: found } : { kind: 'none' }
}

const pinLine = (pin: string | undefined, maps: MapSummary[]) => {
  if (pin === undefined) return '고정된 지도 없음'
  const m = maps.find(x => x.name === pin)
  return m ? `기준 지도: ${m.title} (${m.name})` : `기준 지도: ${pin}`
}

const mapLines = (maps: MapSummary[], pin?: string) =>
  maps.map(m => `- ${[m.name, m.title, `rev ${m.revision}`, ...decided(m)].join(' · ')}${m.name === pin ? ' 📌' : ''}`).join('\n')

/** The maps `/duet` works on, or why it cannot reach them (in the person's words). */
export type Maps = { kind: 'maps'; maps: MapSummary[] } | { kind: 'unreachable'; why: string }

/** What `/duet` answers, and the pin it leaves: `/duet` shows, `/duet off` unpins, `/duet <map>` pins one map or changes nothing. */
export function runDuet(args: string, pin: string | undefined, source: Maps): { text: string; pin: string | undefined } {
  const query = args.trim()
  if (query === 'off') return { text: pin === undefined ? '고정된 지도 없음' : `지도 고정을 풀었어 (${pin})`, pin: undefined }
  if (source.kind === 'unreachable') return { text: query === '' ? `${pinLine(pin, [])}\n${source.why}` : source.why, pin }
  const { maps } = source
  if (query === '') return { text: `${pinLine(pin, maps)}\n\n이 작업 공간의 지도 ${maps.length}개\n${mapLines(maps, pin)}`, pin }
  const match = matchMap(maps, query)
  if (match.kind === 'one') return { text: pinLine(match.map.name, maps), pin: match.map.name }
  if (match.kind === 'many') return { text: `"${query}"에 맞는 지도가 ${match.maps.length}개야. 이름이나 제목을 더 적어 줘:\n${mapLines(match.maps, pin)}`, pin }
  return { text: `"${query}"에 맞는 지도가 없어. 이 작업 공간의 지도:\n${mapLines(maps, pin)}`, pin }
}

/** `/duet new <name> [title]`: the map to make, its title the name when none is given; `undefined` for any other `/duet`. */
export function newMapOf(args: string): { name: string; title: string } | undefined {
  const [head, name = '', ...title] = args.trim().split(/\s+/)
  if (head !== 'new') return undefined
  return { name, title: title.join(' ') || name }
}

/** Why `/duet` cannot list maps, for the person. */
export function unreachableForPerson(link: Link, cwd: string): string {
  return link.kind === 'no-workspace'
    ? `이 폴더(${cwd})는 Duet에 연 작업 공간에 없어. Duet에서 이 폴더나 이 저장소를 먼저 열어 줘.`
    : 'Duet이 꺼져 있어. `duet`으로 켜 줘.'
}

/** What the model reads when the pin changes, or when a session starts pinned. */
export function pinNote(pin: string | undefined, maps: MapSummary[], before?: string): string {
  if (pin === undefined) {
    return `[Duet] This terminal no longer has a pinned Duet map${before ? ` (it was "${before}")` : ''}. When the person does not name a map, ask which one, or list them with duet_map_list.`
  }
  const title = maps.find(m => m.name === pin)?.title
  return `[Duet] This terminal works from the Duet map "${pin}"${title ? ` (${title})` : ''}. When the person says "the map", "this terminal's map" or names no map, pass name "${pin}" to the duet_map_* tools. Use another map only when the person names it.`
}

/** Whether the conversation the model is sent still holds the note for this pin (a compaction may have dropped it). */
export function heardPin(messages: readonly { content: unknown }[], pin: string): boolean {
  const note = `[Duet] This terminal works from the Duet map "${pin}"`
  const holds = (c: unknown): boolean =>
    typeof c === 'string' ? c.includes(note)
      : Array.isArray(c) ? c.some(holds)
        : typeof c === 'object' && c !== null && (holds((c as { text?: unknown }).text) || holds((c as { content?: unknown }).content))
  return messages.some(m => holds(m.content))
}

/** A tool's arguments: the call without the fields Claude Code adds to it. */
export function argsOf(e: Record<string, unknown>): Record<string, unknown> {
  const { tool: _tool, tool_use_id: _id, ...args } = e
  return args
}

/** What the model reads when it cannot reach the maps. */
export function unreachable(link: Link, cwd: string): string {
  return link.kind === 'no-workspace'
    ? `This folder (${cwd}) is not in a workspace open in Duet. The person opens it (or the repo it belongs to) in Duet first, or duet_map_create starts one: it opens this folder's git repository in Duet and makes the map there.`
    : 'Duet is not running, so its maps cannot be read or changed. The person starts it with the `duet` command.'
}

/** What the model reads when this terminal is not connected to Duet: on a tool call, and on `/duet off`. */
export const notConnected = '[Duet] This terminal is not connected to Duet, so the duet_map_* tools refuse. The person connects it with /duet (or /duet <map> to pin one).'

/** What the model reads when duet_map_create cannot start a workspace here. */
export function noRepo(cwd: string): string {
  return `A Duet workspace is a git repository, and this folder (${cwd}) is not inside one. Make the map from a folder inside a git repository.`
}

/**
 * The one message this terminal holds from Duet, followed across the turns it causes.
 * `turnId`: the main turn running for it now. `spawned`: the background agents its turns started; `running`: those
 * not ended yet; `reported`: those whose hand-back started a turn of it. `answer`: its last turn's, kept while it waits.
 */
export type Held = { id: string; text: string; isWorking: boolean; turnId?: string; spawned?: string[]; running?: string[]; reported?: string[]; answer?: string }

/** How long the session stays quiet, its agents done, before a message ends with no hand-back turn (one folded into a turn, or none). */
export const QUIET_MS = 3_000

/** The background agent a turn's prompt reports for: a hand-back, or a background task's notice. */
export function reportFrom(text: string): string | undefined {
  return /^<agent-message from="([^"]+)">/.exec(text)?.[1] ?? /^<task-notification>\s*<task-id>([^<\s]+)/.exec(text)?.[1]
}

/** A main turn starts: the message's own (`isNew`: it starts working), or one a hand-back of its agents starts. */
export function heldStarts(held: Held | undefined, turn: { turnId: string; text: string }): { held: Held | undefined; isNew: boolean } {
  if (!held || held.turnId) return { held, isNew: false }
  if (turn.text === held.text) return { held: { ...held, turnId: turn.turnId, isWorking: true }, isNew: true }
  const from = reportFrom(turn.text)
  if (!held.isWorking || from === undefined || !held.spawned?.includes(from)) return { held, isNew: false }
  return { held: { ...held, turnId: turn.turnId, reported: [...(held.reported ?? []), from] }, isNew: false }
}

/** The spawns the message waits for: a local background subagent of the main loop, whose end this terminal hears (no teammate, no workflow agent). */
export const followsSpawn = (e: { background: boolean; parentAgentId?: string; isTeammate?: true; workflow?: unknown }) =>
  e.background && e.parentAgentId === undefined && e.isTeammate === undefined && e.workflow === undefined

/** Agents the engine lists as ended, or no longer lists, stop holding the message: an end this terminal never heard. */
export function heldPrune(held: Held | undefined, agents: readonly { id: string; status: string }[]): Held | undefined {
  if (!held?.running?.length) return held
  const running = held.running.filter(a => agents.some(x => x.id === a && !['completed', 'failed', 'killed'].includes(x.status)))
  return running.length === held.running.length ? held : { ...held, running }
}

/** A background agent starts in a turn of the message: the message waits for its hand-back. */
export function heldSpawned(held: Held | undefined, agentId: string): Held | undefined {
  if (!held?.turnId) return held
  return { ...held, spawned: [...(held.spawned ?? []), agentId], running: [...(held.running ?? []), agentId] }
}

/** A turn ends, an agent's or a main one: `done` carries the answer for the thread (none when it was cut off). */
export function heldEnds(held: Held | undefined, turn: { turnId: string; agentId?: string; answer: string; isAborted: boolean }): { held: Held | undefined; done?: { answer?: string } } {
  if (!held) return { held }
  if (turn.agentId !== undefined) {
    return held.running?.includes(turn.agentId) ? { held: { ...held, running: held.running.filter(a => a !== turn.agentId) } } : { held }
  }
  if (!held.isWorking) return { held }
  // A message held across a reload knows none of its turns: the next answer is its.
  if (held.turnId === undefined && !held.spawned?.length) return { held: undefined, done: { answer: turn.isAborted ? undefined : turn.answer } }
  if (held.turnId !== turn.turnId) return { held }
  if (turn.isAborted) return { held: undefined, done: {} }
  const waits = Boolean(held.running?.length) || Boolean(held.spawned?.some(a => !held.reported?.includes(a)))
  return waits ? { held: { ...held, turnId: undefined, answer: turn.answer } } : { held: undefined, done: { answer: turn.answer } }
}

/** A message whose agents are all done, and no hand-back turn after `quietFor` ms of quiet, ends with its last answer. */
export function heldQuiet(held: Held | undefined, quietFor: number): { answer?: string } | undefined {
  if (!held?.isWorking || held.turnId !== undefined || !held.spawned?.length || held.running?.length) return undefined
  return quietFor >= QUIET_MS ? { answer: held.answer } : undefined
}

/** What the terminal waits on the person for, as Duet's rail and the box over the map show it. */
export type Waiting = { kind: 'question' | 'permission'; text: string }

/** A line of activity is cut to this many characters. */
export const LINE_MAX = 200

/** Text on one line, cut to LINE_MAX. */
export function lineOf(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > LINE_MAX ? `${one.slice(0, LINE_MAX - 1)}…` : one
}

/** What a response row of the model says, on one line; none for a row with no text (a tool call alone, thinking). */
export function saidOf(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const texts = content.filter((b): b is { type: 'text'; text: string } => b?.type === 'text' && typeof b.text === 'string').map(b => b.text)
  return lineOf(texts.join(' ')) || undefined
}

/** What a tool call waits on the person for: the question it asks, the plan to approve, or the tool and what it touches (a path under `cwd` from there). */
export function waitingOf(tool: string, input: unknown, cwd?: string): Waiting {
  const i = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  if (tool === 'AskUserQuestion') {
    const asked = (Array.isArray(i.questions) ? i.questions : []).map(q => (q as { question?: unknown } | null)?.question).filter((q): q is string => typeof q === 'string' && q.trim() !== '')
    return { kind: 'question', text: lineOf(asked.length > 1 ? `${asked[0]} (외 ${asked.length - 1}개)` : asked[0] ?? '질문') }
  }
  if (tool === 'ExitPlanMode') return { kind: 'permission', text: '계획 승인' }
  const what = [i.command, i.file_path, i.notebook_path, i.url, i.pattern].find((v): v is string => typeof v === 'string' && v.trim() !== '')
  const near = what !== undefined && cwd && what.startsWith(`${cwd}/`) ? what.slice(cwd.length + 1) : what
  return { kind: 'permission', text: lineOf(near === undefined ? tool : `${tool} · ${near}`) }
}
