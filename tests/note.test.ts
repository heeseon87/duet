import { describe, expect, it } from 'vitest'
import { emptyMap, relationKey, type CanvasMap } from '../shared/canvas.ts'
import { noteOf } from '../web/src/canvas/note.ts'

const map = (): CanvasMap => ({
  ...emptyMap('class', 'notes'),
  elements: [{ id: 'A', label: '워커', note: ' 큐의 행만 처리한다 ' }, { id: 'B' }, { id: 'C', note: '   ' }],
  relations: [{ from: 'A', to: 'B', label: 'call' }],
})

describe('noteOf', () => {
  it('gives the picked part its name and trimmed note', () => {
    expect(noteOf(map(), 'A')).toEqual({ label: '워커', note: '큐의 행만 처리한다' })
  })

  it('has nothing for a part without a note, a blank note, a line, or no pick', () => {
    expect(noteOf(map(), 'B')).toBeUndefined()
    expect(noteOf(map(), 'C')).toBeUndefined()
    expect(noteOf(map(), relationKey(map().relations[0]))).toBeUndefined()
    expect(noteOf(map(), undefined)).toBeUndefined()
  })
})
