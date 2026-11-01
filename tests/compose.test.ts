import { describe, expect, it } from 'vitest'
import { composePrompt } from '../server/agent/session.ts'

describe('composePrompt', () => {
  it('leaves a message without context as typed', () => {
    expect(composePrompt('hi')).toBe('hi')
  })

  it('puts what the person attached in one block after their words', () => {
    const p = composePrompt('look', [
      { kind: 'file', path: 'src/x.ts', label: 'x.ts' },
      { kind: 'canvas', map: 'worker', target: 'Pool', label: '작업 풀' },
      { kind: 'review', path: 'src/y.ts', lines: '12-30', label: 'y.ts:12-30' },
    ])
    expect(p.startsWith('look\n\n<context from Duet>\n')).toBe(true)
    expect(p.match(/<context from Duet>/g)).toHaveLength(1)
    expect(p).toContain('- src/x.ts\n- canvas map "worker", target Pool (작업 풀)\n- src/y.ts:12-30 (y.ts:12-30)')
  })
})
