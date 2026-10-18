import { afterEach, describe, expect, it, vi } from 'vitest'
import { Terminals, workspaceFor } from '../server/terminals.ts'

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
