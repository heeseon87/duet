import type { PromptState } from '../shared/canvas.ts'
import type { TerminalActivity, TerminalInfo } from '../shared/protocol.ts'
import { HttpError } from './util.ts'

/** A message on its way to a terminal: waiting here, handed over (the terminal runs it once idle), or being worked on. */
export type Outgoing = { id: string; text: string; state: 'queued' | 'delivered' | 'working' }

/** A side question: the terminal answers it from a fork of its conversation at once, beside whatever it is doing. */
export type Ask = { id: string; prompt: string }

/**
 * What one poll brings back: the next message for a terminal with nothing in hand, or that the workspace's maps
 * changed; and a side question not handed over yet, whatever the terminal holds.
 */
export type Poll = { message?: Outgoing; ask?: Ask; canvas?: true }

/** A terminal that stops polling is gone after this long; one whose poll was cut off mid-wait, after GRACE_MS. */
const GONE_MS = 45_000
const GRACE_MS = 3_000
/** A side question its terminal has not answered by then is dropped (the mod died, or the fork hung): its thread reads as ended. */
export const ASK_MS = 120_000

/** `canAsk`: the terminal's mod said it answers side questions (an older mod does not, and a question to it would hang). */
type Entry = { info: TerminalInfo; out: Outgoing[]; asks: (Ask & { at: number; isHanded: boolean })[]; canAsk: boolean; canvas: boolean; wake?: () => void }

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
      for (const [id, e] of this.all) {
        if (!e.wake && Date.now() - e.info.lastSeen > GONE_MS) this.remove(id)
        else e.asks = e.asks.filter(a => Date.now() - a.at < ASK_MS)
      }
    }, 5_000).unref()
  }

  list(workspace?: string): TerminalInfo[] {
    return [...this.all.values()].map(e => e.info).filter(i => !workspace || i.workspace === workspace).sort((a, b) => a.label.localeCompare(b.label))
  }

  /**
   * A reloaded mod registers again and learns which message it already holds. `isWorking`: a turn is running
   * there now (a mod older than turn reports leaves it out, and the status stands).
   */
  register({ isWorking, canAsk = false, ...info }: Omit<TerminalInfo, 'lastSeen' | 'status' | 'activity'> & { isWorking?: boolean; canAsk?: boolean }): { holding?: Outgoing } {
    const e = this.all.get(info.id)
    const status = isWorking === undefined ? e?.info.status ?? 'idle' : isWorking ? 'working' : 'idle'
    // A pin set again, or a mod come back from a lost poll, has not said anything new.
    if (e) {
      e.info = { ...info, lastSeen: Date.now(), status, activity: e.info.activity }
      e.canAsk = canAsk
    } else this.all.set(info.id, { info: { ...info, lastSeen: Date.now(), status }, out: [], asks: [], canAsk, canvas: false })
    this.changed()
    return { holding: e?.out.find(m => m.state !== 'queued') }
  }

  remove(id: string) {
    const e = this.all.get(id)
    if (!e) return
    this.all.delete(id)
    e.out = []
    e.asks = []
    e.wake?.()
    this.changed()
  }

  /** Messages sent to a terminal that its turn has not finished yet: `duet` waits for none before restarting the server. */
  pending(): number {
    let n = 0
    for (const e of this.all.values()) n += e.out.length + e.asks.length
    return n
  }

  /** The live terminal; one that closed is refused by name, so nothing sent to it is lost quietly. */
  get(id: string): TerminalInfo {
    return this.entry(id).info
  }

  private entry(id: string): Entry {
    const e = this.all.get(id)
    if (!e) throw new HttpError(410, '그 터미널은 닫혔어. 다른 터미널을 골라 줘.')
    return e
  }

  /** Whether the terminal's mod answers side questions. */
  canAsk(id: string): boolean {
    return this.entry(id).canAsk
  }

  /** A side question goes out with the next poll, even while the terminal holds a message. */
  ask(id: string, ask: Ask) {
    const e = this.entry(id)
    e.asks.push({ ...ask, at: Date.now(), isHanded: false })
    e.wake?.()
  }

  /** The terminal answered a side question (or could not): it is no longer waited for. */
  answered(id: string, askId: string) {
    const e = this.entry(id)
    e.asks = e.asks.filter(a => a.id !== askId)
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
      const waiting = e.asks.find(a => !a.isHanded)
      if (waiting) waiting.isHanded = true
      const ask = waiting ? { ask: { id: waiting.id, prompt: waiting.prompt } } : {}
      const next = e.out.every(m => m.state === 'queued') ? e.out[0] : undefined
      if (next) {
        next.state = 'delivered'
        this.changed()
        return { ...ask, message: next }
      }
      if (e.canvas) {
        e.canvas = false
        return { ...ask, canvas: true }
      }
      return waiting ? ask : undefined
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

  /** The mod reports each main turn's start and end, the person's own too: the rail shows whether the terminal works. */
  recordTurn(id: string, edge: 'start' | 'end') {
    const e = this.entry(id)
    const status = edge === 'start' ? 'working' : 'idle'
    // A turn that ended waits on nothing, even when an Esc cut the wait before the mod could say so.
    const was = e.info.activity
    const activity = edge === 'end' && was?.waiting ? (was.said === undefined ? undefined : { said: was.said, at: Date.now() }) : was
    if (e.info.status === status && activity === was) return
    e.info = { ...e.info, status, activity }
    this.changed()
  }

  /** The mod's report of what the terminal does: its last words, and what it waits on the person for. */
  recordActivity(id: string, { said, waiting }: Omit<TerminalActivity, 'at'>) {
    const e = this.entry(id)
    const was = e.info.activity
    if (was?.said === said && was?.waiting?.kind === waiting?.kind && was?.waiting?.text === waiting?.text) return
    e.info = { ...e.info, activity: said === undefined && waiting === undefined ? undefined : { said, waiting, at: Date.now() } }
    this.changed()
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
    if (this.all.get(id)?.asks.some(a => a.id === messageId)) return { state: 'asking' }
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
