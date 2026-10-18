import type { DiffFile, ReviewComment } from '../../../shared/protocol.ts'

/** Finds a comment's lines again in a fresh diff; marks it outdated when they are gone. */
export function reanchor(comments: ReviewComment[], files: DiffFile[]): ReviewComment[] {
  return comments.map(c => {
    if (c.state === 'resolved') return c
    const f = files.find(x => x.path === c.path)
    if (!f) return { ...c, outdated: true }
    const lines = f.hunks.flatMap(h => h.lines).filter(l => (c.side === 'new' ? l.newNo !== undefined : l.oldNo !== undefined))
    const no = (l: (typeof lines)[number]) => (c.side === 'new' ? l.newNo! : l.oldNo!)
    const textAt = (start: number, end: number) => lines.filter(l => no(l) >= start && no(l) <= end).map(l => l.text).join('\n')
    if (textAt(c.startLine, c.endLine) === c.excerpt) return c.outdated ? { ...c, outdated: false } : c
    const want = c.excerpt.split('\n')
    for (let i = 0; i + want.length <= lines.length; i++) {
      if (want.every((w, j) => lines[i + j].text === w) && no(lines[i + want.length - 1]) - no(lines[i]) === want.length - 1) {
        return { ...c, startLine: no(lines[i]), endLine: no(lines[i + want.length - 1]), outdated: false }
      }
    }
    return { ...c, outdated: true }
  })
}

