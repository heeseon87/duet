import { readFile, stat, copyFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { DiffFile, DiffHunk, DiffLine, DiffResult, DiffSource } from '../../shared/protocol.ts'
import { git, HttpError, newId } from '../util.ts'
import { isSafeRef } from './repo.ts'
import { prDiff, prView } from './pr.ts'

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '-M', '--src-prefix=a/', '--dst-prefix=b/']
/** A file with more diff lines than this comes back folded; the browser asks for it alone. */
const LARGE_FILE_LINES = 4000
const UNTRACKED_MAX_BYTES = 1024 * 1024

export type DiffOptions = { context?: number; ignoreWhitespace?: boolean; path?: string }

export type TurnSnapshots = (sessionId: string, turnId?: string) => Promise<{ before: string; after?: string; label: string } | undefined>

export async function computeDiff(root: string, source: DiffSource, opts: DiffOptions, turns: TurnSnapshots): Promise<DiffResult> {
  const flags = [...DIFF_FLAGS, `-U${opts.context ?? 3}`]
  if (opts.ignoreWhitespace) flags.push('-w')
  const only = opts.path ? ['--', opts.path] : []
  const hasHead = !!(await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true })).trim()
  let raw = ''
  let oldRef: string, newRef: string, oldLabel: string, newLabel: string
  let withUntracked = false

  switch (source.kind) {
    case 'working': {
      oldRef = hasHead ? await resolveRef(root, 'HEAD') : EMPTY_TREE
      newRef = 'WORKTREE'
      oldLabel = 'HEAD'
      newLabel = 'Working tree'
      raw = await git(root, ['diff', ...flags, oldRef, ...only], { maxBuffer: 256 * 1024 * 1024 })
      withUntracked = true
      break
    }
    case 'branch': {
      if (!isSafeRef(source.base)) throw new HttpError(400, 'bad base ref')
      const compareWorktree = source.compare === 'WORKTREE'
      if (!compareWorktree && !isSafeRef(source.compare)) throw new HttpError(400, 'bad compare ref')
      const tip = compareWorktree ? 'HEAD' : source.compare
      const mb = (await git(root, ['merge-base', source.base, tip], { allowFail: true })).trim()
      if (!mb) throw new HttpError(400, `merge base 없음: ${source.base} ↔ ${tip}`)
      oldRef = mb
      const base = /^[0-9a-f]{40}$/.test(source.base) ? source.base.slice(0, 7) : source.base
      oldLabel = mb === source.base ? base : `${base} (merge base ${mb.slice(0, 7)})`
      if (compareWorktree) {
        newRef = 'WORKTREE'
        newLabel = 'Working tree'
        raw = await git(root, ['diff', ...flags, mb, ...only], { maxBuffer: 256 * 1024 * 1024 })
        withUntracked = true
      } else {
        newRef = await resolveRef(root, source.compare)
        newLabel = source.compare
        raw = await git(root, ['diff', ...flags, mb, newRef, ...only], { maxBuffer: 256 * 1024 * 1024 })
      }
      break
    }
    case 'commits': {
      if (!isSafeRef(source.to) || (source.from && !isSafeRef(source.from))) throw new HttpError(400, 'bad commit')
      newRef = await resolveRef(root, source.to)
      if (source.from) {
        oldRef = await resolveRef(root, source.from)
        oldLabel = source.from.slice(0, 12)
      } else {
        const parent = (await git(root, ['rev-parse', '--verify', '-q', `${newRef}^`], { allowFail: true })).trim()
        oldRef = parent || EMPTY_TREE
        oldLabel = parent ? `${parent.slice(0, 7)} (parent)` : 'empty tree'
      }
      newLabel = newRef.slice(0, 7)
      raw = await git(root, ['diff', ...flags, oldRef, newRef, ...only], { maxBuffer: 256 * 1024 * 1024 })
      break
    }
    case 'pr': {
      const pr = await prView(root, source.number)
      if (!pr) throw new HttpError(404, '이 브랜치에는 열린 PR이 없어. 위에서 다른 PR을 골라 줘.')
      const haveHead = Boolean((await git(root, ['rev-parse', '--verify', '-q', `${pr.headRefOid}^{commit}`], { allowFail: true })).trim())
      const haveBase = Boolean((await git(root, ['rev-parse', '--verify', '-q', `${pr.baseRefOid}^{commit}`], { allowFail: true })).trim())
      oldLabel = `${pr.baseRefName}`
      newLabel = `#${pr.number} ${pr.headRefName}`
      if (haveHead && haveBase) {
        // Both ends are local: diff like GitHub does (from the merge base), with whole files for context.
        const mb = (await git(root, ['merge-base', pr.baseRefOid, pr.headRefOid], { allowFail: true })).trim() || pr.baseRefOid
        oldRef = mb
        newRef = pr.headRefOid
        raw = await git(root, ['diff', ...flags, mb, pr.headRefOid, ...only], { maxBuffer: 256 * 1024 * 1024 })
      } else {
        // Not fetched here: take GitHub's patch; whole-file context is then unavailable.
        oldRef = pr.baseRefOid
        newRef = pr.headRefOid
        raw = await prDiff(root, pr.number)
      }
      break
    }
    case 'turn': {
      const snap = await turns(source.sessionId, source.turnId)
      if (!snap) throw new HttpError(404, '이 대화에는 아직 턴이 없어')
      oldRef = snap.before
      newRef = snap.after ?? (await snapshot(root)) ?? 'WORKTREE'
      oldLabel = `${snap.label} 시작`
      newLabel = snap.after ? `${snap.label} 끝` : `${snap.label} 진행 중`
      raw = await git(root, ['diff', ...flags, oldRef, newRef, ...only], { maxBuffer: 256 * 1024 * 1024 })
      break
    }
  }

  const files = parseDiff(raw)
  if (withUntracked) files.push(...(await untrackedFiles(root, opts.path)))
  for (const f of files) {
    const lines = f.hunks.reduce((n, h) => n + h.lines.length, 0)
    if (!opts.path && lines > LARGE_FILE_LINES) {
      f.large = true
      f.hunks = []
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { workspace: root, source, oldRef, newRef, oldLabel, newLabel, files, generatedAt: Date.now() }
}

async function resolveRef(root: string, ref: string): Promise<string> {
  const sha = (await git(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`], { allowFail: true })).trim()
  if (!sha) throw new HttpError(400, `없는 ref: ${ref}`)
  return sha
}

async function untrackedFiles(root: string, only?: string): Promise<DiffFile[]> {
  const out = await git(root, ['ls-files', '--others', '--exclude-standard', '-z', ...(only ? ['--', only] : [])])
  const files: DiffFile[] = []
  for (const path of out.split('\0').filter(Boolean)) {
    const abs = resolve(root, path)
    let size = 0
    try {
      const st = await stat(abs)
      if (!st.isFile()) continue
      size = st.size
    } catch {
      continue
    }
    if (size > UNTRACKED_MAX_BYTES) {
      files.push({ path, status: 'untracked', additions: 0, deletions: 0, hunks: [], large: true })
      continue
    }
    const buf = await readFile(abs)
    if (buf.subarray(0, 8000).includes(0)) {
      files.push({ path, status: 'untracked', additions: 0, deletions: 0, hunks: [], binary: true })
      continue
    }
    const text = buf.toString('utf8')
    const lines = text.split('\n')
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    const hunkLines: DiffLine[] = lines.map((t, i) => ({ type: 'add', text: t, newNo: i + 1 }))
    files.push({
      path,
      status: 'untracked',
      additions: hunkLines.length,
      deletions: 0,
      hunks: hunkLines.length ? [{ header: '', oldStart: 0, oldLines: 0, newStart: 1, newLines: hunkLines.length, lines: hunkLines }] : [],
    })
  }
  return files
}

function unquote(p: string): string {
  if (!p.startsWith('"')) return p
  // C-style quoting from git; core.quotepath=off keeps UTF-8 as is, so only escapes remain.
  return p.slice(1, -1).replace(/\\(["\\tnr])/g, (_, c) => ({ t: '\t', n: '\n', r: '\r' } as Record<string, string>)[c] ?? c)
}

function stripPrefix(p: string): string {
  const u = unquote(p.trim())
  return u.replace(/^[ab]\//, '')
}

/** Unified diff text → files, hunks, numbered lines. */
export function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | undefined
  let hunk: DiffHunk | undefined
  let oldNo = 0, newNo = 0
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/.exec(line)
      file = { path: m ? unquote(m[2]) : line.slice(11), status: 'modified', additions: 0, deletions: 0, hunks: [] }
      if (m && m[1] !== m[2]) file.oldPath = unquote(m[1])
      files.push(file)
      hunk = undefined
      continue
    }
    if (!file) continue
    if (!hunk) {
      if (line.startsWith('new file mode')) file.status = 'added'
      else if (line.startsWith('deleted file mode')) file.status = 'deleted'
      else if (line.startsWith('rename from ')) { file.oldPath = line.slice(12); file.status = 'renamed' }
      else if (line.startsWith('rename to ')) file.path = line.slice(10)
      else if (line.startsWith('Binary files ')) { file.binary = true; if (file.status === 'modified') file.status = 'binary' }
      else if (line.startsWith('--- ')) { const p = line.slice(4); if (p !== '/dev/null') file.oldPath = file.status === 'renamed' ? stripPrefix(p) : file.oldPath }
      else if (line.startsWith('+++ ')) { const p = line.slice(4); if (p !== '/dev/null') file.path = stripPrefix(p) }
    }
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line)
      if (!m) continue
      hunk = { header: m[5] ?? '', oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], lines: [] }
      oldNo = hunk.oldStart
      newNo = hunk.newStart
      file.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    const c = line[0]
    if (c === ' ') { hunk.lines.push({ type: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ }) }
    else if (c === '+') { hunk.lines.push({ type: 'add', text: line.slice(1), newNo: newNo++ }); file.additions++ }
    else if (c === '-') { hunk.lines.push({ type: 'del', text: line.slice(1), oldNo: oldNo++ }); file.deletions++ }
    else if (c === '\\') { /* "\ No newline at end of file" */ }
    else if (line === '' && i < lines.length - 1) { hunk.lines.push({ type: 'ctx', text: '', oldNo: oldNo++, newNo: newNo++ }) }
  }
  for (const f of files) if (f.oldPath === f.path) delete f.oldPath
  return files
}

/**
 * A tree id for everything in the working tree right now, tracked or not (ignored files aside).
 * Uses a copy of the index, so the real index, the stash and the work tree are never touched;
 * only new blob/tree objects land in the object store.
 */
export async function snapshot(root: string): Promise<string | undefined> {
  const indexPath = (await git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'index'], { allowFail: true })).trim()
  if (!indexPath) return undefined
  const tmp = join(tmpdir(), `duet-index-${newId()}`)
  try {
    if (existsSync(indexPath)) await copyFile(indexPath, tmp)
    const env = { GIT_INDEX_FILE: tmp }
    if (!existsSync(tmp)) {
      const head = (await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true })).trim()
      if (head) await git(root, ['read-tree', head], { env })
    }
    await git(root, ['add', '-A'], { env, timeout: 120_000 })
    return (await git(root, ['write-tree'], { env })).trim() || undefined
  } catch {
    return undefined
  } finally {
    await rm(tmp, { force: true })
  }
}
