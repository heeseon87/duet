import { describe, expect, it } from 'vitest'
import { sideDigest, sideFailure, sidePrompt } from '../server/side.ts'
import type { CanvasDecision } from '../shared/canvas.ts'
import type { CanvasThread } from '../shared/protocol.ts'

const d1: CanvasDecision = {
  id: 'D1', question: 'URL을 어떤 모양으로 할까?', recommended: 'D1-a',
  why: { text: '관례가 둘이야.', tags: ['convention'] },
  options: [{ id: 'D1-a', text: 'POST /groups', impact: '목록과 같은 컬렉션' }, { id: 'D1-b', text: 'POST /users/{id}/groups' }],
}
const thread = (target: string, items: [CanvasThread['items'][number]['who'], string][], side = true): CanvasThread => ({
  id: `t-${target}`, target, targetLabel: target, revision: 1, state: 'open', ...(side ? { side: true as const } : {}), created: 1,
  items: items.map(([who, text], i) => ({ id: `i${i}`, who, text, ts: i })),
})

describe('sidePrompt', () => {
  it('frames the question as a side one and gives the decision as the person sees it', () => {
    const p = sidePrompt({ title: '그룹 API', name: 'groups', revision: 7, decision: d1, target: 'D1-b', earlier: [], question: 'b는 왜 안 돼?' })
    expect(p).toContain('[Duet 곁질문]')
    expect(p).toContain('도구는 없어')
    expect(p).toContain('하던 작업을 이어 가지 말고')
    expect(p).toContain('지도 "그룹 API" (groups, rev 7)')
    expect(p).toContain('사람에게 묻는 이유: 관례가 둘이야. (convention)')
    expect(p).toContain('- D1-a POST /groups · 영향: 목록과 같은 컬렉션 (네 추천)')
    expect(p).toContain('사람이 보고 있는 선택지: D1-b POST /users/{id}/groups')
    expect(p.endsWith('질문: b는 왜 안 돼?')).toBe(true)
  })

  it('carries the thread so far, which no fork remembers', () => {
    const p = sidePrompt({ title: 't', name: 'n', revision: 1, decision: d1, target: 'D1', earlier: [{ who: 'person', text: '첫 질문' }, { who: 'agent', text: '첫 답' }], question: '이어서' })
    expect(p).toContain('- 사람: 첫 질문\n- 너: 첫 답')
    expect(p).not.toContain('사람이 보고 있는 선택지')
  })
})

describe('sideDigest', () => {
  it('lists the side questions on the decision and its options, with their answers', () => {
    const lines = sideDigest([
      thread('D1-b', [['person', 'b는 왜 안 돼?'], ['agent', '다른 지도가 /groups를 써.']]),
      thread('D1', [['person', '둘 다 되나?']]),
      thread('D1-a', [['person', '일반 코멘트'], ['agent', '답']], false),
      thread('D2', [['person', '다른 결정']]),
    ], d1)
    expect(lines[0]).toContain('네 대화 기록에는 없어')
    expect(lines.slice(1)).toEqual([
      '  - D1-b에 대해 물음: b는 왜 안 돼?', '    곁 답: 다른 지도가 /groups를 써.',
      '  - D1에 대해 물음: 둘 다 되나?', '    곁 답: 없음',
    ])
  })

  it('is empty when nothing was asked on the side, and stays short when much was', () => {
    expect(sideDigest([thread('D1', [['person', 'x']], false)], d1)).toEqual([])
    const long = sideDigest([thread('D1', Array.from({ length: 40 }, (_, i) => [i % 2 ? 'agent' : 'person', 'ㄱ'.repeat(300)] as [CanvasThread['items'][number]['who'], string]))], d1)
    expect(long.join('\n').length).toBeLessThan(2600)
    expect(long.at(-1)).toContain('곁질문이 더 있어')
  })
})

describe('sideFailure', () => {
  it('says in the person\'s words why no answer came', () => {
    expect(sideFailure('nothing-to-fork')).toContain('/clear')
    expect(sideFailure('api-error', 529)).toBe('API 오류 529 때문에 곁질문에 답하지 못했어.')
    expect(sideFailure('empty-reply')).toBe('곁질문에 빈 답이 왔어.')
    expect(sideFailure(undefined)).toBe('곁질문에 답하지 못했어.')
  })
})
