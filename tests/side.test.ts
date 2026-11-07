import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adoptThreads, earlierOf, mainPrompt, sideDigest, sideFailure, sidePrompt, Sides, type DecisionContext } from '../server/side.ts'
import { Terminals } from '../server/terminals.ts'
import { chatsAbout, followUpOf, titleOf, turnState, type SideChat, type SideChatView, type SideTurn } from '../shared/side.ts'
import type { CanvasDecision } from '../shared/canvas.ts'
import type { CanvasThread } from '../shared/protocol.ts'

const d1: CanvasDecision = {
  id: 'D1', question: 'URL을 어떤 모양으로 할까?', recommended: 'D1-a',
  why: { text: '관례가 둘이야.', tags: ['convention'] },
  options: [{ id: 'D1-a', text: 'POST /groups', impact: '목록과 같은 컬렉션' }, { id: 'D1-b', text: 'POST /users/{id}/groups' }],
}
const ctx = (target: string, opener?: string): DecisionContext => ({ title: '그룹 API', name: 'groups', revision: 7, decision: d1, target, opener })
/** `answer: null`: the turn got no reply. */
const turn = (n: number, terminal = 'A', answer: string | null = `답 ${n}`, kind: 'answer' | 'failure' = 'answer'): SideTurn =>
  ({ id: `a${n}`, question: `질문 ${n}`, terminal, terminalLabel: terminal, at: n, ...(answer !== null ? { reply: { kind, text: answer, at: n } } : {}) })
const chat = (id: string, turns: SideTurn[], about?: SideChat['about'], created = 1): SideChat => ({ id, ...(about ? { about } : {}), turns: turns as SideChat['turns'], created })
const view = (c: SideChat, isAsking = false): SideChatView => ({ ...c, isAsking })

describe('sidePrompt', () => {
  it('frames a decision chat\'s question as a side one and gives the decision as the person sees it', () => {
    const p = sidePrompt({ decision: ctx('D1-b'), earlier: [], question: 'b는 왜 안 돼?' })
    expect(p).toContain('[Duet 곁질문]')
    expect(p).toContain('도구는 없어')
    expect(p).toContain('하던 작업을 이어 가지 말고')
    expect(p).toContain('사람이 결정을 보낼 때 함께 전해져')
    expect(p).toContain('지도 "그룹 API" (groups, rev 7)')
    expect(p).toContain('사람에게 묻는 이유: 관례가 둘이야. (convention)')
    expect(p).toContain('- D1-a POST /groups · 영향: 목록과 같은 컬렉션 (네 추천)')
    expect(p).toContain('사람이 보고 있는 선택지: D1-b POST /users/{id}/groups')
    expect(p.endsWith('질문: b는 왜 안 돼?')).toBe(true)
  })

  it('asks a workspace chat\'s question with no decision, after the chat so far', () => {
    const p = sidePrompt({ earlier: ['- 사람: 첫 질문', '- 너: 첫 답'], question: '이어서' })
    expect(p).toContain('[Duet 곁질문]')
    expect(p).not.toContain('지도 "')
    expect(p).not.toContain('결정을 보낼 때')
    expect(p).toContain('이 곁 대화에서 앞서 나눈 말 (오래된 것부터):\n- 사람: 첫 질문\n- 너: 첫 답\n\n질문: 이어서')
  })
})

describe('earlierOf', () => {
  it('replays the answered turns oldest first, leaving out what got no answer', () => {
    expect(earlierOf([turn(1), turn(2, 'A', null), turn(3, 'A', '실패', 'failure'), turn(4)], 'A')).toEqual(['- 사람: 질문 1', '- 너: 답 1', '- 사람: 질문 4', '- 너: 답 4'])
  })

  it('marks the turns another session answered, and says what the mark means', () => {
    const lines = earlierOf([turn(1, 'A'), turn(2, 'B')], 'B')
    expect(lines).toEqual(['(※는 다른 세션에서 나눈 문답이야. 네 대화에는 그 바탕이 없을 수 있어.)', '- ※ 사람: 질문 1', '- ※ 너: 답 1', '- 사람: 질문 2', '- 너: 답 2'])
  })

  it('keeps the newest within the budget, the newest answer longer than the older ones, and counts what it dropped', () => {
    const long = (n: number) => turn(n, 'A', 'ㄱ'.repeat(3000))
    const lines = earlierOf([long(1), long(2), long(3), long(4)], 'A')
    expect(lines[0]).toBe('(앞선 문답 2개는 줄였어)')
    expect(lines.filter(l => l.startsWith('- 사람'))).toEqual(['- 사람: 질문 3', '- 사람: 질문 4'])
    const answers = lines.filter(l => l.startsWith('- 너'))
    expect(answers[0].length).toBeLessThan(1600)
    expect(answers[1].length).toBeGreaterThan(2900)
    expect(lines.join('\n').length).toBeLessThan(6200)
  })
})

describe('mainPrompt', () => {
  it('gives the main conversation the Q&A it never saw and the last question to take up', () => {
    const p = mainPrompt(chat('s1', [turn(1), turn(2, 'A', null)]))
    expect(p).toContain('[Duet 곁 대화]')
    expect(p).toContain('- 사람: 질문 1\n- 곁 답: 답 1')
    expect(p).not.toContain('- 사람: 질문 2')
    expect(p.endsWith('\n질문 2')).toBe(true)
  })
})

describe('sideDigest', () => {
  it('lists the side questions on the decision and its options, with their answers, from the chats about it', () => {
    const lines = sideDigest([
      chat('s1', [turn(1), turn(2, 'A', '못 함', 'failure')], { map: 'groups', target: 'D1-b' }, 1),
      chat('s2', [turn(3, 'A', null)], { map: 'groups', target: 'D1' }, 2),
      chat('s3', [turn(4)], { map: 'other', target: 'D1' }, 3),
      chat('s4', [turn(5)], { map: 'groups', target: 'D2' }, 4),
      chat('s5', [turn(6)], undefined, 5),
    ], 'groups', d1)
    expect(lines[0]).toContain('네 대화 기록에는 없어')
    expect(lines.slice(1)).toEqual([
      '  - D1-b에 대해 물음: 질문 1', '    곁 답: 답 1',
      '  - D1-b에 대해 물음: 질문 2', '    곁 답: 없음',
      '  - D1에 대해 물음: 질문 3', '    곁 답: 없음',
    ])
  })

  it('is empty when nothing was asked on the side, and stays short when much was', () => {
    expect(sideDigest([chat('s1', [turn(1)])], 'groups', d1)).toEqual([])
    const many = Array.from({ length: 20 }, (_, i) => ({ ...turn(i), question: 'ㄱ'.repeat(300), reply: { kind: 'answer' as const, text: 'ㄴ'.repeat(300), at: i } }))
    const long = sideDigest([chat('s1', many, { map: 'groups', target: 'D1' })], 'groups', d1)
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

describe('the chat model', () => {
  it('titles a chat by its first question\'s first line, cut short', () => {
    expect(titleOf(chat('s', [{ ...turn(1), question: '  첫 줄\n둘째 줄' }]))).toBe('첫 줄')
    expect(titleOf(chat('s', [{ ...turn(1), question: 'ㄱ'.repeat(60) }]))).toBe(`${'ㄱ'.repeat(50)}…`)
  })

  it('reads each turn\'s state: only the last can still be waited on', () => {
    const c = chat('s', [turn(1), turn(2, 'A', 'x', 'failure'), turn(3, 'A', null), turn(4, 'A', null)])
    expect([0, 1, 2, 3].map(i => turnState(view(c, true), i))).toEqual(['answered', 'failed', 'ended', 'asking'])
    expect(turnState(view(c, false), 3)).toBe('ended')
  })

  it('takes a follow-up only when the last question is not waited on and its session lives', () => {
    const c = chat('s', [turn(1, 'A'), turn(2, 'B')])
    expect(followUpOf(view(c), [{ id: 'B' }])).toBe('ok')
    expect(followUpOf(view(c), [{ id: 'A' }])).toBe('gone')
    expect(followUpOf(view(c, true), [{ id: 'B' }])).toBe('asking')
  })

  it('finds the chats about a decision or its options on that map, oldest first', () => {
    const all = [chat('late', [turn(1)], { map: 'groups', target: 'D1-a' }, 9), chat('early', [turn(1)], { map: 'groups', target: 'D1' }, 2), chat('d2', [turn(1)], { map: 'groups', target: 'D2' }), chat('ws', [turn(1)])]
    expect(chatsAbout(all, 'groups', d1).map(c => c.id)).toEqual(['early', 'late'])
  })
})

describe('adoptThreads', () => {
  const thread = (id: string, items: [CanvasThread['items'][number]['who'], string][], side = true): CanvasThread & { side?: true } => ({
    id, target: 'D1-a', targetLabel: 'D1-a', revision: 1, state: 'open', ...(side ? { side: true as const } : {}), created: 5,
    items: items.map(([who, text], i) => ({ id: `i${i}`, who, text, ts: i, terminal: '4aa62e36-4abb-408d', messageId: `a-${i}` })),
  })

  it('makes each side thread a chat with the thread\'s id, each question a turn with its answer or the failure kept', () => {
    const [c, ...rest] = adoptThreads('groups', [
      thread('t1', [['person', '조금 더 설명해줘'], ['agent', '이건 이래.'], ['person', '그럼?'], ['agent', sideFailure('api-error', 529)], ['person', '마지막']]),
      thread('t2', [['person', '코멘트']], false),
    ])
    expect(rest).toEqual([])
    expect(c).toMatchObject({ id: 't1', about: { map: 'groups', target: 'D1-a' }, created: 5 })
    expect(c.turns.map(t => [t.id, t.question, t.reply?.kind, t.reply?.text])).toEqual([
      ['a-0', '조금 더 설명해줘', 'answer', '이건 이래.'],
      ['a-2', '그럼?', 'failure', 'API 오류 529 때문에 곁질문에 답하지 못했어.'],
      ['a-4', '마지막', undefined, undefined],
    ])
    expect(c.turns[0]).toMatchObject({ terminal: '4aa62e36-4abb-408d', terminalLabel: '4aa62e36' })
  })

  it('makes no chat of a side thread with no question', () => {
    expect(adoptThreads('groups', [thread('t1', [['agent', '혼잣말']])])).toEqual([])
  })
})

describe('Sides', () => {
  const WS = '/w'
  const make = (o: { canAsk?: boolean } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'duet-side-'))
    const file = join(dir, 'side.json')
    const terminals = new Terminals(() => undefined, ids => sides.dropped(ids))
    const changed: string[] = []
    const decisions: Record<string, DecisionContext | undefined> = { 'groups/D1-a': ctx('D1-a', 'OPENER'), 'groups/D1-b': ctx('D1-b', 'OPENER') }
    const sides: Sides = new Sides({ terminals, file: () => file, changed: (_, c) => { changed.push(c) }, decision: (_, a) => decisions[`${a.map}/${a.target}`] })
    const register = (id: string, canAsk = o.canAsk ?? true) => terminals.register({ id, workspace: WS, cwd: WS, label: `${id} label`, canAsk })
    const saved = () => (existsSync(file) ? readFileSync(file, 'utf8') : undefined)
    const asked = async (id: string) => (await terminals.poll(id, 0, () => undefined)).ask
    return { sides, terminals, register, saved, asked, changed, decisions, file }
  }

  it('keeps the question, then hands it to the terminal, and lands the answer by ask id', async () => {
    const s = make()
    s.register('A')
    const v = s.sides.ask(WS, { question: '이거 왜 이래?', terminal: 'A' })
    expect(JSON.parse(s.saved()!).chats).toHaveLength(1)
    expect(v).toMatchObject({ isAsking: true, turns: [{ question: '이거 왜 이래?', terminal: 'A', terminalLabel: 'A label' }] })
    const ask = await s.asked('A')
    expect(ask?.id).toBe(v.turns[0].id)
    expect(ask?.prompt.endsWith('질문: 이거 왜 이래?')).toBe(true)
    s.terminals.answered(ask!.id)
    s.sides.settle(ask!.id, { answer: '이래서야.' })
    expect(s.sides.get(WS, v.id)).toMatchObject({ isAsking: false, turns: [{ reply: { kind: 'answer', text: '이래서야.' } }] })
    expect(s.changed).toEqual([v.id, v.id])
  })

  it('asks a follow-up of the session that answered, replaying the chat so far', async () => {
    const s = make()
    s.register('A')
    s.register('B')
    const v = s.sides.ask(WS, { question: '첫 질문', terminal: 'A' })
    s.terminals.answered(v.turns[0].id)
    s.sides.settle(v.turns[0].id, { answer: '첫 답' })
    const next = s.sides.ask(WS, { chat: v.id, question: '이어서', moveTo: 'B' })
    expect(next.turns.map(t => t.terminal)).toEqual(['A', 'A'])
    const ask = await s.asked('A')
    expect(ask?.prompt).toContain('- 사람: 첫 질문\n- 너: 첫 답\n\n질문: 이어서')
    expect(await s.asked('B')).toBeUndefined()
  })

  it('refuses before writing anything: a question still waited on, a gone session, a mod that cannot fork, a gone decision', () => {
    const s = make()
    s.register('A')
    s.register('OLD', false)
    const v = s.sides.ask(WS, { question: '첫 질문', terminal: 'A' })
    const before = s.saved()
    expect(() => s.sides.ask(WS, { chat: v.id, question: '또' })).toThrow(expect.objectContaining({ status: 409 }))
    s.terminals.answered(v.turns[0].id)
    s.terminals.remove('A')
    expect(() => s.sides.ask(WS, { chat: v.id, question: '또' })).toThrow(expect.objectContaining({ status: 410 }))
    expect(() => s.sides.ask(WS, { chat: v.id, question: '또', moveTo: 'GONE' })).toThrow(expect.objectContaining({ status: 410 }))
    expect(() => s.sides.ask(WS, { question: '새로', terminal: 'OLD' })).toThrow(expect.objectContaining({ status: 409 }))
    expect(() => s.sides.ask(WS, { about: { map: 'groups', target: 'D9' }, question: '?', terminal: 'OLD' })).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => s.sides.ask(WS, { question: '새로' })).toThrow(expect.objectContaining({ status: 409 }))
    expect(s.saved()).toBe(before)
  })

  it('moves a chat whose session is gone to the live one named, marking what the other session said', async () => {
    const s = make()
    s.register('A')
    const v = s.sides.ask(WS, { question: '첫 질문', terminal: 'A' })
    s.sides.settle(v.turns[0].id, { answer: '첫 답' })
    s.terminals.remove('A')
    s.register('B')
    const moved = s.sides.ask(WS, { chat: v.id, question: '이어서', moveTo: 'B' })
    expect(moved.turns.map(t => t.terminal)).toEqual(['A', 'B'])
    expect((await s.asked('B'))?.prompt).toContain('- ※ 사람: 첫 질문')
    s.sides.settle(moved.turns[1].id, { answer: '둘째 답' })
    // From then on it is bound to B.
    expect(s.sides.ask(WS, { chat: v.id, question: '셋째' }).turns[2].terminal).toBe('B')
  })

  it('starts a decision chat with the terminal that opened the decision while it is there, else the one named', async () => {
    const s = make()
    s.register('PICKED')
    const a = s.sides.ask(WS, { about: { map: 'groups', target: 'D1-a' }, question: '왜 a?', terminal: 'PICKED' })
    expect(a.turns[0].terminal).toBe('PICKED')
    s.register('OPENER')
    const b = s.sides.ask(WS, { about: { map: 'groups', target: 'D1-b' }, question: '왜 b?', terminal: 'PICKED' })
    expect(b).toMatchObject({ about: { map: 'groups', target: 'D1-b' }, turns: [{ terminal: 'OPENER' }] })
    expect((await s.asked('OPENER'))?.prompt).toContain('사람이 보고 있는 선택지: D1-b')
    // The decision since gone: a follow-up asks without its block.
    s.sides.settle(b.turns[0].id, { answer: '이래서.' })
    s.decisions['groups/D1-b'] = undefined
    s.sides.ask(WS, { chat: b.id, question: '그래서?' })
    const follow = await s.asked('OPENER')
    expect(follow?.prompt).not.toContain('지도 "')
    expect(follow?.prompt).toContain('질문: 그래서?')
  })

  it('keeps the first reply only, ignores one it never asked, and still lands one after the ask was dropped', () => {
    const s = make()
    s.register('A')
    const v = s.sides.ask(WS, { question: 'q', terminal: 'A' })
    s.terminals.remove('A')
    expect(s.sides.get(WS, v.id).isAsking).toBe(false)
    expect(s.changed.filter(c => c === v.id)).toHaveLength(2)
    s.sides.settle(v.turns[0].id, { reason: 'api-error', status: 529 })
    s.sides.settle(v.turns[0].id, { answer: '늦은 답' })
    s.sides.settle('a-unknown', { answer: '모르는 답' })
    expect(s.sides.get(WS, v.id).turns[0].reply).toMatchObject({ kind: 'failure', text: 'API 오류 529 때문에 곁질문에 답하지 못했어.' })
  })

  it('keeps the 200 most recently active chats', () => {
    const s = make()
    s.register('A')
    const first = s.sides.ask(WS, { question: '처음', terminal: 'A' })
    s.sides.adopt(WS, [{ map: 'm', threads: Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, target: 'D1', targetLabel: 'D1', revision: 1, state: 'open' as const, side: true as const, created: 0, items: [{ id: 'i', who: 'person' as const, text: 'q', ts: Date.now() + 1000 + i }] })) }])
    const ids = s.sides.list(WS).map(c => c.id)
    expect(ids).toHaveLength(200)
    expect(ids).not.toContain(first.id)
  })

  it('takes side threads in once, however often it is asked to', () => {
    const s = make()
    const legacy = [{ map: 'groups', threads: [{ id: 't1', target: 'D1-a', targetLabel: 'D1-a', revision: 1, state: 'open' as const, side: true as const, created: 1, items: [{ id: 'i1', who: 'person' as const, text: 'q', ts: 1, terminal: 'A', messageId: 'a-1' }] }] }]
    s.sides.adopt(WS, legacy)
    const once = s.saved()
    s.sides.adopt(WS, legacy)
    expect(s.saved()).toBe(once)
    expect(s.sides.list(WS).map(c => c.id)).toEqual(['t1'])
  })

  it('forgets a deleted chat', () => {
    const s = make()
    s.register('A')
    const v = s.sides.ask(WS, { question: 'q', terminal: 'A' })
    s.sides.remove(WS, v.id)
    expect(s.sides.list(WS)).toEqual([])
    expect(() => s.sides.get(WS, v.id)).toThrow(expect.objectContaining({ status: 404 }))
  })
})
