import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { argsOf, duetHomeOf, heardPin, labelOf, linkOf, matchMap, newMapOf, noRepo, pinNote, runDuet, shownMap, statusText, unreachable, type MapSummary } from '../mod/hooks/duet.ts'
import { modTools } from '../scripts/mod-tools.ts'

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

  it('has the tools of Duet\'s own conversations, up to date', () => {
    expect(readFileSync(new URL('../mod/hooks/tools.ts', import.meta.url), 'utf8')).toBe(modTools())
  })
})
