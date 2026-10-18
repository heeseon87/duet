import type { PromptState } from '../shared/canvas.ts'
import type { TerminalInfo } from '../shared/protocol.ts'
import { HttpError } from './util.ts'

/** A message on its way to a terminal: waiting here, handed over (the terminal runs it once idle), or being worked on. */
export type Outgoing = { id: string; text: string; state: 'queued' | 'delivered' | 'working' }

/** What one poll brings back: the next message for a terminal with nothing in hand, or that the workspace's maps changed. */
export type Poll = { message?: Outgoing; canvas?: true }

/** A terminal that stops polling is gone after this long; one whose poll was cut off mid-wait, after GRACE_MS. */
const GONE_MS = 45_000
const GRACE_MS = 3_000

type Entry = { info: TerminalInfo; out: Outgoing[]; canvas: boolean; wake?: () => void }

const under = (path: string, root: string) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)

/**
 * The open workspace a folder belongs to: the deepest workspace that holds it, else the first whose
 * conversations wrote in, or whose maps point into, the repo the folder is in. A folder in no repo
 * and no workspace belongs nowhere, whatever was written under it.
 */
export function workspaceFor(path: string, repo: string | undefined, workspaces: { path: string; reaches: string[] }[]): string | undefined {
  const holding = workspaces.filter(w => under(path, w.path)).sort((a, b) => b.path.length - a.path.length)[0]
  if (holding) return holding.path
  if (!repo) return undefined
  return workspaces.find(w => w.reaches.some(r => under(r, repo)))?.path
}

/**
 * Claude Code sessions in terminals that run the Duet mod. Each polls: the poll is its heartbeat, its
 * inbox and its wake-up when a map changes. Messages wait here until the terminal has nothing in hand.
 */
export class Terminals {
  private all = new Map<string, Entry>()

  constructor(private changed: () => void) {
    setInterval(() => {
      for (const [id, e] of this.all) if (!e.wake && Date.now() - e.info.lastSeen > GONE_MS) this.remove(id)
    }, 5_000).unref()
  }

  list(workspace?: string): TerminalInfo[] {
    return [...this.all.values()].map(e => e.info).filter(i => !workspace || i.workspace === workspace).sort((a, b) => a.label.localeCompare(b.label))
  }

  /** A reloaded mod registers again and learns which message it already holds. */
  register(info: Omit<TerminalInfo, 'lastSeen'>): { holding?: Outgoing } {
    const e = this.all.get(info.id)
    if (e) e.info = { ...info, lastSeen: Date.now() }
    else this.all.set(info.id, { info: { ...info, lastSeen: Date.now() }, out: [], canvas: false })
    this.changed()
    return { holding: e?.out.find(m => m.state !== 'queued') }
  }

  remove(id: string) {
    const e = this.all.get(id)
    if (!e) return
    this.all.delete(id)
    e.out = []
    e.wake?.()
    this.changed()
  }

  /** The live terminal; one that closed is refused by name, so nothing sent to it is lost quietly. */
  get(id: string): TerminalInfo {
    return this.entry(id).info
  }

  private entry(id: string): Entry {
    const e = this.all.get(id)
    if (!e) throw new HttpError(410, '그 터미널은 닫혔어. 다른 대화나 터미널을 골라 줘.')
    return e
  }

  send(id: string, text: string, messageId: string) {
    const e = this.entry(id)
    e.out.push({ id: messageId, text, state: 'queued' })
    this.changed()
    e.wake?.()
  }

  /** Answers at once when there is something to hand over, else when something arrives or `waitMs` passes. */
  poll(id: string, waitMs: number, onClose: (fn: () => void) => void): Promise<Poll> {
    const e = this.all.get(id)
    if (!e) throw new HttpError(404, '등록되지 않은 터미널이야')
    e.info.lastSeen = Date.now()
    this.changed()
    const take = (): Poll | undefined => {
      const next = e.out.every(m => m.state === 'queued') ? e.out[0] : undefined
      if (next) {
        next.state = 'delivered'
        this.changed()
        return { message: next }
      }
      if (e.canvas) {
        e.canvas = false
        return { canvas: true }
      }
      return undefined
    }
    const ready = take()
    if (ready) return Promise.resolve(ready)
    return new Promise(resolve => {
      const done = (p: Poll) => {
        clearTimeout(timer)
        if (e.wake === wake) e.wake = undefined
        e.info.lastSeen = Date.now()
        resolve(p)
      }
      const wake = () => done(take() ?? {})
      const timer = setTimeout(() => done({}), waitMs)
      e.wake = wake
      onClose(() => {
        if (e.wake !== wake) return
        clearTimeout(timer)
        e.wake = undefined
        const at = Date.now()
        // A mod that died takes its open poll with it; a live one polls again at once.
        setTimeout(() => { if (this.all.get(id) === e && !e.wake && e.info.lastSeen <= at) this.remove(id) }, GRACE_MS)
      })
    })
  }

  working(id: string, messageId: string) {
    const m = this.entry(id).out.find(x => x.id === messageId)
    if (!m) return
    m.state = 'working'
    this.changed()
  }

  /** The terminal let go of a message: its turn answered it, or was cut off. */
  release(id: string, messageId: string) {
    const e = this.entry(id)
    e.out = e.out.filter(m => m.id !== messageId)
    this.changed()
    e.wake?.()
  }

  promptState(id: string, messageId: string): PromptState | undefined {
    const out = this.all.get(id)?.out ?? []
    const m = out.find(x => x.id === messageId)
    if (!m) return undefined
    if (m.state === 'queued') return { state: 'queued', position: out.filter(x => x.state === 'queued').indexOf(m) + 1 }
    return { state: m.state }
  }

  canvasChanged(workspace: string) {
    for (const e of this.all.values()) {
      if (e.info.workspace !== workspace) continue
      e.canvas = true
      e.wake?.()
    }
  }
}
