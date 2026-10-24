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
