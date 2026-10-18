import { useEffect, useMemo, useRef, useState } from 'react'
import { Folder, FolderGit2, FolderOpen, GitBranch, CornerDownLeft, Loader2 } from 'lucide-react'
import type { Workspace } from '../../../shared/protocol.ts'
import { api, q } from '../api.ts'
import { fuzzy } from './files.ts'
import { relTime } from './ui.tsx'

type Dir = { path: string; name: string; display: string; repo: boolean }
type Found = { path: string; name: string; display: string; worktree: boolean; main?: string }
type Row = {
  key: string
  path: string
  name: string
  display: string
  icon: 'repo' | 'worktree' | 'dir' | 'recent'
  /** Enter opens a repo; on a plain folder it walks into it. */
  action: 'open' | 'descend'
  meta?: string
  section?: string
}

const HOME_HINT = /^(~|\/|\.)/

let foundCache: Found[] | undefined

/**
 * One box for every way to reach a repo: recent ones, worktrees of this repo, repos found under
 * home (type a name), or a path typed from `~/` that walks folder by folder.
 */
export function RepoPicker({ recents, current, worktrees = [], onOpen, autoFocus, listHeight }: {
  recents: Workspace[]
  current?: string
  worktrees?: { path: string; branch?: string; head?: string }[]
  onOpen: (path: string) => Promise<void> | void
  autoFocus?: boolean
  listHeight?: string
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [found, setFound] = useState<Found[] | undefined>(foundCache)
  const [dirs, setDirs] = useState<{ prefix: string; here?: Dir; dirs: Dir[] } | undefined>()
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const isPath = HOME_HINT.test(query)

  useEffect(() => {
    let live = true
    void api.get<Found[]>('/api/fs/repos').then(r => { foundCache = r; if (live) setFound(r) }).catch(() => { if (live) setFound([]) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!isPath) return
    let live = true
    const t = setTimeout(() => {
      // A server older than this page answers with a bare array.
      void api.get<{ here?: Dir; dirs: Dir[] } | Dir[]>(`/api/fs/dirs${q({ prefix: query })}`)
        .then(r => { if (live) setDirs({ prefix: query, ...(Array.isArray(r) ? { dirs: r } : r) }) })
        .catch(() => undefined)
    }, 90)
    return () => { live = false; clearTimeout(t) }
  }, [query, isPath])

  const rows: Row[] = useMemo(() => {
    const others = recents.filter(w => w.path !== current)
    const known = new Set([current, ...others.map(w => w.path), ...worktrees.map(w => w.path)])
    const wtRows: Row[] = worktrees.filter(w => w.path !== current).map(w => ({
      key: `w:${w.path}`, path: w.path, name: w.path.split('/').pop() ?? w.path, display: tilde(w.path), icon: 'worktree', action: 'open', meta: w.branch ?? w.head?.slice(0, 7), section: '이 저장소의 워크트리',
    }))
    const recentRows: Row[] = others.map(w => ({
      key: `r:${w.path}`, path: w.path, name: w.name, display: tilde(w.path), icon: 'recent', action: 'open', meta: relTime(w.lastOpened), section: '최근 작업 공간',
    }))
    // Repos first; worktrees of other repos after them, where they do not bury the repos.
    const foundRows: Row[] = (found ?? []).filter(f => !known.has(f.path)).sort((a, b) => Number(a.worktree) - Number(b.worktree)).map(f => ({
      key: `f:${f.path}`, path: f.path, name: f.name, display: f.display, icon: f.worktree ? 'worktree' : 'repo', action: 'open', meta: f.worktree ? f.main : undefined, section: f.worktree ? '다른 저장소의 워크트리' : '내 저장소',
    }))
    if (isPath) {
      if (!dirs) return []
      const out: Row[] = []
      if (dirs.here?.repo) out.push({ key: `h:${dirs.here.path}`, path: dirs.here.path, name: dirs.here.name, display: dirs.here.display, icon: 'repo', action: 'open', meta: '이 저장소 열기' })
      for (const d of dirs.dirs) out.push({ key: `d:${d.path}`, path: d.path, name: d.name, display: d.display, icon: d.repo ? 'repo' : 'dir', action: d.repo ? 'open' : 'descend', meta: d.repo ? 'git 저장소' : undefined })
      return out
    }
    const text = query.trim()
    if (!text) return [...wtRows, ...recentRows, ...foundRows]
    return [...wtRows, ...recentRows, ...foundRows]
      .map(r => ({ r, s: Math.max(fuzzy(r.name, text) * 2, fuzzy(r.display, text)) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 80)
      .map(x => ({ ...x.r, section: undefined }))
  }, [recents, current, worktrees, found, isPath, dirs, query])

  useEffect(() => { setActive(0) }, [query])
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = async (row: Row | undefined) => {
    if (!row) {
      if (query.trim()) await open(query.trim())
      return
    }
    if (row.action === 'descend') {
      setQuery(row.display + '/')
      input.current?.focus()
      return
    }
    await open(row.path)
  }
  const open = async (path: string) => {
    setBusy(true)
    try { await onOpen(path) } finally { setBusy(false) }
  }

  let lastSection: string | undefined
  return (
    <div className="repo-picker">
      <div className="rp-search">
        {busy ? <Loader2 size={15} className="spin" /> : <FolderOpen size={15} />}
        <input
          ref={input}
          value={query}
          autoFocus={autoFocus}
          spellCheck={false}
          placeholder="저장소 이름으로 찾기, 또는 ~/ 부터 경로 입력"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(rows.length - 1, a + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
            else if (e.key === 'Tab' && rows.length) {
              // Tab always walks into the folder, repo or not, so its subfolders show next.
              e.preventDefault()
              const r = rows[active] ?? rows[0]
              setQuery((isPath ? r.display : tilde(r.path)) + '/')
            } else if (e.key === 'Enter') { e.preventDefault(); void run(rows[active]) }
          }}
        />
      </div>
      <div className="rp-list" ref={list} style={listHeight ? { maxHeight: listHeight } : undefined}>
        {rows.map((r, i) => {
          const head = r.section && r.section !== lastSection ? r.section : undefined
          lastSection = r.section
          return (
            <div key={r.key}>
              {head && <div className="menu-label">{head}</div>}
              <button className="rp-row" data-active={i === active} onMouseMove={() => { if (i !== active) setActive(i) }} onClick={() => void run(r)}>
                {r.icon === 'worktree' ? <GitBranch size={15} className="rp-icon repo" /> : r.icon === 'repo' ? <FolderGit2 size={15} className="rp-icon repo" /> : r.icon === 'recent' ? <FolderGit2 size={15} className="rp-icon" /> : <Folder size={15} className="rp-icon" />}
                <span className="rp-text">
                  <span className="rp-name">{r.name}</span>
                  <span className="rp-path"><bdi>{r.display}</bdi></span>
                </span>
                {r.meta && <span className="rp-meta">{r.meta}</span>}
                {i === active && <CornerDownLeft size={12} className="rp-enter" />}
              </button>
            </div>
          )
        })}
        {!rows.length && (
          <div className="rp-empty">
            {isPath ? (dirs ? '하위 폴더가 없어. ⏎를 누르면 입력한 경로를 그대로 열어.' : '폴더를 읽는 중…') : found === undefined ? <><Loader2 size={12} className="spin" /> 저장소를 찾는 중…</> : query ? '맞는 저장소가 없어. ~/ 부터 경로를 입력해 봐.' : '최근 작업 공간이 없어. ~/ 부터 경로를 입력해 봐.'}
          </div>
        )}
      </div>
      <div className="rp-foot">
        <span><kbd>↑↓</kbd> 이동</span>
        <span><kbd>⏎</kbd> {rows[active]?.action === 'descend' ? '폴더 들어가기' : '열기'}</span>
        <span><kbd>Tab</kbd> 하위 폴더 보기</span>
        <span className="grow" />
        <span className="muted">{found ? `저장소 ${found.length}개 찾음` : ''}</span>
      </div>
    </div>
  )
}

function tilde(path: string): string {
  const m = /^\/Users\/[^/]+|^\/home\/[^/]+/.exec(path)
  return m ? '~' + path.slice(m[0].length) : path
}
