import { join } from 'node:path'
import type { DiffSource, ReviewComment } from '../../shared/protocol.ts'
import { DUET_HOME, readJson, slugOf, writeJson } from '../util.ts'

/** One review's comments live under a key made from what was compared. */
export function sourceKey(source: DiffSource): string {
  switch (source.kind) {
    case 'working': return 'working'
    case 'branch': return `branch:${source.base}...${source.compare}`
    case 'commits': return `commits:${source.from ?? ''}..${source.to}`
    case 'turn': return `turn:${source.sessionId}:${source.turnId ?? 'last'}`
    case 'pr': return `pr:${source.number ?? 'branch'}`
  }
}

type Book = Record<string, ReviewComment[]>

const file = (workspace: string) => join(DUET_HOME, 'reviews', `${slugOf(workspace)}.json`)

export function readComments(workspace: string, key: string): ReviewComment[] {
  return readJson<Book>(file(workspace), {})[key] ?? []
}

export function writeComments(workspace: string, key: string, comments: ReviewComment[]): void {
  const book = readJson<Book>(file(workspace), {})
  if (comments.length) book[key] = comments
  else delete book[key]
  writeJson(file(workspace), book)
}

/** The prompt a batch of review comments becomes: each one with its place, its code and the note. */
export function reviewPrompt(comments: ReviewComment[], header: string, extra?: string): string {
  const parts = [`${header} — 코멘트 ${comments.length}개`, '']
  comments.forEach((c, i) => {
    const range = c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`
    parts.push(`### ${i + 1}. \`${c.path}:${range}\`${c.side === 'old' ? ' (삭제된 쪽)' : ''}`)
    if (c.excerpt.trim()) parts.push('```', c.excerpt, '```')
    parts.push(c.body.trim(), '')
  })
  if (extra?.trim()) parts.push('---', extra.trim())
  return parts.join('\n')
}
