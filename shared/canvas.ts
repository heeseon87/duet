// The canvas model: a structured design map (class or sequence) that the person and the agent
// shape together. Pure functions only, shared by the server (validation, patches) and the
// browser (Mermaid text, revision diffs).

export type Change = 'keep' | 'result' | 'modify' | 'delete' | 'add'
export type ElementKind = 'group' | 'class' | 'interface' | 'enum' | 'table' | 'resource' | 'external' | 'actor'
export type RelationKind = 'association' | 'dependency' | 'inheritance' | 'realization' | 'composition' | 'aggregation'
export type Direction = 'TB' | 'LR' | 'BT' | 'RL'

export type CanvasMember = {
  text: string
  change?: 'add' | 'modify' | 'delete'
}

export type CanvasElement = {
  /** ASCII id, unique on the map. */
  id: string
  /** Shown name; Korean is fine. Defaults to the id. */
  label?: string
  kind?: ElementKind
  /** A group's id: the element is drawn inside that group. */
  parent?: string
  change?: Change
  members?: CanvasMember[]
  note?: string
  /** Repo-relative files this element stands for. */
  files?: string[]
  /**
   * The decision that shaped this part and the option it belongs to (no option: it stands whichever
   * way the decision goes). Drawn dashed while the decision is open; the tag stays once it is made,
   * so the map keeps showing what each choice shaped. The decision's own `chosen` says open or made.
   */
  decision?: string
  option?: string
}

export type CanvasRelation = {
  from: string
  to: string
  kind?: RelationKind
  label?: string
  /** A step number: drawn as ①②③ in front of the label, to show the order of a flow. */
  step?: number
  change?: 'add' | 'delete'
  /** As on an element: the decision that shaped this line, and its option. */
  decision?: string
  option?: string
}

export type MessageKind = 'call' | 'reply' | 'async' | 'note'

export type CanvasMessage = {
  id: string
  from: string
  to?: string
  kind?: MessageKind
  label?: string
  change?: Change
  decision?: string
  option?: string
}

export type FragmentKind = 'alt' | 'opt' | 'loop' | 'par' | 'section'

export type CanvasFragment = {
  id: string
  kind: FragmentKind
  label?: string
  /** First and last message ids inside the frame (inclusive). */
  first: string
  last: string
  branches?: { at: string; label?: string }[]
}

export type CanvasDecisionOption = {
  id: string
  text: string
  impact?: string
  /** Why this option lost; kept after the choice. */
  rejected?: string
}

export type CanvasDecision = {
  id: string
  question: string
  options: CanvasDecisionOption[]
  /** Set only by the person, never by the agent. */
  chosen?: string
  rationale?: string
}

export type CanvasMap = {
  schema: 1
  diagram: 'class' | 'sequence'
  title: string
  context?: string
  direction?: Direction
  elements: CanvasElement[]
  relations: CanvasRelation[]
  messages?: CanvasMessage[]
  fragments?: CanvasFragment[]
  decisions?: CanvasDecision[]
}

/** One stored version: the map plus who changed it and why. */
export type CanvasRevision = {
  revision: number
  map: CanvasMap
  by: 'agent' | 'person'
  note?: string
  ts: number
}

// ------------------------------------------------------------------ ids and keys

export const ID = /^[A-Za-z][A-Za-z0-9_]*$/
const KINDS: readonly ElementKind[] = ['group', 'class', 'interface', 'enum', 'table', 'resource', 'external', 'actor']
const RELATION_KINDS: readonly RelationKind[] = ['association', 'dependency', 'inheritance', 'realization', 'composition', 'aggregation']
const CHANGES: readonly Change[] = ['keep', 'result', 'modify', 'delete', 'add']
const MESSAGE_KINDS: readonly MessageKind[] = ['call', 'reply', 'async', 'note']
const FRAGMENT_KINDS: readonly FragmentKind[] = ['alt', 'opt', 'loop', 'par', 'section']
const DIRECTIONS: readonly Direction[] = ['TB', 'LR', 'BT', 'RL']

/** Words Mermaid's sequence grammar keeps for itself; a participant id must not be one. */
const SEQUENCE_KEYWORDS = new Set([
  'note', 'end', 'alt', 'else', 'opt', 'loop', 'par', 'and', 'rect', 'box', 'actor', 'participant', 'over',
  'activate', 'deactivate', 'autonumber', 'title', 'critical', 'break', 'option', 'create', 'destroy',
])

export function relationKey(r: { from: string; to: string; kind?: RelationKind }): string {
  return `${r.from}->${r.to}:${r.kind ?? 'association'}`
}

export function emptyMap(diagram: 'class' | 'sequence', title: string): CanvasMap {
  return { schema: 1, diagram, title, elements: [], relations: [], messages: diagram === 'sequence' ? [] : undefined, decisions: [] }
}

/** A map's file reference ("path", "path:12" or "path:12-30") without its lines. */
export function fileOfRef(ref: string): string {
  return ref.replace(/:\d+(-\d+)?$/, '')
}

/** The files a part of the map points at: its own, and for a package everything inside it. */
export function filesUnder(map: CanvasMap, target: string): string[] {
  const out = new Set<string>()
  const visit = (id: string) => {
    for (const ref of map.elements.find(e => e.id === id)?.files ?? []) out.add(fileOfRef(ref))
    for (const c of map.elements) if (c.parent === id) visit(c.id)
  }
  visit(target)
  return [...out]
}

/** Groups (`''` for the top level) whose children changed order: the drawing lays siblings out in map order. */
export function reorderedGroups(a: CanvasMap, b: CanvasMap): string[] {
  const inA = new Set(a.elements.map(e => e.id)), inB = new Set(b.elements.map(e => e.id))
  const seq = (m: CanvasMap, parent: string, keep: Set<string>) => m.elements.filter(e => (e.parent ?? '') === parent && keep.has(e.id)).map(e => e.id).join(' ')
  return [...new Set(b.elements.map(e => e.parent ?? ''))].filter(p => seq(a, p, inB) !== seq(b, p, inA))
}

export function labelOf(map: CanvasMap, target: string): string {
  if (!target) return map.title
  const el = map.elements.find(e => e.id === target)
  if (el) return el.label ?? el.id
  const msg = map.messages?.find(m => m.id === target)
  if (msg) return msg.label ?? msg.id
  const dec = map.decisions?.find(d => d.id === target)
  if (dec) return `${dec.id} ${dec.question}`
  const rel = map.relations.find(r => relationKey(r) === target)
  if (rel) return `${rel.from} → ${rel.to}${rel.label ? ` (${rel.label})` : ''}`
  return target
}

// ------------------------------------------------------------------ validation

export function validate(map: CanvasMap): string[] {
  const errors: string[] = []
  if (map.schema !== 1) errors.push('schema must be 1')
  if (map.diagram !== 'class' && map.diagram !== 'sequence') errors.push('diagram must be class or sequence')
  if (!map.title?.trim()) errors.push('title is required')
  if (map.direction && !DIRECTIONS.includes(map.direction)) errors.push(`direction must be one of ${DIRECTIONS.join(', ')}`)

  const byId = new Map<string, CanvasElement>()
  for (const el of map.elements) {
    if (!ID.test(el.id ?? '')) errors.push(`element id "${el.id}" must be ASCII letters, digits or _ and start with a letter`)
    if (byId.has(el.id)) errors.push(`element id "${el.id}" is used twice`)
    byId.set(el.id, el)
    if (el.kind && !KINDS.includes(el.kind)) errors.push(`${el.id}: kind must be one of ${KINDS.join(', ')}`)
    if (el.change && !CHANGES.includes(el.change)) errors.push(`${el.id}: change must be one of ${CHANGES.join(', ')}`)
    if (el.kind === 'group' && el.members?.length) errors.push(`${el.id}: a group has no members`)
    if (map.diagram === 'sequence' && el.kind === 'group') errors.push(`${el.id}: a sequence map has no groups`)
    if (map.diagram === 'sequence' && SEQUENCE_KEYWORDS.has(el.id.toLowerCase())) errors.push(`${el.id}: Mermaid keeps this word; pick another id`)
  }
  for (const el of map.elements) {
    if (!el.parent) continue
    const parent = byId.get(el.parent)
    if (!parent) errors.push(`${el.id}: parent "${el.parent}" does not exist`)
    else if (parent.kind !== 'group') errors.push(`${el.id}: parent "${el.parent}" is not a group`)
    // A cycle would hang the drawing.
    const seen = new Set<string>([el.id])
    let p: string | undefined = el.parent
    while (p) {
      if (seen.has(p)) { errors.push(`${el.id}: parent chain loops`); break }
      seen.add(p)
      p = byId.get(p)?.parent
    }
  }

  const relKeys = new Set<string>()
  for (const r of map.relations) {
    if (map.diagram === 'sequence') { errors.push('a sequence map has no relations; use messages'); break }
    if (!byId.has(r.from)) errors.push(`relation ${r.from}->${r.to}: "${r.from}" does not exist`)
    if (!byId.has(r.to)) errors.push(`relation ${r.from}->${r.to}: "${r.to}" does not exist`)
    if (r.kind && !RELATION_KINDS.includes(r.kind)) errors.push(`relation ${r.from}->${r.to}: kind must be one of ${RELATION_KINDS.join(', ')}`)
    const key = relationKey(r)
    if (relKeys.has(key)) errors.push(`relation ${key} is listed twice; merge the labels`)
    relKeys.add(key)
  }

  const decisions = new Map((map.decisions ?? []).map(d => [d.id, d]))
  for (const d of map.decisions ?? []) {
    if (!/^D\d+$/.test(d.id)) errors.push(`decision id "${d.id}" must look like D1`)
    if (!d.question?.trim()) errors.push(`${d.id}: question is required`)
    if (!d.options?.length) errors.push(`${d.id}: give at least one option`)
    for (const o of d.options ?? []) if (!o.id?.startsWith(`${d.id}-`)) errors.push(`${d.id}: option id "${o.id}" must start with ${d.id}-`)
    if (d.chosen && !d.options?.some(o => o.id === d.chosen)) errors.push(`${d.id}: chosen "${d.chosen}" is not an option`)
  }
  const checkPath = (what: string, decision?: string, option?: string) => {
    if (!decision && !option) return
    const d = decision ? decisions.get(decision) : undefined
    if (!d) errors.push(`${what}: decision "${decision}" does not exist`)
    else if (option && !d.options.some(o => o.id === option)) errors.push(`${what}: option "${option}" is not in ${d.id}`)
    else if (option && d.chosen && option !== d.chosen) errors.push(`${what}: ${d.id} is decided (${d.chosen}); nothing on the map belongs to the lost option "${option}"`)
  }
  for (const el of map.elements) checkPath(el.id, el.decision, el.option)
  for (const r of map.relations) checkPath(`relation ${r.from}->${r.to}`, r.decision, r.option)

  if (map.diagram === 'sequence') {
    const msgIds = new Set<string>()
    for (const m of map.messages ?? []) {
      if (!ID.test(m.id ?? '')) errors.push(`message id "${m.id}" must be ASCII`)
      if (msgIds.has(m.id) || byId.has(m.id)) errors.push(`message id "${m.id}" is used twice`)
      msgIds.add(m.id)
      if (!byId.has(m.from)) errors.push(`message ${m.id}: "${m.from}" is not a participant`)
      if ((m.kind ?? 'call') !== 'note' && !m.to) errors.push(`message ${m.id}: "to" is required`)
      if (m.to && !byId.has(m.to)) errors.push(`message ${m.id}: "${m.to}" is not a participant`)
      if (m.kind && !MESSAGE_KINDS.includes(m.kind)) errors.push(`message ${m.id}: kind must be one of ${MESSAGE_KINDS.join(', ')}`)
      checkPath(`message ${m.id}`, m.decision, m.option)
    }
    const order = new Map((map.messages ?? []).map((m, i) => [m.id, i]))
    for (const f of map.fragments ?? []) {
      if (!FRAGMENT_KINDS.includes(f.kind)) errors.push(`fragment ${f.id}: kind must be one of ${FRAGMENT_KINDS.join(', ')}`)
      const a = order.get(f.first), b = order.get(f.last)
      if (a === undefined || b === undefined) errors.push(`fragment ${f.id}: first/last must be message ids`)
      else if (a > b) errors.push(`fragment ${f.id}: first comes after last`)
    }
  } else if (map.messages?.length) errors.push('a class map has no messages')
  return errors
}

// ------------------------------------------------------------------ patches

type Nullable<T> = { [K in keyof T]?: T[K] | null }

export type CanvasPatch = {
  title?: string
  context?: string | null
  direction?: Direction | null
  /** `before`/`after` move the element next to a sibling. Top-level groups are drawn in map order (left to right in a row). */
  elements?: ({ id: string; before?: string; after?: string } & Nullable<Omit<CanvasElement, 'id'>>)[]
  relations?: ({ from: string; to: string; kind?: RelationKind; remove?: boolean } & Nullable<Omit<CanvasRelation, 'from' | 'to' | 'kind'>>)[]
  messages?: ({ id: string; after?: string } & Nullable<Omit<CanvasMessage, 'id'>>)[]
  fragments?: ({ id: string } & Nullable<Omit<CanvasFragment, 'id'>>)[]
  decisions?: ({ id: string } & Nullable<Omit<CanvasDecision, 'id'>>)[]
  remove?: { elements?: string[]; messages?: string[]; fragments?: string[]; decisions?: string[] }
}

export type PatchResult = { map: CanvasMap; errors: string[]; notes: string[] }

function merge<T extends object>(base: T | undefined, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...(base ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else if (v !== undefined) out[k] = v
  }
  return out as T
}

/**
 * Applies an agent's (or the person's) patch. Elements, messages and decisions upsert by id;
 * relations upsert by from/to/kind and go with `remove: true`. The agent never sets `chosen`.
 */
export function applyPatch(map: CanvasMap, patch: CanvasPatch, by: 'agent' | 'person'): PatchResult {
  const notes: string[] = []
  const next: CanvasMap = structuredClone(map)
  if (patch.title !== undefined) next.title = patch.title
  if (patch.context !== undefined) next.context = patch.context ?? undefined
  if (patch.direction !== undefined) next.direction = patch.direction ?? undefined

  for (const id of patch.remove?.elements ?? []) {
    const children = next.elements.filter(e => e.parent === id && !(patch.remove?.elements ?? []).includes(e.id))
    if (children.length) {
      notes.push(`${id}: moved ${children.length} child(ren) out of the removed group`)
      for (const c of children) c.parent = next.elements.find(e => e.id === id)?.parent
    }
    const before = next.relations.length
    next.elements = next.elements.filter(e => e.id !== id)
    next.relations = next.relations.filter(r => r.from !== id && r.to !== id)
    if (next.relations.length < before) notes.push(`${id}: removed ${before - next.relations.length} relation(s) with it`)
  }
  for (const id of patch.remove?.messages ?? []) next.messages = (next.messages ?? []).filter(m => m.id !== id)
  for (const id of patch.remove?.fragments ?? []) next.fragments = (next.fragments ?? []).filter(f => f.id !== id)
  for (const id of patch.remove?.decisions ?? []) next.decisions = (next.decisions ?? []).filter(d => d.id !== id)

  for (const p of patch.elements ?? []) {
    const { before, after, ...el } = p
    const i = next.elements.findIndex(e => e.id === p.id)
    if (i >= 0) next.elements[i] = merge(next.elements[i], el)
    else next.elements.push(merge<CanvasElement>(undefined, el))
    const anchor = before ?? after
    if (!anchor || anchor === p.id) continue
    const at = next.elements.findIndex(e => e.id === p.id)
    const [moved] = next.elements.splice(at, 1)
    const to = next.elements.findIndex(e => e.id === anchor)
    if (to < 0) {
      next.elements.splice(at, 0, moved)
      notes.push(`${p.id}: "${anchor}" is not on the map; order kept`)
      continue
    }
    if ((next.elements[to].parent ?? '') !== (moved.parent ?? '')) notes.push(`${p.id}: "${anchor}" is in another group; only the order among siblings shows on the drawing`)
    next.elements.splice(before ? to : to + 1, 0, moved)
  }
  for (const p of patch.relations ?? []) {
    const { remove, ...rel } = p
    const key = relationKey(rel)
    const i = next.relations.findIndex(r => relationKey(r) === key)
    if (remove) {
      if (i >= 0) next.relations.splice(i, 1)
      else notes.push(`relation ${key} was not on the map`)
    } else if (i >= 0) next.relations[i] = merge(next.relations[i], rel)
    else next.relations.push(merge<CanvasRelation>(undefined, rel))
  }
  for (const p of patch.messages ?? []) {
    const list = (next.messages ??= [])
    const { after, ...msg } = p
    const i = list.findIndex(m => m.id === msg.id)
    if (i >= 0) list[i] = merge(list[i], msg)
    else {
      const at = after ? list.findIndex(m => m.id === after) : -1
      const item = merge<CanvasMessage>(undefined, msg)
      if (after && at < 0) notes.push(`message ${msg.id}: "${after}" not found, added at the end`)
      if (at >= 0) list.splice(at + 1, 0, item)
      else list.push(item)
    }
  }
  for (const p of patch.fragments ?? []) {
    const list = (next.fragments ??= [])
    const i = list.findIndex(f => f.id === p.id)
    if (i >= 0) list[i] = merge(list[i], p)
    else list.push(merge<CanvasFragment>(undefined, p))
  }
  for (const p of patch.decisions ?? []) {
    const list = (next.decisions ??= [])
    const patchCopy: Record<string, unknown> = { ...p }
    if (by === 'agent' && 'chosen' in patchCopy) {
      delete patchCopy.chosen
      notes.push(`${p.id}: only the person chooses; "chosen" was ignored`)
    }
    const i = list.findIndex(d => d.id === p.id)
    if (i >= 0) list[i] = merge(list[i], patchCopy)
    else list.push(merge<CanvasDecision>(undefined, patchCopy))
  }
  return { map: next, errors: validate(next), notes }
}

/**
 * The person picks an option: what belonged to the other options goes, the chosen path keeps its
 * tags (the map shows what the choice shaped), and the losing options keep a note of why they lost.
 */
export function chooseOption(map: CanvasMap, decisionId: string, optionId: string, rationale?: string): CanvasMap {
  const next = structuredClone(map)
  const d = next.decisions?.find(x => x.id === decisionId)
  if (!d) return next
  d.chosen = optionId
  if (rationale) d.rationale = rationale
  const lost = (x: { decision?: string; option?: string }) => x.decision === decisionId && !!x.option && x.option !== optionId
  const removed = new Set(next.elements.filter(lost).map(e => e.id))
  next.elements = next.elements.filter(e => !lost(e))
  next.relations = next.relations.filter(r => !lost(r) && !removed.has(r.from) && !removed.has(r.to))
  if (next.messages) next.messages = next.messages.filter(m => !lost(m))
  return next
}

/** What a decision shaped: the parts tagged with it (one option's share, when given). */
export function shapedBy(map: CanvasMap, decisionId: string, option?: string) {
  const mine = (x: { decision?: string; option?: string }) => x.decision === decisionId && (!option || x.option === option)
  return { elements: map.elements.filter(mine), relations: map.relations.filter(mine), messages: (map.messages ?? []).filter(mine) }
}

/**
 * Maps made by the older design-map plugin wrote the choice into the question
 * ("… → 확정 D2-a. 이유 …") instead of `chosen`. Read those as made choices, so a person
 * is never asked again about what they already decided. Only that explicit line counts: a
 * guess (say, from which options carry a reason they lost) would close a decision the
 * person reopened.
 */
export function normalizeDecisions(map: CanvasMap): CanvasMap {
  if (!map.decisions?.some(d => !d.chosen)) return map
  let changed = false
  const decisions = map.decisions.map(d => {
    if (d.chosen) return d
    const m = /\s*(?:→|->)\s*확정\s+([A-Za-z0-9_]+-[A-Za-z0-9_]+)\.?\s*([\s\S]*)$/.exec(d.question)
    if (m && d.options.some(o => o.id === m[1])) {
      changed = true
      return { ...d, question: d.question.slice(0, m.index).trim(), chosen: m[1], rationale: d.rationale ?? (m[2].trim() || undefined) }
    }
    return d
  })
  return changed ? { ...map, decisions } : map
}

export function reopenDecision(map: CanvasMap, decisionId: string): CanvasMap {
  const next = structuredClone(map)
  const d = next.decisions?.find(x => x.id === decisionId)
  if (d) { delete d.chosen; delete d.rationale }
  return next
}

// ------------------------------------------------------------------ delivery

/** Where a prompt the person sent stands in its live session; `delivered`: a terminal took it and runs it once idle. */
export type PromptState = { state: 'queued'; position: number } | { state: 'delivered' } | { state: 'working' }

/** What became of a canvas message sent to the agent. Worked out on every read, never stored. */
export type Delivery = PromptState | { state: 'answered'; revision?: number } | { state: 'ended' }

type SentItem = { who: 'person' | 'agent'; ts: number; messageId?: string }
type RevisionStamp = Pick<CanvasRevision, 'revision' | 'by' | 'ts'>

/**
 * While its session holds the prompt, a sent item is queued or being worked on. Once the session
 * lets go (the turn ended, or the server restarted), the thread tells: answered when the agent spoke
 * after it, with the last revision the agent made of the map in between; ended otherwise.
 */
export function deliveryOf(items: SentItem[], index: number, live: PromptState | undefined, revisions: () => RevisionStamp[]): Delivery | undefined {
  const item = items[index]
  if (item?.who !== 'person' || !item.messageId) return undefined
  if (live) return live
  const answer = items.slice(index + 1).find(i => i.who === 'agent')
  if (!answer) return { state: 'ended' }
  const made = revisions().filter(r => r.by === 'agent' && r.ts >= item.ts && r.ts <= answer.ts)
  return made.length ? { state: 'answered', revision: Math.max(...made.map(r => r.revision)) } : { state: 'answered' }
}

export function deliveryLabel(d: Delivery): string {
  if (d.state === 'queued') return `대기열 ${d.position}번째`
  if (d.state === 'delivered') return '터미널에 전달함'
  if (d.state === 'working') return '작업 중'
  if (d.state === 'answered') return d.revision ? `답함 · rev ${d.revision} 반영` : '답함'
  return '끝남 · 답 없음'
}

// ------------------------------------------------------------------ diff between revisions

export type MapDiff = {
  addedElements: Set<string>
  removedElements: Map<string, CanvasElement>
  changedElements: Set<string>
  addedRelations: Set<string>
  removedRelations: Map<string, CanvasRelation>
  changedRelations: Set<string>
  addedMessages: Set<string>
  removedMessages: Map<string, CanvasMessage>
  changedMessages: Set<string>
  fragmentsChanged: Set<string>
  decisionsChanged: Set<string>
  /** Map-level fields: title, context, direction. */
  fieldsChanged: Set<string>
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function diffMaps(before: CanvasMap, after: CanvasMap): MapDiff {
  const d: MapDiff = {
    addedElements: new Set(), removedElements: new Map(), changedElements: new Set(),
    addedRelations: new Set(), removedRelations: new Map(), changedRelations: new Set(),
    addedMessages: new Set(), removedMessages: new Map(), changedMessages: new Set(),
    fragmentsChanged: new Set(), decisionsChanged: new Set(), fieldsChanged: new Set(),
  }
  for (const k of ['title', 'context', 'direction'] as const) if (!same(before[k], after[k])) d.fieldsChanged.add(k)
  const be = new Map(before.elements.map(e => [e.id, e]))
  const ae = new Map(after.elements.map(e => [e.id, e]))
  for (const [id, e] of ae) {
    const old = be.get(id)
    if (!old) d.addedElements.add(id)
    else if (!same(old, e)) d.changedElements.add(id)
  }
  for (const [id, e] of be) if (!ae.has(id)) d.removedElements.set(id, e)
  const br = new Map(before.relations.map(r => [relationKey(r), r]))
  const ar = new Map(after.relations.map(r => [relationKey(r), r]))
  for (const [k, r] of ar) {
    const old = br.get(k)
    if (!old) d.addedRelations.add(k)
    else if (!same(old, r)) d.changedRelations.add(k)
  }
  for (const [k, r] of br) if (!ar.has(k)) d.removedRelations.set(k, r)
  const bm = new Map((before.messages ?? []).map(m => [m.id, m]))
  const am = new Map((after.messages ?? []).map(m => [m.id, m]))
  for (const [id, m] of am) {
    const old = bm.get(id)
    if (!old) d.addedMessages.add(id)
    else if (!same(old, m)) d.changedMessages.add(id)
  }
  for (const [id, m] of bm) if (!am.has(id)) d.removedMessages.set(id, m)
  const bf = new Map((before.fragments ?? []).map(x => [x.id, x]))
  for (const x of after.fragments ?? []) if (!same(bf.get(x.id), x)) d.fragmentsChanged.add(x.id)
  for (const x of before.fragments ?? []) if (!(after.fragments ?? []).some(y => y.id === x.id)) d.fragmentsChanged.add(x.id)
  const bd = new Map((before.decisions ?? []).map(x => [x.id, x]))
  for (const x of after.decisions ?? []) if (!same(bd.get(x.id), x)) d.decisionsChanged.add(x.id)
  for (const x of before.decisions ?? []) if (!(after.decisions ?? []).some(y => y.id === x.id)) d.decisionsChanged.add(x.id)
  return d
}

export function diffSize(d: MapDiff): number {
  return d.addedElements.size + d.removedElements.size + d.changedElements.size + d.addedRelations.size +
    d.removedRelations.size + d.changedRelations.size + d.addedMessages.size + d.removedMessages.size +
    d.changedMessages.size + d.fragmentsChanged.size + d.decisionsChanged.size + d.fieldsChanged.size
}

/** One line per change, for the timeline and for the agent's tool result. */
export function describeDiff(d: MapDiff, after: CanvasMap): string[] {
  const out: string[] = []
  const name = (id: string) => after.elements.find(e => e.id === id)?.label ?? id
  for (const k of d.fieldsChanged) out.push(`~ ${k}`)
  for (const id of d.addedElements) out.push(`+ ${name(id)}`)
  for (const [id, e] of d.removedElements) out.push(`− ${e.label ?? id}`)
  for (const id of d.changedElements) out.push(`~ ${name(id)}`)
  for (const k of d.addedRelations) out.push(`+ ${k.replace(/:.*/, '')}`)
  for (const k of d.removedRelations.keys()) out.push(`− ${k.replace(/:.*/, '')}`)
  for (const k of d.changedRelations) out.push(`~ ${k.replace(/:.*/, '')}`)
  for (const id of d.addedMessages) out.push(`+ message ${id}`)
  for (const id of d.removedMessages.keys()) out.push(`− message ${id}`)
  for (const id of d.changedMessages) out.push(`~ message ${id}`)
  for (const id of d.fragmentsChanged) out.push(`~ fragment ${id}`)
  for (const id of d.decisionsChanged) out.push(`~ ${id}`)
  return out
}

// ------------------------------------------------------------------ Mermaid

/** Mermaid swallows `<...>` as HTML and splits on `:`; keep the look, drop the syntax. */
export function safeText(s: string): string {
  return s
    .replace(/</g, '‹').replace(/>/g, '›')
    .replace(/:/g, '∶')
    .replace(/"/g, '″')
    .replace(/[{}]/g, m => (m === '{' ? '❴' : '❵'))
    .replace(/[$*]\s*$/, m => (m.trim() === '$' ? '＄' : '∗'))
    .replace(/\n/g, ' ')
}

/** Sequence text: `#`, `;` and `%` break the grammar; encode all three in one pass. */
function seqText(s: string): string {
  return safeText(s).replace(/[#;%]/g, m => `#${m.charCodeAt(0)};`)
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
export function stepMark(n: number): string {
  return n >= 1 && n <= 20 ? CIRCLED[n - 1] : `(${n})`
}

const MEMBER_MARK = { add: '＋ ', modify: '✎ ', delete: '－ ' } as const

const ARROWS: Record<RelationKind, string> = {
  association: '-->',
  dependency: '..>',
  inheritance: '--|>',
  realization: '..|>',
  composition: '--*',
  aggregation: '--o',
}

export type RenderPlan = {
  text: string
  /** Mermaid draws edges in the order they are written; this maps that order back to relation keys. */
  edgeOrder: string[]
  /** Elements drawn as ghosts (removed since the compared revision). */
  ghosts: Set<string>
  ghostEdges: Set<string>
  /** Message ids in drawing order (sequence maps). */
  messageOrder: string[]
  noteOrder: string[]
}

export type RenderOptions = {
  collapsed?: Set<string>
  /** Show what an earlier revision had and this one lost. */
  ghostsFrom?: MapDiff
}

/** Mermaid text for a class map, with namespaces for groups and step numbers on relation labels. */
export function toMermaid(map: CanvasMap, opts: RenderOptions = {}): RenderPlan {
  if (map.diagram === 'sequence') return sequenceMermaid(map, opts)
  const collapsed = opts.collapsed ?? new Set<string>()
  const ghosts = new Set<string>()
  const ghostEdges = new Set<string>()
  let elements = map.elements
  let relations = map.relations
  if (opts.ghostsFrom) {
    // Removed things come back as ghosts in their old place, so a vanished line is visible.
    const extraEls = [...opts.ghostsFrom.removedElements.values()].map(e => ({ ...e, parent: e.parent && (map.elements.some(x => x.id === e.parent) || opts.ghostsFrom!.removedElements.has(e.parent)) ? e.parent : undefined }))
    for (const e of extraEls) ghosts.add(e.id)
    elements = [...elements, ...extraEls]
    const ids = new Set(elements.map(e => e.id))
    const extraRels = [...opts.ghostsFrom.removedRelations.values()].filter(r => ids.has(r.from) && ids.has(r.to))
    for (const r of extraRels) ghostEdges.add(relationKey(r))
    relations = [...relations, ...extraRels]
  }
  const byId = new Map(elements.map(e => [e.id, e]))
  // An element inside a collapsed group is drawn as that group.
  const shownAs = (id: string): string => {
    let cur: string | undefined = id
    let shown = id
    while (cur) {
      const el = byId.get(cur)
      if (el?.parent && collapsed.has(el.parent)) shown = el.parent
      cur = el?.parent
    }
    return shown
  }
  const lines: string[] = ['classDiagram', `  direction ${map.direction ?? 'TB'}`]
  const childrenOf = new Map<string, CanvasElement[]>()
  for (const e of elements) {
    const key = e.parent && byId.has(e.parent) ? e.parent : ''
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(e)
  }
  const classLine = (e: CanvasElement, indent: string) => {
    const label = safeText(e.label ?? e.id)
    const body: string[] = []
    if (e.kind && e.kind !== 'class') body.push(`${indent}  <<${e.kind}>>`)
    for (const m of e.members ?? []) body.push(`${indent}  ${safeText((m.change ? MEMBER_MARK[m.change] : '') + m.text)}`)
    if (!body.length) { lines.push(`${indent}class ${e.id}["${label}"]`); return }
    lines.push(`${indent}class ${e.id}["${label}"] {`, ...body, `${indent}}`)
  }
  const emitGroup = (groupId: string, indent: string) => {
    for (const e of childrenOf.get(groupId) ?? []) {
      if (e.kind === 'group') {
        // A collapsed group, or an empty one (Mermaid rejects an empty namespace), is one box.
        if (collapsed.has(e.id) || !childrenOf.get(e.id)?.length) {
          const count = countLeaves(e.id)
          lines.push(`${indent}class ${e.id}["${safeText(e.label ?? e.id)}"] {`)
          lines.push(`${indent}  <<group>>`)
          lines.push(`${indent}  ${count ? `상자 ${count}개` : '비어 있음'}`)
          lines.push(`${indent}}`)
        } else {
          lines.push(`${indent}namespace ${e.id} {`)
          emitGroup(e.id, indent + '  ')
          lines.push(`${indent}}`)
        }
      } else classLine(e, indent)
    }
  }
  const countLeaves = (gid: string): number =>
    (childrenOf.get(gid) ?? []).reduce((n, c) => n + (c.kind === 'group' ? countLeaves(c.id) : 1), 0)
  emitGroup('', '  ')
  const edgeOrder: string[] = []
  const drawn = new Map<string, { from: string; to: string; kind: RelationKind; labels: string[]; keys: string[] }>()
  for (const r of relations) {
    const from = shownAs(r.from), to = shownAs(r.to)
    if (from === to) continue
    const kind = r.kind ?? 'association'
    const k = `${from}|${to}|${kind}`
    const label = [r.step ? stepMark(r.step) : '', r.label ?? ''].join(' ').trim()
    const entry = drawn.get(k) ?? { from, to, kind, labels: [], keys: [] }
    if (label) entry.labels.push(label)
    entry.keys.push(relationKey(r))
    drawn.set(k, entry)
  }
  for (const e of drawn.values()) {
    const label = e.labels.length > 2 ? `${e.labels.slice(0, 2).join(' · ')} 외 ${e.labels.length - 2}건` : e.labels.join(' · ')
    lines.push(`  ${e.from} ${ARROWS[e.kind]} ${e.to}${label ? ` : ${safeText(label)}` : ''}`)
    edgeOrder.push(e.keys.join(' '))
  }
  return { text: lines.join('\n'), edgeOrder, ghosts, ghostEdges, messageOrder: [], noteOrder: [] }
}

function sequenceMermaid(map: CanvasMap, opts: RenderOptions): RenderPlan {
  const lines = ['sequenceDiagram']
  const ghosts = new Set<string>()
  for (const e of map.elements) {
    const word = e.kind === 'actor' ? 'actor' : 'participant'
    lines.push(`  ${word} ${e.id} as ${seqText(e.label ?? e.id)}`)
  }
  let messages = map.messages ?? []
  if (opts.ghostsFrom?.removedMessages.size) {
    // Ghost messages go back right after the message that preceded them before.
    messages = [...messages]
    for (const [id, m] of opts.ghostsFrom.removedMessages) {
      ghosts.add(id)
      messages.push(m)
    }
  }
  const starts = new Map<string, CanvasFragment[]>()
  const ends = new Map<string, CanvasFragment[]>()
  const branchAt = new Map<string, { frag: CanvasFragment; label?: string }>()
  for (const f of map.fragments ?? []) {
    starts.set(f.first, [...(starts.get(f.first) ?? []), f])
    ends.set(f.last, [f, ...(ends.get(f.last) ?? [])])
    for (const b of f.branches ?? []) branchAt.set(b.at, { frag: f, label: b.label })
  }
  const messageOrder: string[] = []
  const noteOrder: string[] = []
  for (const m of messages) {
    for (const f of starts.get(m.id) ?? []) {
      if (f.kind === 'section') lines.push(`  rect rgba(127,127,127,0.08)`, `  Note over ${firstParticipant(map)}: ${seqText(f.label ?? '')}`)
      else lines.push(`  ${f.kind} ${seqText(f.label ?? '')}`)
      if (f.kind === 'section') noteOrder.push(`frag:${f.id}`)
    }
    const br = branchAt.get(m.id)
    if (br) lines.push(`  ${br.frag.kind === 'par' ? 'and' : 'else'} ${seqText(br.label ?? '')}`)
    const label = seqText(m.label ?? '')
    if ((m.kind ?? 'call') === 'note') {
      lines.push(`  Note over ${m.from}${m.to && m.to !== m.from ? `,${m.to}` : ''}: ${label}`)
      noteOrder.push(m.id)
    } else {
      const arrow = m.kind === 'reply' ? '-->>' : m.kind === 'async' ? '-)' : '->>'
      lines.push(`  ${m.from}${arrow}${m.to}: ${label || ' '}`)
      messageOrder.push(m.id)
    }
    for (const f of ends.get(m.id) ?? []) lines.push(f.kind === 'section' ? '  end' : '  end')
  }
  return { text: lines.join('\n'), edgeOrder: [], ghosts, ghostEdges: new Set(), messageOrder, noteOrder }
}

function firstParticipant(map: CanvasMap): string {
  return map.elements[0]?.id ?? 'A'
}

/** Plain Mermaid for export (wiki, PR): same drawing, no screen-only ghosts. */
export function exportMermaid(map: CanvasMap): string {
  return toMermaid(map).text
}
