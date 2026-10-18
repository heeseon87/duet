import { describe, expect, it } from 'vitest'
import { reanchor } from '../web/src/review/anchor.ts'
import type { DiffFile, ReviewComment } from '../shared/protocol.ts'

const file = (lines: string[], start = 1): DiffFile => ({
  path: 'a.kt', status: 'modified', additions: lines.length, deletions: 0,
  hunks: [{ header: '', oldStart: start, oldLines: 0, newStart: start, newLines: lines.length, lines: lines.map((t, i) => ({ type: 'add' as const, text: t, newNo: start + i })) }],
})
const comment = (start: number, end: number, excerpt: string): ReviewComment => ({
  id: 'c', path: 'a.kt', side: 'new', startLine: start, endLine: end, excerpt, body: 'b', created: 0, state: 'draft',
})

describe('reanchor', () => {
  it('keeps a comment whose lines did not move', () => {
    const [c] = reanchor([comment(2, 3, 'two\nthree')], [file(['one', 'two', 'three'])])
    expect([c.startLine, c.endLine, c.outdated]).toEqual([2, 3, undefined])
  })
  it('follows lines that moved down', () => {
    const [c] = reanchor([comment(2, 3, 'two\nthree')], [file(['zero', 'one', 'two', 'three'])])
    expect([c.startLine, c.endLine, c.outdated]).toEqual([3, 4, false])
  })
  it('marks a comment outdated when its lines are gone', () => {
    const [c] = reanchor([comment(2, 2, 'two')], [file(['one', 'TWO'])])
    expect(c.outdated).toBe(true)
  })
})
