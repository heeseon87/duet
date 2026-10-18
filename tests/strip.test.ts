import { describe, expect, it } from 'vitest'
import { narration, Transcript, waitLabel, type Waiting } from '../web/src/agent/transcript.ts'
import type { SdkMessage, SessionEvent } from '../shared/protocol.ts'

let seq = 0
const ev = (body: Record<string, unknown>, ts = 1000): SessionEvent => ({ seq: ++seq, ts, ...body }) as SessionEvent
const say = (text: string, ts = 1000, parent: string | null = null) => ev({ kind: 'sdk', msg: { type: 'assistant', parent_tool_use_id: parent, message: { id: `m${seq}`, content: [{ type: 'text', text }] } } as SdkMessage }, ts)
const use = (id: string, name: string, input: Record<string, unknown> = {}) => ev({ kind: 'sdk', msg: { type: 'assistant', parent_tool_use_id: null, message: { id: `m${seq}`, content: [{ type: 'tool_use', id, name, input }] } } as SdkMessage })
const ask = (id: string, toolName: string, toolUseId?: string) => ev({ kind: 'permission', request: { id, toolName, toolUseId, input: {} } })
const transcript = (events: SessionEvent[]) => { const t = new Transcript(); for (const e of events) t.apply(e); return t }

describe('waitLabel', () => {
  const w = (...kinds: Waiting['kind'][]) => kinds.map((kind, i) => ({ id: `p${i}`, kind }))
  it('names what waits by kind and count, and what the first one asks for', () => {
    expect(waitLabel(w('ask'))).toBe('질문 1개 · 답하기')
    expect(waitLabel(w('perm', 'perm'))).toBe('승인 2개 · 보기')
    expect(waitLabel(w('plan'))).toBe('계획 확인 · 보기')
  })
  it('combines kinds in the order they came', () => {
    expect(waitLabel(w('perm', 'ask', 'perm'))).toBe('승인 2개 · 질문 1개 · 보기')
  })
})

describe('Transcript.waiting', () => {
  it('tells a question and a plan from a permission, oldest first, and drops what was answered', () => {
    const t = transcript([ev({ kind: 'user', id: 'u', text: 'go' }), use('t1', 'Bash'), ask('p1', 'Bash', 't1'), use('t2', 'AskUserQuestion'), ask('p2', 'AskUserQuestion', 't2'), ask('p3', 'ExitPlanMode')])
    expect(t.waiting()).toEqual([{ id: 'p1', kind: 'perm' }, { id: 'p2', kind: 'ask' }, { id: 'p3', kind: 'plan' }])
    t.apply(ev({ kind: 'permission-resolved', id: 'p1', decision: 'allow' }))
    expect(t.waiting().map(x => x.id)).toEqual(['p2', 'p3'])
    expect(t.activity().label).toBe('답 대기')
  })
})

describe('narration', () => {
  it("is the last sentence of the main agent's latest words in this turn", () => {
    const t = transcript([ev({ kind: 'user', id: 'u', text: 'go' }), say('먼저 구조를 볼게.'), use('t1', 'Read'), say('읽었어. 이제 **테스트**를 `npm test`로 돌릴게.'), use('t2', 'Bash')])
    expect(narration(t.blocks, 1000)?.text).toBe('이제 테스트를 npm test로 돌릴게.')
  })
  it("skips a subagent's words and a code block, and waits for words still streaming", () => {
    const t = transcript([ev({ kind: 'user', id: 'u', text: 'go' }), say('이렇게 바꿀 거야:\n```ts\nconst a = 1\n```'), use('t1', 'Task'), say('나는 하위 에이전트야.', 1000, 't1')])
    expect(narration(t.blocks, 1000)?.text).toBe('이렇게 바꿀 거야:')
    t.blocks.push({ kind: 'text', key: 'live', rev: 0, text: '지금 쓰는', streaming: true })
    expect(narration(t.blocks, 1000)?.text).toBe('이렇게 바꿀 거야:')
  })
  it('is nothing before the agent says something in this turn', () => {
    const t = transcript([ev({ kind: 'user', id: 'u', text: 'a' }), say('지난 턴의 답.'), ev({ kind: 'turn-end', turnId: 'x' }), ev({ kind: 'user', id: 'v', text: 'b' }), use('t1', 'Bash')])
    expect(narration(t.blocks, 1000)).toBeUndefined()
  })
  it('says how long ago only once it is over half a minute old', () => {
    const t = transcript([ev({ kind: 'user', id: 'u', text: 'go' }), say('빌드를 돌릴게.', 10_000), use('t1', 'Bash')])
    expect(narration(t.blocks, 10_000 + 20_000)?.since).toBeUndefined()
    expect(narration(t.blocks, 10_000 + 180_000)?.since).toBe(10_000)
  })
})
