import { describe, expect, it } from 'vitest'
import { focusTurns } from '../web/src/agent/focusModel.ts'
import type { Block } from '../web/src/agent/transcript.ts'

let n = 0
const user = (text: string, queued = false): Block => ({ kind: 'user', key: `k${++n}`, rev: 0, id: `u${n}`, text, ts: 0, queued })
const text = (t: string, streaming = false): Block => ({ kind: 'text', key: `k${++n}`, rev: 0, text: t, streaming })
const think = (): Block => ({ kind: 'thinking', key: `k${++n}`, rev: 0, text: '...', streaming: false, started: 0 })
const tool = (name: string, extra: Partial<Extract<Block, { kind: 'tool' }>> = {}): Block => ({ kind: 'tool', key: `k${++n}`, rev: 0, id: `t${n}`, name, inputText: '', state: 'done', started: 0, children: [], ...extra })
const turn = (): Block => ({ kind: 'turn', key: `k${++n}`, rev: 0, turnId: `turn${n}`, ended: 0 })

describe('focusTurns', () => {
  it('keeps words along the way, and folds each run of work between them', () => {
    const [t] = focusTurns([user('고쳐 줘'), think(), text('먼저 볼게'), tool('Read'), tool('Grep'), text('이렇게 고칠게'), tool('Edit'), text('고쳤어'), turn()], false)
    expect(t.parts.map(p => (p.kind === 'show' ? (p.block.kind === 'text' ? p.block.text : p.block.kind) : `work:${p.blocks.length}`))).toEqual(['work:1', '먼저 볼게', 'work:2', '이렇게 고칠게', 'work:1', '고쳤어'])
  })
  it('shows everything as it happens while the turn runs', () => {
    const [t] = focusTurns([user('a'), text('볼게'), tool('Read', { state: 'running' })], true)
    expect(t.live).toBe(true)
    expect(t.flow.map(b => b.kind)).toEqual(['text', 'tool'])
  })
  it('keeps the prompt, folds the work, and keeps the last words and the turn foot', () => {
    const [t] = focusTurns([user('고쳐 줘'), think(), text('먼저 볼게'), tool('Read'), tool('Edit'), text('고쳤어'), turn()], false)
    expect(t.asked.map(b => b.kind)).toEqual(['user'])
    expect(t.work.map(b => b.kind)).toEqual(['thinking', 'text', 'tool', 'tool'])
    expect(t.answer && t.answer.kind === 'text' && t.answer.text).toBe('고쳤어')
    expect(t.foot?.kind).toBe('turn')
  })
  it('never folds what waits for the person', () => {
    const [t] = focusTurns([user('해 줘'), tool('Bash', { permission: { state: 'pending', request: {} as never } }), tool('AskUserQuestion')], true)
    expect(t.mine).toHaveLength(2)
    expect(t.work).toHaveLength(0)
  })
  it("keeps a subagent's card in full while a request inside it waits", () => {
    const asking = tool('Bash', { permission: { state: 'pending', request: {} as never } })
    const [t] = focusTurns([user('해 줘'), tool('Task', { state: 'running', children: [tool('Read'), asking] })], true)
    expect(t.parts.map(p => p.kind)).toEqual(['show'])
    if (asking.kind === 'tool') asking.permission!.state = 'allow'
    expect(focusTurns([user('해 줘'), tool('Task', { state: 'running', children: [asking] })], true)[0].parts.map(p => p.kind)).toEqual(['work'])
  })
  it('while running, words count as the answer only while nothing came after them', () => {
    expect(focusTurns([user('a'), text('보는 중', true)], true)[0].answer).toBeDefined()
    const [t] = focusTurns([user('a'), text('먼저 볼게'), tool('Read', { state: 'running' })], true)
    expect(t.answer).toBeUndefined()
    expect(t.live).toBe(true)
  })
  it('puts a message queued mid-turn after that turn, and starts the next turn after the foot', () => {
    const turns = focusTurns([user('a'), tool('Read'), user('b', true), text('끝'), turn(), tool('Bash'), text('b의 답'), turn()], false)
    expect(turns).toHaveLength(2)
    expect(turns[0].later.map(b => b.kind === 'user' && b.text)).toEqual(['b'])
    expect(turns[1].answer && turns[1].answer.kind === 'text' && turns[1].answer.text).toBe('b의 답')
  })
})
