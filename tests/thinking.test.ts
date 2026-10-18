import { describe, expect, it } from 'vitest'
import { thinkingGist } from '../web/src/agent/transcript.ts'

describe('thinkingGist', () => {
  it('joins the bold titles of summarized thinking', () => {
    expect(thinkingGist('**Reading the diff**\n\nThe change moves ffmpeg.\n\n**Planning the reply**\n\nI will answer in Korean.')).toBe('Reading the diff · Planning the reply')
  })
  it('falls back to the opening words, without markdown', () => {
    expect(thinkingGist('Let me check `SourceResolver.kt` first.\nThen the worker.')).toBe('Let me check SourceResolver.kt first. Then the worker.')
  })
  it('ignores bold words inside a sentence', () => {
    expect(thinkingGist('The **old** path stays.')).toBe('The old path stays.')
  })
})
