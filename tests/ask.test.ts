import { describe, expect, it } from 'vitest'
import { answersOf } from '../web/src/agent/askModel.ts'
import { Transcript, type ToolBlock } from '../web/src/agent/transcript.ts'
import type { SessionEvent } from '../shared/protocol.ts'

const questions = [
  { question: '완료일을 언제로 잡을까?', header: '완료 예정일', multiSelect: false, options: [{ label: '오늘 (10/18 일)', description: '2026-10-18' }, { label: '10/21 수' }, { label: '이번 주 금요일 (10/23)' }] },
  { question: '어떤 검사를 돌릴까?', multiSelect: true, options: [{ label: '타입' }, { label: '단위 테스트' }, { label: 'e2e' }] },
]

/** The card as a reload rebuilds it: from the logged tool call, the permission and the tool's result. */
function replay(tail: Record<string, unknown>[]): ToolBlock {
  let seq = 0
  const t = new Transcript()
  const events = [
    { kind: 'sdk', msg: { type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'AskUserQuestion', input: { questions } }] } } },
    { kind: 'permission', request: { id: 'p1', toolName: 'AskUserQuestion', toolUseId: 'toolu_1', input: { questions } } },
    ...tail,
  ]
  for (const e of events) t.apply({ seq: ++seq, ts: seq, ...e } as SessionEvent)
  return t.blocks[0] as ToolBlock
}
const answered = (answers: Record<string, string>) => replay([
  { kind: 'permission-resolved', id: 'p1', decision: 'allow' },
  { kind: 'sdk', msg: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Your questions have been answered: ...' }] }, tool_use_result: { questions, answers } } },
])

describe('answersOf', () => {
  it('is nothing while the question waits', () => {
    expect(answersOf(replay([]))).toBeUndefined()
  })
  it('marks the option picked for each question, several for a multi-select', () => {
    const a = answersOf(answered({ '완료일을 언제로 잡을까?': '이번 주 금요일 (10/23)', '어떤 검사를 돌릴까?': '타입, e2e' }))!
    expect(a.map(x => [x.picked, x.own])).toEqual([[['이번 주 금요일 (10/23)'], undefined], [['타입', 'e2e'], undefined]])
  })
  it('keeps words typed instead of, or next to, an option', () => {
    const a = answersOf(answered({ '완료일을 언제로 잡을까?': '다음 주 월요일', '어떤 검사를 돌릴까?': '단위 테스트, 린트도' }))!
    expect(a.map(x => [x.picked, x.own])).toEqual([[[], '다음 주 월요일'], [['단위 테스트'], '린트도']])
  })
  it('says skipped when the person skipped, or left a question blank', () => {
    const skipped = replay([
      { kind: 'permission-resolved', id: 'p1', decision: 'deny', message: '답하지 않고 넘어갈게.' },
      { kind: 'sdk', msg: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '답하지 않고 넘어갈게.', is_error: true }] }, tool_use_result: 'Error: 답하지 않고 넘어갈게.' } },
    ])
    expect(answersOf(skipped)!.map(x => [x.q.question, x.picked, x.own])).toEqual([['완료일을 언제로 잡을까?', [], undefined], ['어떤 검사를 돌릴까?', [], undefined]])
    const blank = answersOf(answered({ '완료일을 언제로 잡을까?': '10/21 수', '어떤 검사를 돌릴까?': '' }))!
    expect(blank[1]).toMatchObject({ picked: [], own: undefined })
  })
})
