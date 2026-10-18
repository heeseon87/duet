import { describe, expect, it } from 'vitest'
import { composePrompt } from '../server/agent/session.ts'
import type { ContextItem } from '../shared/protocol.ts'

const review = (over: Partial<Extract<ContextItem, { kind: 'review-view' }>> = {}): ContextItem => ({
  kind: 'review-view', label: '리뷰: feat · Changes · 파일 2개', root: '/w/worktrees/feat', source: { kind: 'working' },
  base: 'a1b2c3', head: 'WORKTREE', files: ['src/A.kt', 'src/B.kt'], total: 2, ...over,
})

describe('composePrompt', () => {
  it('leaves a message without context as typed', () => {
    expect(composePrompt('hi')).toBe('hi')
  })

  it('names the review on screen: its repo, the diff against the tree on disk with untracked files, and the files', () => {
    const p = composePrompt('review it', [review()])
    expect(p.startsWith('review it\n\n<context from Duet>\n')).toBe(true)
    expect(p).toContain('/w/worktrees/feat')
    expect(p).toContain('uncommitted changes')
    expect(p).toContain('`git -C /w/worktrees/feat diff a1b2c3`')
    expect(p).toContain('`git -C /w/worktrees/feat ls-files --others --exclude-standard`')
    expect(p).toContain('  - src/A.kt\n  - src/B.kt')
    expect(p).not.toContain('more')
  })

  it('diffs two commits when the head is not the tree on disk, with no untracked note', () => {
    const p = composePrompt('this', [review({ source: { kind: 'commits', from: 'aaa', to: 'bbb' }, base: 'aaa111', head: 'bbb222' })])
    expect(p).toContain('`git -C /w/worktrees/feat diff aaa111 bbb222`')
    expect(p).not.toContain('ls-files')
  })

  it('reproduces a pull request with gh from the repo', () => {
    expect(composePrompt('this', [review({ source: { kind: 'pr', number: 12 }, head: 'ccc' })])).toContain('`cd /w/worktrees/feat && gh pr diff 12`')
    expect(composePrompt('this', [review({ source: { kind: 'pr' }, head: 'ccc' })])).toContain('`cd /w/worktrees/feat && gh pr diff`')
  })

  it('quotes a repo path with spaces in the command', () => {
    expect(composePrompt('this', [review({ root: "/w/my repo's" })])).toContain(`\`git -C '/w/my repo'\\''s' diff a1b2c3\``)
  })

  it('says how many files the capped list leaves out, and the map part it is narrowed to', () => {
    const files = Array.from({ length: 60 }, (_, i) => `f${i}.ts`)
    const p = composePrompt('this', [review({ files, total: 75, scope: 'process (응용 계층)' })])
    expect(p).toContain('The 75 files on screen:')
    expect(p).toContain('  - f59.ts\n  - … and 15 more')
    expect(p).toContain('"process (응용 계층)"')
  })

  it('names the map on screen, its revision and selection, and the tool that reads it', () => {
    const p = composePrompt('explain this', [{ kind: 'map-view', label: '지도: 워커', map: 'worker', title: '워커 구조', revision: 7, selected: 'Pool (작업 풀)' }])
    expect(p).toContain('"워커 구조"')
    expect(p).toContain('canvas map "worker", rev 7')
    expect(p).toContain('Pool (작업 풀) selected')
    expect(p).toContain('mcp__duet__canvas_read')
  })

  it('keeps hand-attached items and the view together in one block', () => {
    const p = composePrompt('look', [{ kind: 'file', path: 'src/x.ts', label: 'x.ts' }, review()])
    expect(p.match(/<context from Duet>/g)).toHaveLength(1)
    expect(p).toContain('- src/x.ts\n- The review on screen')
  })
})
