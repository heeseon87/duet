import { existsSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyPatch, chooseOption, describeDiff, diffMaps, emptyMap, labelOf, reopenDecision, reorderedGroups, validate,
  type CanvasMap, type CanvasPatch, type CanvasRevision,
  normalizeDecisions,
} from '../../shared/canvas.ts'
import type { CanvasSummary, CanvasThread, MapCode } from '../../shared/protocol.ts'
import { appendJsonl, DUET_HOME, ensureDir, HttpError, newId, readJson, readJsonl, slugOf, writeJson } from '../util.ts'

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/

type Current = { revision: number; map: CanvasMap; updated: number; code?: MapCode }

export type ChangeListener = (workspace: string, name: string, revision: number, by: 'agent' | 'person') => void
export type ListListener = (workspace: string) => void

/** Canvas maps of one workspace: current map, every revision, and the threads pinned to it. */
export class CanvasStore {
  constructor(private onChange: ChangeListener, private onList: ListListener) {}

  private dir(workspace: string): string {
    return ensureDir(join(DUET_HOME, 'canvas', slugOf(workspace)))
  }

  private file(workspace: string, name: string, ext: string): string {
    if (!NAME.test(name)) throw new HttpError(400, `지도 이름은 소문자·숫자·-·_만 쓸 수 있어: ${name}`)
    return join(this.dir(workspace), `${name}.${ext}`)
  }

  list(workspace: string): CanvasSummary[] {
    const dir = this.dir(workspace)
    const out: CanvasSummary[] = []
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.map.json')) continue
      const name = f.slice(0, -'.map.json'.length)
      const cur = readJson<Current | null>(join(dir, f), null)
      if (!cur) continue
      const threads = this.threads(workspace, name)
      const decisions = normalizeDecisions(cur.map).decisions ?? []
      out.push({
        name,
        title: cur.map.title,
        diagram: cur.map.diagram,
        revision: cur.revision,
        updated: cur.updated ?? statSync(join(dir, f)).mtimeMs,
        elements: cur.map.elements.filter(e => e.kind !== 'group').length + (cur.map.messages?.length ?? 0),
        decisions: decisions.length,
        openDecisions: decisions.filter(d => !d.chosen).length,
        openThreads: threads.filter(t => t.state === 'open').length,
        ...(cur.code ? { code: cur.code } : {}),
      })
    }
    return out.sort((a, b) => b.updated - a.updated)
  }

  exists(workspace: string, name: string): boolean {
    return existsSync(this.file(workspace, name, 'map.json'))
  }

  get(workspace: string, name: string): Current {
    const cur = readJson<Current | null>(this.file(workspace, name, 'map.json'), null)
    if (!cur) throw new HttpError(404, `${name} 지도가 없어`)
    return { ...cur, map: normalizeDecisions(cur.map) }
  }

  history(workspace: string, name: string): CanvasRevision[] {
    return readJsonl<CanvasRevision>(this.file(workspace, name, 'history.jsonl'))
  }

  revision(workspace: string, name: string, revision: number): CanvasRevision {
    const rev = this.history(workspace, name).find(r => r.revision === revision)
    if (!rev) throw new HttpError(404, `rev ${revision} 기록이 없어`)
    return { ...rev, map: normalizeDecisions(rev.map) }
  }

  create(workspace: string, name: string, diagram: 'class' | 'sequence', title: string, context: string | undefined, by: 'agent' | 'person', note = '새 지도', code?: MapCode): Current {
    if (this.exists(workspace, name)) throw new HttpError(409, `${name} 지도가 이미 있어`)
    const map = emptyMap(diagram, title)
    if (context) map.context = context
    const cur = this.write(workspace, name, map, 1, by, note, code)
    this.onList(workspace)
    return cur
  }

  /** Binds the map to other code (or to none); the map and its revisions stay as they are. */
  setCode(workspace: string, name: string, code: MapCode | undefined): Current {
    const cur = this.get(workspace, name)
    const raw = readJson<Current>(this.file(workspace, name, 'map.json'), cur)
    const { code: _old, ...rest } = raw
    const next: Current = { ...rest, updated: Date.now(), ...(code ? { code } : {}) }
    writeJson(this.file(workspace, name, 'map.json'), next)
    this.onChange(workspace, name, cur.revision, 'person')
    this.onList(workspace)
    return { ...next, map: cur.map }
  }

  /** A new revision keeps the code the map is bound to. */
  private write(workspace: string, name: string, map: CanvasMap, revision: number, by: 'agent' | 'person', note?: string,
    code = readJson<Current | null>(this.file(workspace, name, 'map.json'), null)?.code): Current {
    const cur: Current = { revision, map, updated: Date.now(), ...(code ? { code } : {}) }
    appendJsonl(this.file(workspace, name, 'history.jsonl'), { revision, map, by, note, ts: cur.updated } satisfies CanvasRevision)
    writeJson(this.file(workspace, name, 'map.json'), cur)
    this.onChange(workspace, name, revision, by)
    return cur
  }

  /** Applies a patch; nothing is written when the result does not validate. */
  update(workspace: string, name: string, patch: CanvasPatch, by: 'agent' | 'person', note?: string, baseRevision?: number):
    { ok: true; revision: number; changes: string[]; notes: string[] } | { ok: false; errors: string[]; notes: string[]; revision: number } {
    const cur = this.get(workspace, name)
    const notes: string[] = []
    if (baseRevision !== undefined && baseRevision !== cur.revision) notes.push(`rev ${baseRevision} 기준이었지만 최신 rev ${cur.revision}에 적용했어.`)
    const res = applyPatch(cur.map, patch, by)
    notes.push(...res.notes)
    if (res.errors.length) return { ok: false, errors: res.errors, notes, revision: cur.revision }
    const changes = [
      ...describeDiff(diffMaps(cur.map, res.map), res.map),
      ...reorderedGroups(cur.map, res.map).map(g => `${g ? labelOf(res.map, g) : '맨 위'} 안의 배치 순서`),
    ]
    if (!changes.length) return { ok: true, revision: cur.revision, changes, notes: [...notes, '바뀐 것이 없어서 새 rev를 만들지 않았어'] }
    const next = this.write(workspace, name, res.map, cur.revision + 1, by, note)
    return { ok: true, revision: next.revision, changes, notes }
  }

  choose(workspace: string, name: string, decisionId: string, optionId: string | null, rationale?: string): Current {
    const cur = this.get(workspace, name)
    const d = cur.map.decisions?.find(x => x.id === decisionId)
    if (!d) throw new HttpError(404, `${decisionId}가 없어`)
    let map: CanvasMap
    let note: string
    if (optionId === null) {
      map = reopenDecision(cur.map, decisionId)
      note = `${decisionId} 다시 엶`
    } else {
      if (!d.options.some(o => o.id === optionId)) throw new HttpError(400, `${optionId}는 ${decisionId}의 선택지가 아니야`)
      map = chooseOption(cur.map, decisionId, optionId, rationale)
      note = `${decisionId} → ${optionId}`
    }
    const errors = validate(map)
    if (errors.length) throw new HttpError(400, errors.join('\n'))
    return this.write(workspace, name, map, cur.revision + 1, 'person', note)
  }

  restore(workspace: string, name: string, revision: number): Current {
    const cur = this.get(workspace, name)
    const old = this.revision(workspace, name, revision)
    return this.write(workspace, name, old.map, cur.revision + 1, 'person', `rev ${revision} 복원`)
  }

  remove(workspace: string, name: string): void {
    const trash = ensureDir(join(DUET_HOME, 'trash', slugOf(workspace)))
    const stamp = Date.now()
    for (const ext of ['map.json', 'history.jsonl', 'threads.json']) {
      const f = this.file(workspace, name, ext)
      if (existsSync(f)) renameSync(f, join(trash, `${name}.${stamp}.${ext}`))
    }
    this.onList(workspace)
  }

  // ---------------------------------------------------------------- threads

  threads(workspace: string, name: string): CanvasThread[] {
    return readJson<CanvasThread[]>(this.file(workspace, name, 'threads.json'), [])
  }

  addThreadItem(workspace: string, name: string, args: { threadId?: string; target: string; who: 'person' | 'agent'; text: string; sessionId?: string; terminal?: string; messageId?: string }): CanvasThread {
    const all = this.threads(workspace, name)
    const cur = this.get(workspace, name)
    let thread = args.threadId ? all.find(t => t.id === args.threadId) : undefined
    if (!thread) {
      thread = { id: newId('t'), target: args.target, targetLabel: labelOf(cur.map, args.target), revision: cur.revision, state: 'open', items: [], created: Date.now() }
      all.push(thread)
    }
    thread.items.push({ id: newId('i'), who: args.who, text: args.text, ts: Date.now(), sessionId: args.sessionId, terminal: args.terminal, messageId: args.messageId })
    thread.state = 'open'
    writeJson(this.file(workspace, name, 'threads.json'), all)
    this.onChange(workspace, name, cur.revision, args.who)
    return thread
  }

  setThreadState(workspace: string, name: string, threadId: string, state: 'open' | 'resolved'): void {
    const all = this.threads(workspace, name)
    const t = all.find(x => x.id === threadId)
    if (!t) throw new HttpError(404, 'thread not found')
    t.state = state
    writeJson(this.file(workspace, name, 'threads.json'), all)
    this.onChange(workspace, name, this.get(workspace, name).revision, 'person')
  }
}
