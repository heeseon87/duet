import { describe, expect, it } from 'vitest'
import { visualCols, widestCols } from '../web/src/review/diffModel.ts'

describe('visualCols', () => {
  it('counts ASCII one column each', () => expect(visualCols('const x = 1')).toBe(11))
  it('moves a tab to the next stop of four', () => {
    expect(visualCols('\tx')).toBe(5)
    expect(visualCols('ab\tx')).toBe(5)
  })
  it('counts Korean and emoji as two columns', () => {
    expect(visualCols('썸네일')).toBe(6)
    expect(visualCols('a🙂')).toBe(3)
  })
  it('finds the widest line', () => expect(widestCols(['a', '한글한글', 'abcdefg'])).toBe(8))
})
