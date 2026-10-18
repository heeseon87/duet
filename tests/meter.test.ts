import { describe, expect, it } from 'vitest'
import { contextOf, metered, type Meter } from '../server/agent/meter.ts'
import type { SdkMessage } from '../shared/protocol.ts'

const call = (read: { input?: number; cacheRead?: number; cacheWrite?: number }, extra: { model?: string; parent?: string } = {}): SdkMessage => ({
  type: 'assistant',
  parent_tool_use_id: extra.parent ?? null,
  message: { model: extra.model ?? 'claude-opus-5-5', usage: { input_tokens: read.input ?? 0, cache_read_input_tokens: read.cacheRead ?? 0, cache_creation_input_tokens: read.cacheWrite ?? 0, output_tokens: 900 } },
})
const result = (summed: number, windows: Record<string, number>): SdkMessage => ({
  type: 'result',
  subtype: 'success',
  usage: { input_tokens: 0, cache_read_input_tokens: summed, cache_creation_input_tokens: 0 },
  modelUsage: Object.fromEntries(Object.entries(windows).map(([m, w]) => [m, { contextWindow: w }])),
})
const run = (msgs: SdkMessage[], from: Meter = {}) => msgs.reduce(metered, from)

describe('contextOf', () => {
  it('counts what one main-agent call read: fresh input, cache reads and cache writes', () => {
    expect(contextOf(call({ input: 2, cacheRead: 349_656, cacheWrite: 313 }))).toBe(349_971)
  })
  it('ignores subagent calls, synthetic replies and calls that read nothing', () => {
    expect(contextOf(call({ cacheRead: 80_000 }, { parent: 'toolu_1' }))).toBeUndefined()
    expect(contextOf(call({}, { model: '<synthetic>' }))).toBeUndefined()
    expect(contextOf(call({}))).toBeUndefined()
    expect(contextOf(result(20_960_000, { 'claude-opus-5-5': 1_000_000 }))).toBeUndefined()
  })
})

describe('metered', () => {
  it("follows the latest call, not the turn's summed usage, and takes the window of that call's model", () => {
    const m = run([call({ cacheRead: 120_000 }), call({ cacheRead: 200_000 }, { parent: 'toolu_1' }), call({ input: 5, cacheRead: 349_966 }), result(20_960_000, { 'claude-haiku-5-5': 200_000, 'claude-opus-5-5': 1_000_000 })])
    expect(m.tokens).toBe(349_971)
    expect(m.window).toBe(1_000_000)
  })
  it('keeps the value through a turn with no model call (a local command)', () => {
    const before = run([call({ cacheRead: 349_971 }), result(1, { 'claude-opus-5-5': 1_000_000 })])
    const after = run([{ type: 'assistant', parent_tool_use_id: null, message: { model: '<synthetic>', usage: { input_tokens: 0 } } }, result(0, { 'claude-opus-5-5': 1_000_000 })], before)
    expect(after).toBe(before)
  })
  it('drops with the first call after a compaction', () => {
    const m = run([call({ cacheRead: 900_000 }), { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 900_000, post_tokens: 5_000 } }])
    expect(run([call({ cacheRead: 28_000 })], m).tokens).toBe(28_000)
  })
  it('leaves the window unknown when the result has no entry for the model', () => {
    expect(run([call({ cacheRead: 1000 }), result(1000, { 'claude-haiku-5-5': 200_000 })]).window).toBeUndefined()
  })
})
