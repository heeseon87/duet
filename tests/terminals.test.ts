import { afterEach, describe, expect, it, vi } from 'vitest'
import { Terminals, workspaceFor } from '../server/terminals.ts'
import { sendingTo, targetTerminal } from '../web/src/terminalTarget.ts'
import type { TerminalInfo } from '../shared/protocol.ts'

describe('workspaceFor', () => {
  const ws = (path: string, reaches: string[] = []) => ({ path, reaches })

  it('puts a folder in the deepest open workspace that holds it', () => {
    expect(workspaceFor('/h/am/worktrees/FEAT-42', '/h/am/worktrees/FEAT-42', [ws('/h/am')])).toBe('/h/am')
    expect(workspaceFor('/h/am/worktrees/x/src', '/h/am/worktrees/x', [ws('/h/am'), ws('/h/am/worktrees/x')])).toBe('/h/am/worktrees/x')
    expect(workspaceFor('/h/am', '/h/am', [ws('/h/am')])).toBe('/h/am')
  })

  it('does not take a folder that only shares the name\'s start', () => {
    expect(workspaceFor('/h/am2', '/h/am2', [ws('/h/am')])).toBeUndefined()
  })

  it('finds a repo outside every workspace through the conversations that wrote in it or the maps that point into it', () => {
    expect(workspaceFor('/h/other/sub', '/h/other', [ws('/h/am'), ws('/h/side', ['/h/other'])])).toBe('/h/side')
    expect(workspaceFor('/h/other', '/h/other', [ws('/h/am', ['/h/other/src/A.kt'])])).toBe('/h/am')
    expect(workspaceFor('/h/lone', '/h/lone', [ws('/h/am', ['/h/other'])])).toBeUndefined()
    expect(workspaceFor('/tmp', undefined, [ws('/h/am', ['/tmp/x/src/A.kt'])])).toBeUndefined()
  })
})

describe('Terminals', () => {
  afterEach(() => { vi.useRealTimers() })
  const make = () => {
    const t = new Terminals(() => undefined)
    t.register({ id: 'term-0001', workspace: '/w', cwd: '/w/worktrees/feat', label: 'feat · term-000' })
    return t
  }
  const never = () => undefined

  it('hands over one message at a time, and the rest wait in order', async () => {
    const t = make()
    t.send('term-0001', 'first', 'm1')
    t.send('term-0001', 'second', 'm2')
    expect(t.promptState('term-0001', 'm2')).toEqual({ state: 'queued', position: 2 })
    expect((await t.poll('term-0001', 10, never)).message?.text).toBe('first')
    expect(t.promptState('term-0001', 'm1')).toEqual({ state: 'delivered' })
    expect(t.promptState('term-0001', 'm2')).toEqual({ state: 'queued', position: 1 })
    expect((await t.poll('term-0001', 10, never)).message).toBeUndefined()
    t.working('term-0001', 'm1')
    expect(t.promptState('term-0001', 'm1')).toEqual({ state: 'working' })
    t.release('term-0001', 'm1')
    expect(t.promptState('term-0001', 'm1')).toBeUndefined()
    expect((await t.poll('term-0001', 10, never)).message?.text).toBe('second')
  })

  it('counts every message a terminal has not finished, for the launcher to wait on', async () => {
    const t = make()
    expect(t.pending()).toBe(0)
    t.send('term-0001', 'first', 'm1')
    t.send('term-0001', 'second', 'm2')
    await t.poll('term-0001', 10, never)
    t.working('term-0001', 'm1')
    expect(t.pending()).toBe(2)
    t.release('term-0001', 'm1')
    expect(t.pending()).toBe(1)
    t.remove('term-0001')
    expect(t.pending()).toBe(0)
  })

  it('wakes a waiting poll when a message comes or a map of its workspace changes', async () => {
    const t = make()
    const waiting = t.poll('term-0001', 5_000, never)
    t.send('term-0001', 'hello', 'm1')
    expect((await waiting).message?.id).toBe('m1')
    const next = t.poll('term-0001', 5_000, never)
    t.canvasChanged('/elsewhere')
    t.canvasChanged('/w')
    expect(await next).toEqual({ canvas: true })
  })

  it('tells a reloaded mod what it holds', async () => {
    const t = make()
    t.send('term-0001', 'hello', 'm1')
    await t.poll('term-0001', 10, never)
    expect(t.register({ id: 'term-0001', workspace: '/w', cwd: '/w', label: 'x' }).holding?.id).toBe('m1')
  })

  it('works while a main turn runs there, by the mod\'s turn reports', () => {
    const t = make()
    expect(t.list('/w')[0]?.status).toBe('idle')
    t.recordTurn('term-0001', 'start')
    expect(t.list('/w')[0]?.status).toBe('working')
    // A reloaded mod that leaves the turn out keeps the status; one that says it is reported.
    t.register({ id: 'term-0001', workspace: '/w', cwd: '/w', label: 'x' })
    expect(t.list('/w')[0]?.status).toBe('working')
    t.recordTurn('term-0001', 'end')
    expect(t.list('/w')[0]?.status).toBe('idle')
    t.register({ id: 'term-0001', workspace: '/w', cwd: '/w', label: 'x', isWorking: true })
    expect(t.list('/w')[0]?.status).toBe('working')
    expect(() => t.recordTurn('term-gone', 'start')).toThrow(/닫혔어/)
  })

  it('tells the browser only when the status changes', () => {
    let changes = 0
    const t = new Terminals(() => { changes++ })
    t.register({ id: 'term-0001', workspace: '/w', cwd: '/w', label: 'x' })
    const before = changes
    t.recordTurn('term-0001', 'start')
    t.recordTurn('term-0001', 'start')
    expect(changes - before).toBe(1)
  })

  it('lists the map a terminal pinned, until it registers without one', () => {
    const t = make()
    t.register({ id: 'term-0001', workspace: '/w', cwd: '/w/worktrees/feat', label: 'feat · term-000', map: 'swing' })
    expect(t.list('/w')[0]?.map).toBe('swing')
    t.register({ id: 'term-0001', workspace: '/w', cwd: '/w/worktrees/feat', label: 'feat · term-000' })
    expect(t.list('/w')[0]?.map).toBeUndefined()
  })

  it('refuses a terminal that closed, and forgets what it held', () => {
    const t = make()
    t.send('term-0001', 'hello', 'm1')
    t.remove('term-0001')
    expect(() => t.send('term-0001', 'again', 'm2')).toThrow('닫혔어')
    expect(t.promptState('term-0001', 'm1')).toBeUndefined()
    expect(t.list()).toEqual([])
  })

  it('drops a terminal whose open poll was cut off and that does not come back', async () => {
    vi.useFakeTimers()
    const t = make()
    let cut: () => void = () => undefined
    void t.poll('term-0001', 20_000, fn => { cut = fn })
    cut()
    await vi.advanceTimersByTimeAsync(3_100)
    expect(t.list()).toEqual([])
  })
})

describe('targetTerminal', () => {
  const term = (id: string): TerminalInfo => ({ id, workspace: '/w', cwd: '/w', label: id, lastSeen: 0, status: 'idle' })

  it('sends to the picked terminal while it lives, else to the only one live', () => {
    expect(targetTerminal({ terminals: [term('a'), term('b')], currentTerminal: 'b' })).toBe('b')
    expect(targetTerminal({ terminals: [term('a')] })).toBe('a')
    expect(targetTerminal({ terminals: [term('a')], currentTerminal: 'gone' })).toBe('a')
  })

  it('picks none among several, and keeps a closed pick when no other is alone, so the send fails out loud', () => {
    expect(targetTerminal({ terminals: [term('a'), term('b')] })).toBeUndefined()
    expect(targetTerminal({ terminals: [term('a'), term('b')], currentTerminal: 'gone' })).toBe('gone')
    expect(targetTerminal({ terminals: [], currentTerminal: 'gone' })).toBe('gone')
    expect(targetTerminal({ terminals: [] })).toBeUndefined()
  })
  it('refuses to send with no terminal, and says how to get one', () => {
    expect(sendingTo({ terminals: [term('a')] })).toEqual({ terminal: 'a' })
    expect(sendingTo({ terminals: [] })).toEqual({ refused: expect.stringContaining('/duet') })
    expect(sendingTo({ terminals: [term('a'), term('b')] })).toEqual({ refused: expect.stringContaining('골라') })
  })
})
