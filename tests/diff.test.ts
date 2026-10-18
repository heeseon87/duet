import { describe, expect, it } from 'vitest'
import { parseDiff } from '../server/git/diff.ts'

describe('parseDiff', () => {
  it('numbers lines on both sides and counts changes', () => {
    const raw = [
      'diff --git a/src/a.kt b/src/a.kt',
      'index 111..222 100644',
      '--- a/src/a.kt',
      '+++ b/src/a.kt',
      '@@ -1,3 +1,4 @@ class A',
      ' one',
      '-two',
      '+TWO',
      '+three',
      ' four',
      '',
    ].join('\n')
    const [f] = parseDiff(raw)
    expect(f.path).toBe('src/a.kt')
    expect(f.status).toBe('modified')
    expect([f.additions, f.deletions]).toEqual([2, 1])
    const h = f.hunks[0]
    expect(h.header).toBe('class A')
    expect(h.lines.map(l => [l.type, l.oldNo, l.newNo])).toEqual([
      ['ctx', 1, 1], ['del', 2, undefined], ['add', undefined, 2], ['add', undefined, 3], ['ctx', 3, 4],
    ])
  })

  it('reads renames, new, deleted and binary files', () => {
    const raw = [
      'diff --git a/old/name.ts b/new/name.ts',
      'similarity index 100%',
      'rename from old/name.ts',
      'rename to new/name.ts',
      'diff --git a/added.md b/added.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/added.md',
      '@@ -0,0 +1 @@',
      '+hello',
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
      '',
    ].join('\n')
    const files = parseDiff(raw)
    expect(files.map(f => [f.path, f.status, f.oldPath])).toEqual([
      ['new/name.ts', 'renamed', 'old/name.ts'],
      ['added.md', 'added', undefined],
      ['gone.txt', 'deleted', undefined],
      ['logo.png', 'binary', undefined],
    ])
    expect(files[3].binary).toBe(true)
  })

  it('ignores "no newline" markers and keeps blank context lines', () => {
    const raw = [
      'diff --git a/x.txt b/x.txt',
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1,2 +1,2 @@',
      ' ',
      '-a',
      '\\ No newline at end of file',
      '+b',
      '\\ No newline at end of file',
      '',
    ].join('\n')
    const [f] = parseDiff(raw)
    expect(f.hunks[0].lines.map(l => l.type)).toEqual(['ctx', 'del', 'add'])
  })

  it('unquotes paths with special characters', () => {
    const raw = [
      'diff --git "a/sp ace\\ttab.md" "b/sp ace\\ttab.md"',
      '--- "a/sp ace\\ttab.md"',
      '+++ "b/sp ace\\ttab.md"',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      '',
    ].join('\n')
    expect(parseDiff(raw)[0].path).toBe('sp ace\ttab.md')
  })
})
