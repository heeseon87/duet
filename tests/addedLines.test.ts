import { describe, expect, it } from 'vitest'
import type { DiffFile, DiffLine } from '../shared/protocol.ts'
import { addedLines } from '../web/src/review/diffModel.ts'

const fileOf = (lines: DiffLine[], extra: Partial<DiffFile> = {}): DiffFile =>
  ({ path: 'a.kt', status: 'modified', additions: 0, deletions: 0, hunks: [{ header: '@@', oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines }], ...extra }) as DiffFile

describe('addedLines', () => {
  it('marks only the changed words of a line that replaced one much like it', () => {
    const added = addedLines(fileOf([
      { type: 'ctx', text: 'class A {', oldNo: 1, newNo: 1 },
      { type: 'del', text: '  val limit = 50', oldNo: 2 },
      { type: 'add', text: '  val limit = 500', newNo: 2 },
      { type: 'add', text: '  fun brandNew() = Unit', newNo: 3 },
    ]))
    expect([...added.keys()]).toEqual([2, 3])
    expect(added.get(2)?.filter(s => s.changed).map(s => s.text)).toEqual(['500'])
    expect(added.get(2)?.map(s => s.text).join('')).toBe('  val limit = 500')
    expect(added.get(3)).toBeUndefined()
  })
  it('has nothing for a binary or large file, or none at all', () => {
    const lines: DiffLine[] = [{ type: 'add', text: 'x', newNo: 1 }]
    expect(addedLines(fileOf(lines, { binary: true })).size).toBe(0)
    expect(addedLines(fileOf(lines, { large: true })).size).toBe(0)
    expect(addedLines(undefined).size).toBe(0)
  })
})
