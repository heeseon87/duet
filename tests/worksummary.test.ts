import { describe, expect, it } from 'vitest'
import { workSentence } from '../web/src/agent/workSummary.ts'
import { Transcript, type Block } from '../web/src/agent/transcript.ts'
import type { SessionEvent } from '../shared/protocol.ts'

let n = 0
const think = (ms: number): Block => ({ kind: 'thinking', key: `k${++n}`, rev: 0, text: '...', streaming: false, started: 0, ended: ms })
const tool = (name: string, input: Record<string, unknown> = {}, state: 'done' | 'error' = 'done'): Block => ({ kind: 'tool', key: `k${++n}`, rev: 0, id: `t${n}`, name, input, inputText: '', state, started: 0, children: [] })

describe('workSentence', () => {
  it('tells a stretch of work in one line, the way Claude Code folds it', () => {
    expect(workSentence([think(23_000), ...Array.from({ length: 6 }, () => tool('Bash'))])).toBe('Thought for 23s, ran 6 shell commands')
  })
  it('counts files once, chains the parts, and ends on the last', () => {
    const blocks = [tool('Read', { file_path: '/a.kt' }), tool('Read', { file_path: '/a.kt' }), tool('Read', { file_path: '/b.kt' }), tool('Grep'), tool('Glob'), tool('Edit', { file_path: '/a.kt' })]
    expect(workSentence(blocks)).toBe('Read 2 files, searched for 2 patterns, edited 1 file')
  })
  it('leaves out a blink of thought, and says what failed', () => {
    expect(workSentence([think(400), tool('Bash', {}, 'error'), tool('Bash')])).toBe('Ran 2 shell commands (1 failed)')
    expect(workSentence([think(125_000), tool('WebSearch')])).toBe('Thought for 2m 5s, ran 1 web search')
  })
})

describe('thinking read back from the log', () => {
  it('runs from the event before it until it was written', () => {
    const t = new Transcript()
    const ev = (seq: number, ts: number, body: Record<string, unknown>) => ({ seq, ts, ...body }) as unknown as SessionEvent
    t.apply(ev(1, 1_000, { kind: 'user', id: 'u1', text: 'hi' }))
    t.apply(ev(2, 24_000, { kind: 'sdk', msg: { type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: 'hmm' }] } } }))
    t.apply(ev(3, 24_500, { kind: 'sdk', msg: { type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } } }))
    const thinking = t.blocks.find(b => b.kind === 'thinking')
    expect(thinking && thinking.kind === 'thinking' && (thinking.ended ?? 0) - thinking.started).toBe(23_000)
  })
})
