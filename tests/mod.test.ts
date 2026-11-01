import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { argsOf, duetHomeOf, followsSpawn, heardPin, heldEnds, heldPrune, heldQuiet, heldSpawned, heldStarts, labelOf, LINE_MAX, lineOf, linkOf, matchMap, newMapOf, noRepo, pinNote, QUIET_MS, reportFrom, runDuet, saidOf, shownMap, statusText, unreachable, waitingOf, type Held, type MapSummary } from '../mod/hooks/duet.ts'
import { modTools } from '../scripts/mod-tools.ts'

const sent: Held = { id: 'msg1', text: '트랜잭션 경계를 여기로 옮기면 어때?', isWorking: false }
const handBack = (agent: string) => `<agent-message from="${agent}">\n[Subagent hand-back] Owner: platform team</agent-message>`
const end = (turnId: string, answer: string, over: { agentId?: string; isAborted?: boolean } = {}) => ({ turnId, answer, isAborted: false, ...over })

const map = (over: Partial<MapSummary>): MapSummary => ({ name: 'm', title: '지도', revision: 1, updated: 0, decisions: 0, openDecisions: 0, openThreads: 0, ...over })

describe('the terminal mod', () => {
  it('finds the server where the server keeps its files', () => {
    expect(duetHomeOf(undefined, '/Users/me')).toBe('/Users/me/.duet')
    expect(duetHomeOf('/tmp/duet-r6', '/Users/me')).toBe('/tmp/duet-r6')
  })

  it('names a terminal by its folder and session', () => {
    expect(labelOf('/Users/me/am/worktrees/FEAT-42', '1a2b3c4d-0000-4000-8000-000000000000')).toBe('FEAT-42 · 1a2b3c4d')
    expect(labelOf('/', 'abcdefgh1234')).toBe('~ · abcdefgh')
  })

  it('shows the map this terminal last touched, until another one changes', () => {
    const a = map({ name: 'a', updated: 100 }), b = map({ name: 'b', updated: 200 })
    expect(shownMap([a, b])).toBe(b)
    expect(shownMap([a, b], { name: 'a', at: 300 })).toBe(a)
    expect(shownMap([a, map({ name: 'b', updated: 400 })], { name: 'a', at: 300 })?.name).toBe('b')
    expect(shownMap([a, b], { name: 'gone', at: 300 })).toBe(b)
    expect(shownMap([])).toBeUndefined()
  })

  it('keeps the status line short', () => {
    expect(statusText({ kind: 'off' })).toBe('Duet 꺼짐')
    expect(statusText({ kind: 'no-workspace' })).toBe('Duet 작업 공간 없음')
    expect(statusText({ kind: 'on' })).toBe('Duet · 지도 없음')
    expect(statusText({ kind: 'on', map: map({ title: '썸네일 워커', revision: 12, decisions: 3, openDecisions: 1, openThreads: 2 }) })).toBe('Duet · 썸네일 워커 · rev 12 · 결정 2/3 · 코멘트 2')
    expect(statusText({ kind: 'on', map: map({ revision: 3 }) })).toBe('Duet · 지도 · rev 3 · 코멘트 0')
  })

  it('shows the pinned map with a pin, whatever was touched since', () => {
    const pinned = map({ name: 'swing', title: '썸네일 워커 클래스 구조', revision: 33, decisions: 9, updated: 100 }), newer = map({ name: 'other', updated: 900 })
    const link = linkOf([pinned, newer], { name: 'other', at: 950 }, 'swing')
    expect(link).toEqual({ kind: 'on', map: pinned, isPinned: true })
    expect(statusText(link)).toBe('Duet · 📌 썸네일 워커 클래스 구조 · rev 33 · 결정 9/9 · 코멘트 0')
    expect(linkOf([pinned, newer], undefined, 'gone')).toEqual({ kind: 'on', map: newer })
    expect(statusText(linkOf([pinned, newer]))).not.toContain('📌')
  })

  it('finds the map to pin: a name exactly, else the one map whose name or title holds the text', () => {
    const e2e = map({ name: 'mod-e2e', title: '모드 시험 지도' }), pin = map({ name: 'mod-e2e-pin', title: '모드 고정 지도' }), code = map({ name: 'code-map', title: 'Code Map' })
    const maps = [e2e, pin, code]
    expect(matchMap(maps, 'mod-e2e')).toEqual({ kind: 'one', map: e2e })
    expect(matchMap(maps, '고정')).toEqual({ kind: 'one', map: pin })
    expect(matchMap(maps, 'code MAP')).toEqual({ kind: 'one', map: code })
    expect(matchMap(maps, '모드')).toEqual({ kind: 'many', maps: [e2e, pin] })
    expect(matchMap(maps, '없는 지도')).toEqual({ kind: 'none' })
  })

  it('pins with /duet <map>, changes nothing on an unclear one, and unpins with /duet off', () => {
    const maps = [map({ name: 'mod-e2e', title: '모드 시험 지도', revision: 3, decisions: 2, openDecisions: 1 }), map({ name: 'mod-e2e-pin', title: '모드 고정 지도' })]
    const on = { kind: 'maps' as const, maps }
    expect(runDuet(' 고정 ', undefined, on)).toEqual({ text: '기준 지도: 모드 고정 지도 (mod-e2e-pin)', pin: 'mod-e2e-pin' })
    const many = runDuet('모드', 'mod-e2e-pin', on)
    expect(many.pin).toBe('mod-e2e-pin')
    expect(many.text).toContain('mod-e2e · 모드 시험 지도 · rev 3 · 결정 1/2')
    expect(many.text).toContain('mod-e2e-pin · 모드 고정 지도 · rev 1 📌')
    expect(runDuet('없는', undefined, on)).toMatchObject({ pin: undefined, text: expect.stringContaining('맞는 지도가 없어') })
    expect(runDuet('off', 'mod-e2e', on).pin).toBeUndefined()
    expect(runDuet('off', undefined, on).text).toBe('고정된 지도 없음')
  })

  it('/duet alone shows the pin and every map', () => {
    const maps = [map({ name: 'a', title: '가' }), map({ name: 'b', title: '나' })]
    const shown = runDuet('', 'b', { kind: 'maps', maps })
    expect(shown.pin).toBe('b')
    expect(shown.text.split('\n')).toEqual(['기준 지도: 나 (b)', '', '이 작업 공간의 지도 2개', '- a · 가 · rev 1', '- b · 나 · rev 1 📌'])
    expect(runDuet('', undefined, { kind: 'maps', maps }).text).toMatch(/^고정된 지도 없음\n/)
  })

  it('keeps the pin when Duet cannot be reached, and says why', () => {
    const off = { kind: 'unreachable' as const, why: 'Duet이 꺼져 있어.' }
    expect(runDuet('a', 'b', off)).toEqual({ text: 'Duet이 꺼져 있어.', pin: 'b' })
    expect(runDuet('', 'b', off).text).toBe('기준 지도: b\nDuet이 꺼져 있어.')
    expect(runDuet('off', 'b', off).pin).toBeUndefined()
  })

  it('tells the model the pinned name to pass, and when the pin is gone', () => {
    expect(pinNote('mod-e2e-pin', [map({ name: 'mod-e2e-pin', title: '모드 고정 지도' })])).toContain('pass name "mod-e2e-pin" to the duet_map_* tools')
    expect(pinNote(undefined, [], 'mod-e2e')).toContain('no longer has a pinned Duet map (it was "mod-e2e")')
  })

  it('finds the pin note wherever the model was sent it: a row, a block, a tool result', () => {
    const note = pinNote('swing', [map({ name: 'swing', title: '썸네일' })])
    expect(heardPin([{ content: note }], 'swing')).toBe(true)
    expect(heardPin([{ content: [{ type: 'text', text: `앞\n${note}` }] }], 'swing')).toBe(true)
    expect(heardPin([{ content: [{ type: 'tool_result', content: [{ type: 'text', text: note }] }] }], 'swing')).toBe(true)
    expect(heardPin([{ content: note }], 'other')).toBe(false)
    expect(heardPin([{ content: [{ type: 'text', text: 'summary without it' }] }], 'swing')).toBe(false)
  })

  it('reads /duet new as a map to make, its title the name when none is given', () => {
    expect(newMapOf('new thumbnail-worker 썸네일 워커')).toEqual({ name: 'thumbnail-worker', title: '썸네일 워커' })
    expect(newMapOf('  new swing ')).toEqual({ name: 'swing', title: 'swing' })
    expect(newMapOf('new')).toEqual({ name: '', title: '' })
    expect(newMapOf('newer')).toBeUndefined()
    expect(newMapOf('swing')).toBeUndefined()
  })

  it('relays only the arguments the model wrote', () => {
    expect(argsOf({ tool: 'mcp__duet__duet_map_read', tool_use_id: 'toolu_1', name: 'feat' })).toEqual({ name: 'feat' })
  })

  it('says plainly why maps cannot be reached', () => {
    expect(unreachable({ kind: 'off' }, '/w')).toContain('`duet`')
    expect(unreachable({ kind: 'no-workspace' }, '/w/x')).toContain('/w/x')
    expect(unreachable({ kind: 'no-workspace' }, '/w/x')).toContain('duet_map_create')
    expect(unreachable({ kind: 'off' }, '/w')).not.toContain('duet_map_create')
  })

  it('says a new workspace needs a git repository', () => {
    expect(noRepo('/tmp/notes')).toContain('/tmp/notes')
    expect(noRepo('/tmp/notes')).toContain('git repository')
  })

  it('answers a message with its own turn when it starts no background agent', () => {
    const started = heldStarts(sent, { turnId: 't1', text: sent.text })
    expect(started.isNew).toBe(true)
    expect(heldEnds(started.held, end('t1', '답'))).toEqual({ held: undefined, done: { answer: '답' } })
  })

  it('waits for a background agent to hand back, and answers with the turn the hand-back starts', () => {
    let held = heldStarts(sent, { turnId: 't1', text: sent.text }).held
    held = heldSpawned(held, 'a1')
    // The message's own turn ends saying the agent is still at work: no answer yet.
    let ended = heldEnds(held, end('t1', 'The Explore agent is running in the background.'))
    expect(ended.done).toBeUndefined()
    expect(heldQuiet(ended.held, QUIET_MS * 10)).toBeUndefined()
    // The hand-back starts its turn before the agent's own end is heard.
    held = heldStarts(ended.held, { turnId: 't2', text: handBack('a1') }).held
    expect(held?.turnId).toBe('t2')
    held = heldEnds(held, end('a-run', 'Owner: platform team', { agentId: 'a1' })).held
    ended = heldEnds(held, end('t2', 'The owner is the platform team.'))
    expect(ended).toEqual({ held: undefined, done: { answer: 'The owner is the platform team.' } })
  })

  it('holds on until every agent of the message has handed back', () => {
    let held = heldSpawned(heldSpawned(heldStarts(sent, { turnId: 't1', text: sent.text }).held, 'a1'), 'a2')
    held = heldEnds(held, end('t1', '둘 다 돌리는 중')).held
    held = heldEnds(heldStarts(held, { turnId: 't2', text: handBack('a1') }).held, end('a-run', '1', { agentId: 'a1' })).held
    let ended = heldEnds(held, end('t2', '하나 왔어'))
    expect(ended.done).toBeUndefined()
    held = heldEnds(heldStarts(ended.held, { turnId: 't3', text: '<task-notification>\n<task-id>a2</task-id>' }).held, end('a-run2', '2', { agentId: 'a2' })).held
    ended = heldEnds(held, end('t3', '둘 다 왔어'))
    expect(ended.done).toEqual({ answer: '둘 다 왔어' })
  })

  it('does not take the person\'s own turn for the message while it waits', () => {
    let held = heldEnds(heldSpawned(heldStarts(sent, { turnId: 't1', text: sent.text }).held, 'a1'), end('t1', '돌리는 중')).held
    const mine = heldStarts(held, { turnId: 't2', text: '다른 걸 물어볼게' })
    expect(mine.held).toBe(held)
    held = heldEnds(mine.held, end('t2', '내 질문의 답')).held
    expect(held?.answer).toBe('돌리는 중')
    expect(heldStarts(held, { turnId: 't3', text: handBack('someone-else') }).held?.turnId).toBeUndefined()
  })

  it('ends with the last answer after a quiet spell when no hand-back turn comes', () => {
    // The agent ended inside the message's turn, so its hand-back was folded into that turn.
    let held = heldSpawned(heldStarts(sent, { turnId: 't1', text: sent.text }).held, 'a1')
    held = heldEnds(held, end('a-run', 'done', { agentId: 'a1' })).held
    held = heldEnds(held, end('t1', '에이전트가 찾은 답')).held
    expect(heldQuiet(held, QUIET_MS - 1)).toBeUndefined()
    expect(heldQuiet(held, QUIET_MS)).toEqual({ answer: '에이전트가 찾은 답' })
  })

  it('tracks only agents a turn of the message starts, and lets go at once when the person interrupts', () => {
    expect(heldSpawned(sent, 'a1')).toBe(sent)
    const held = heldSpawned(heldStarts(sent, { turnId: 't1', text: sent.text }).held, 'a1')
    expect(heldEnds(held, end('t1', '', { isAborted: true }))).toEqual({ held: undefined, done: {} })
  })

  it('waits only for local background subagents of the main loop', () => {
    expect(followsSpawn({ background: true })).toBe(true)
    expect(followsSpawn({ background: false })).toBe(false)
    expect(followsSpawn({ background: true, parentAgentId: 'a0' })).toBe(false)
    expect(followsSpawn({ background: true, isTeammate: true })).toBe(false)
    expect(followsSpawn({ background: true, workflow: { name: 'review' } })).toBe(false)
  })

  it('stops waiting for an agent the engine lists as ended or no longer lists', () => {
    const held = heldSpawned(heldSpawned(heldStarts(sent, { turnId: 't1', text: sent.text }).held, 'a1'), 'a2')
    expect(heldPrune(held, [{ id: 'a1', status: 'running' }, { id: 'a2', status: 'waiting' }])).toBe(held)
    expect(heldPrune(held, [{ id: 'a1', status: 'killed' }, { id: 'a2', status: 'running' }])?.running).toEqual(['a2'])
    expect(heldPrune(held, [])?.running).toEqual([])
    // Still unreported, so a hand-back turn may yet start: only the quiet spell ends it.
    const waiting = heldEnds(heldPrune(held, []), end('t1', '돌리는 중')).held
    expect(waiting?.turnId).toBeUndefined()
    expect(heldQuiet(waiting, QUIET_MS)).toEqual({ answer: '돌리는 중' })
  })

  it('takes the next answer for a message it held across a reload', () => {
    const restored: Held = { id: 'msg1', text: sent.text, isWorking: true }
    expect(heldEnds(restored, end('t9', '답')).done).toEqual({ answer: '답' })
    expect(heldEnds(restored, end('t9', '', { isAborted: true })).done).toEqual({ answer: undefined })
  })

  it('reads which agent a hand-back or a task notice reports for', () => {
    expect(reportFrom(handBack('ab53d8821fd57f408'))).toBe('ab53d8821fd57f408')
    expect(reportFrom('<task-notification>\n<task-id>ab53</task-id>\n<status>completed</status>')).toBe('ab53')
    expect(reportFrom('Read math.ts')).toBeUndefined()
    expect(reportFrom('quote: <agent-message from="x">')).toBeUndefined()
  })

  it('has the tools of Duet\'s own conversations, up to date', () => {
    expect(readFileSync(new URL('../mod/hooks/tools.ts', import.meta.url), 'utf8')).toBe(modTools())
  })
})

describe('what the terminal does, for Duet\'s rail', () => {
  it('says the main agent\'s words on one line, cut short, and nothing for a row with no text', () => {
    expect(saidOf([{ type: 'text', text: '테스트를 돌릴게.\n\n  결과를 볼게.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: {} }])).toBe('테스트를 돌릴게. 결과를 볼게.')
    expect(saidOf([{ type: 'thinking', thinking: '...' }, { type: 'tool_use', id: 't1', name: 'Bash', input: {} }])).toBeUndefined()
    expect(saidOf([{ type: 'text', text: '   ' }])).toBeUndefined()
    expect(saidOf('not blocks')).toBeUndefined()
    const long = lineOf('가'.repeat(LINE_MAX + 50))
    expect(long).toHaveLength(LINE_MAX)
    expect(long.endsWith('…')).toBe(true)
  })

  it('says what a call waits on the person for: the question, the plan, or the tool and what it touches', () => {
    const ask = (questions: unknown[]) => waitingOf('AskUserQuestion', { questions })
    expect(ask([{ question: 'URL을 어떤 모양으로 할까?', header: 'URL', options: [], multiSelect: false }])).toEqual({ kind: 'question', text: 'URL을 어떤 모양으로 할까?' })
    expect(ask([{ question: '첫째?' }, { question: '둘째?' }, { question: '셋째?' }])).toEqual({ kind: 'question', text: '첫째? (외 2개)' })
    expect(ask([])).toEqual({ kind: 'question', text: '질문' })
    expect(waitingOf('ExitPlanMode', { plan: '...' })).toEqual({ kind: 'permission', text: '계획 승인' })
    expect(waitingOf('Bash', { command: 'npm test\n  -- --run', description: '테스트' })).toEqual({ kind: 'permission', text: 'Bash · npm test -- --run' })
    expect(waitingOf('Edit', { file_path: '/w/a.ts', old_string: 'x', new_string: 'y' })).toEqual({ kind: 'permission', text: 'Edit · /w/a.ts' })
    expect(waitingOf('Write', { file_path: '/w/src/a.ts', content: '' }, '/w')).toEqual({ kind: 'permission', text: 'Write · src/a.ts' })
    expect(waitingOf('Write', { file_path: '/w2/a.ts', content: '' }, '/w')).toEqual({ kind: 'permission', text: 'Write · /w2/a.ts' })
    expect(waitingOf('mcp__x__y', undefined)).toEqual({ kind: 'permission', text: 'mcp__x__y' })
  })
})
