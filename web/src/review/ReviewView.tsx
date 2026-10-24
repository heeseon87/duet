import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ChevronRight, Columns2, FolderGit2, Package, Box, Shapes, GitBranch, GitCommitHorizontal, GitPullRequest, Bot, Check, Loader2, MessageSquare, RefreshCw,
  Rows3, Search, Settings2, X, FilePen, Folder, ArrowLeft, Copy, Map as MapIcon,
} from 'lucide-react'
import type { DiffFile, DiffSource, GitInfo, TurnRef } from '../../../shared/protocol.ts'
import { api, q } from '../api.ts'
import { Popover, relTime, isTypingTarget, useNow } from '../lib/ui.tsx'
import { local, useApp } from '../state.ts'
import { DiffView, STATUS_LETTER } from './DiffView.tsx'
import { CommentsDock } from './Comments.tsx'
import { FileView } from './FileView.tsx'
import { PrPanel, PrPicker } from './PullRequest.tsx'
import { FindBar } from './FindBar.tsx'
import { changedFiles, sourceLabel, turnRefs, useReview } from './store.ts'
import { listedFiles, mapGroups, type MapNode } from './mapGroups.ts'
import { useCanvas } from '../canvas/store.ts'

type LogEntry = { sha: string; short: string; subject: string; author: string; date: number; refs: string }

function SearchList<T>({ items, render, onPick, placeholder, keyOf, filter }: {
  items: T[]; render: (t: T) => React.ReactNode; onPick: (t: T) => void; placeholder: string; keyOf: (t: T) => string; filter: (t: T, q: string) => boolean
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const shown = items.filter(t => filter(t, query.toLowerCase())).slice(0, 80)
  return (
    <div className="search-list">
      <input autoFocus className="input" placeholder={placeholder} value={query} onChange={e => { setQuery(e.target.value); setActive(0) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, shown.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          if (e.key === 'Enter' && shown[active]) { e.preventDefault(); onPick(shown[active]) }
        }} />
      <div className="search-items">
        {shown.map((t, i) => <button key={keyOf(t)} className="menu-item" data-active={i === active} onMouseEnter={() => setActive(i)} onClick={() => onPick(t)}>{render(t)}</button>)}
        {!shown.length && <div className="menu-label">없어</div>}
      </div>
    </div>
  )
}

/** A conversation's turns as seen from a tree, fetched again after each turn it finishes. */
function useTurns(sessionId: string | undefined, root: string | undefined, on = true): TurnRef[] | undefined {
  const done = useApp(s => s.sessions.find(x => x.id === sessionId)?.turns)
  const where = `${sessionId}\0${root}`
  const [got, setGot] = useState<{ where: string; turns: TurnRef[] }>()
  useEffect(() => {
    if (!on || !sessionId || !root) return
    let alive = true
    void turnRefs(sessionId, root).then(turns => { if (alive) setGot({ where, turns }) }).catch(() => undefined)
    return () => { alive = false }
  }, [where, done, on]) // eslint-disable-line react-hooks/exhaustive-deps
  return got?.where === where ? got.turns : undefined
}

function RefPicker({ value, info, onPick, allowWorktree, label, turns }: { value: string; info?: GitInfo; onPick: (v: string) => void; allowWorktree?: boolean; label: string; turns?: TurnRef[] }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  // The commits this conversation's turns started on here, newest first.
  const starts = (turns ?? []).filter(t => t.base).reverse()
  const turn = starts.find(t => t.base!.sha === value)
  const items = useMemo(() => {
    const list: { name: string; sub: string }[] = []
    if (allowWorktree) list.push({ name: 'WORKTREE', sub: `${info?.branch ?? 'HEAD'} + uncommitted changes` })
    for (const b of info?.branches ?? []) list.push({ name: b.name, sub: `${b.remote ? 'remote' : 'local'}${b.current ? ' · current' : ''} · ${relTime(b.updated)}` })
    return list
  }, [info, allowWorktree])
  return (
    <>
      <button ref={ref} className="ref-pick" onClick={() => setOpen(o => !o)}>
        <span className="muted">{label}</span>
        <b>{value === 'WORKTREE' ? 'Working tree' : turn ? `턴 ${turn.n} 직전 · ${value.slice(0, 7)}` : /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 7) : value}</b>
        <ChevronDown size={11} />
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} width={starts.length ? 420 : 340}>
          {starts.length > 0 && <>
            <div className="menu-label">이 대화의 턴 시작 직전</div>
            {starts.map(t => (
              <button key={t.turnId} className="menu-item" aria-checked={t.base!.sha === value} onClick={() => { onPick(t.base!.sha); setOpen(false) }}>
                <span className="grow ellipsis">
                  <span className="ellipsis">턴 {t.n} 시작 직전 <code className="muted">{t.base!.sha.slice(0, 7)}</code> {t.base!.subject}</span>
                  <span className="meta">{relTime(t.base!.date)}</span>
                </span>
              </button>
            ))}
            <div className="menu-sep" />
          </>}
          <SearchList items={items} placeholder="브랜치 찾기" keyOf={t => t.name}
            filter={(t, s) => t.name.toLowerCase().includes(s)}
            render={t => <span className="grow"><span>{t.name === 'WORKTREE' ? 'Working tree' : t.name}</span><span className="meta">{t.sub}</span></span>}
            onPick={t => { onPick(t.name); setOpen(false) }} />
        </Popover>
      )}
    </>
  )
}

function CommitPicker({ root, source, onPick }: { root: string; source: Extract<DiffSource, { kind: 'commits' }>; onPick: (s: DiffSource) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState<LogEntry[] | null>(null)
  const [from, setFrom] = useState<string | undefined>()
  useEffect(() => { if (open && !log) void api.get<LogEntry[]>(`/api/git/log${q({ ws: root, limit: 120 })}`).then(setLog) }, [open, log, root])
  return (
    <>
      <button ref={ref} className="ref-pick" onClick={() => setOpen(o => !o)}>
        <span className="muted">커밋</span>
        <b>{source.from ? `${source.from.slice(0, 7)}..${source.to.slice(0, 7)}` : source.to === 'HEAD' ? 'HEAD' : source.to.slice(0, 7)}</b>
        <ChevronDown size={11} />
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => { setOpen(false); setFrom(undefined) }} width={460}>
          <div className="menu-label">{from ? `범위 끝을 골라 (시작: ${from.slice(0, 7)})` : '커밋 하나를 고르거나, ⇧ 클릭으로 범위의 시작을 정해'}</div>
          {!log && <div className="menu-label"><Loader2 size={12} className="spin" /></div>}
          {log && (
            <SearchList items={log} placeholder="메시지·작성자로 찾기" keyOf={c => c.sha}
              filter={(c, s) => c.subject.toLowerCase().includes(s) || c.author.toLowerCase().includes(s) || c.sha.startsWith(s)}
              render={c => (
                <span className="grow commit-item" onClick={e => { if (e.shiftKey) { e.stopPropagation(); e.preventDefault(); setFrom(c.sha) } }}>
                  <span className="ellipsis"><code className="muted">{c.short}</code> {c.subject}</span>
                  <span className="meta">{c.author} · {relTime(c.date)}{c.refs ? ` · ${c.refs}` : ''}</span>
                </span>
              )}
              onPick={c => { onPick(from ? { kind: 'commits', from, to: c.sha } : { kind: 'commits', to: c.sha }); setOpen(false); setFrom(undefined) }} />
          )}
        </Popover>
      )}
    </>
  )
}

function TurnPicker({ source, onPick }: { source: Extract<DiffSource, { kind: 'turn' }>; onPick: (s: DiffSource) => void }) {
  const { sessions } = useApp()
  const { root, showLastTurn } = useReview()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const session = sessions.find(s => s.id === source.sessionId)
  const turns = useTurns(source.sessionId, root)
  const turn = turns?.find(t => t.turnId === source.turnId)
  const last = (id: string) => { void showLastTurn(id); setOpen(false) }
  return (
    <>
      <button ref={ref} className="ref-pick" onClick={() => setOpen(o => !o)}>
        <span className="muted">대화</span>
        <b className="ellipsis" style={{ maxWidth: 200 }}>{session?.title ?? '선택'}</b>
        {(turn || !source.turnId) && <span className="muted">· {turn ? `턴 ${turn.n}` : '마지막 턴'}</span>}
        <ChevronDown size={11} />
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} width={360}>
          <div className="menu-label">대화</div>
          {sessions.map(s => (
            <button key={s.id} className="menu-item" aria-checked={s.id === source.sessionId} onClick={() => last(s.id)}>
              <span className={`dot ${s.status}`} /><span className="grow ellipsis">{s.title}</span><span className="sub">{s.turns}턴</span>
            </button>
          ))}
          <div className="menu-sep" />
          <div className="menu-label">이 대화의 턴</div>
          <button className="menu-item" onClick={() => last(source.sessionId)}>파일을 바꾼 마지막 턴</button>
          {turns?.map(t => (
            <button key={t.turnId} className={`menu-item ${changedFiles(t) ? '' : 'quiet'}`} aria-checked={t.turnId === source.turnId} onClick={() => { onPick({ kind: 'turn', sessionId: source.sessionId, turnId: t.turnId }); setOpen(false) }}>
              턴 {t.n}<span className="sub">{t.files !== undefined ? `파일 ${t.files}개 · ` : t.wrote ? '기록 없음 · ' : ''}{relTime(t.ended ?? t.started)}</span>
            </button>
          ))}
        </Popover>
      )}
    </>
  )
}

function RootPicker({ info }: { info?: GitInfo }) {
  const { root, home, repos, setRoot } = useReview()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const repo = repos.find(r => r.path === root)
  // Other worktrees of the tree under review (its own list), besides the workspace and the repos below.
  const others = (info?.worktrees ?? []).filter(w => !w.bare && w.path !== home && w.path !== root && !repos.some(r => r.path === w.path))
  const current = info?.worktrees.find(w => w.path === root)
  const choices = root !== home || repos.length > 0 || others.length > 0
  const pick = (path: string) => { if (path !== root) void setRoot(path); setOpen(false) }
  const name = (path?: string) => path?.split('/').pop()
  return (
    <>
      <button ref={ref} className={`ref-pick ${root !== home ? 'other-root' : ''}`} onClick={() => choices && setOpen(o => !o)} title={root}>
        <FolderGit2 size={13} />
        <b className="ellipsis" style={{ maxWidth: 220 }}>{repo ? repo.label : name(root)}</b>
        {root !== home && (repo?.branch ?? current?.branch) && <span className="muted">{repo?.branch ?? current?.branch}</span>}
        {choices && <ChevronDown size={11} />}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} width={460}>
          <div className="menu-label">저장소</div>
          {home && (
            <button className="menu-item" aria-checked={root === home} onClick={() => pick(home)}>
              <span className="grow ellipsis"><span>{name(home)}</span><span className="meta">작업 공간 · {home}</span></span>
            </button>
          )}
          {repos.length > 0 && <div className="menu-label">관련 저장소</div>}
          {repos.map(r => (
            <button key={r.path} className="menu-item" aria-checked={r.path === root} onClick={() => pick(r.path)}>
              <span className="grow ellipsis"><span>{r.label}</span><span className="meta">{[r.branch, r.name, r.sessions.length ? `대화 ${r.sessions.length}개` : '', r.maps.length ? `지도 ${r.maps.length}개` : ''].filter(Boolean).join(' · ')}</span></span>
            </button>
          ))}
          {others.length > 0 && <div className="menu-label">다른 워크트리</div>}
          {others.map(w => (
            <button key={w.path} className="menu-item" onClick={() => pick(w.path)}>
              <span className="grow ellipsis"><span>{name(w.path)}</span><span className="meta">{w.branch ?? w.head?.slice(0, 7)} · {w.path}</span></span>
            </button>
          ))}
        </Popover>
      )}
    </>
  )
}

/** On the workspace while its conversations changed code in another repo: say so, one click away. */
function RepoHint() {
  const { root, home, setRoot } = useReview()
  const repos = useReview(s => s.repos).filter(r => r.sessions.length > 0)
  const key = `review.repoHint:${home}`
  const seen = repos.map(r => r.path).join('|')
  const [dismissed, setDismissed] = useState(() => local.get(key))
  if (!home || root !== home || !repos.length || dismissed === seen) return null
  return (
    <div className="repo-hint">
      <FolderGit2 size={13} />
      <span>대화가 작업 공간 밖 저장소에서 코드를 고쳤어</span>
      {repos.slice(0, 3).map(r => (
        <button key={r.path} className="btn sm" onClick={() => void setRoot(r.path)}>
          <b>{r.label}</b>{r.branch && <span className="muted">{r.branch}</span>}
        </button>
      ))}
      <span className="grow" />
      <button className="iconbtn" title="닫기" onClick={() => { local.set(key, seen); setDismissed(seen) }}><X size={13} /></button>
    </div>
  )
}

const KINDS: { kind: DiffSource['kind']; label: string; icon: React.ReactNode }[] = [
  { kind: 'working', label: 'Changes', icon: <FilePen size={13} /> },
  { kind: 'branch', label: 'Compare', icon: <GitBranch size={13} /> },
  { kind: 'commits', label: 'Commits', icon: <GitCommitHorizontal size={13} /> },
  { kind: 'turn', label: 'Turns', icon: <Bot size={13} /> },
  { kind: 'pr', label: 'PR', icon: <GitPullRequest size={13} /> },
]

function ViewMenu() {
  const { mode, setMode, wrap, ignoreWhitespace, toggle, context, setContext } = useReview()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="seg">
        <button aria-pressed={mode === 'unified'} title="Unified (u)" onClick={() => setMode('unified')}><Rows3 size={13} /></button>
        <button aria-pressed={mode === 'split'} title="Split (s)" onClick={() => setMode('split')}><Columns2 size={13} /></button>
      </div>
      <button ref={ref} className="iconbtn" aria-pressed={!ignoreWhitespace || wrap || context !== 3} title="보기 설정" onClick={() => setOpen(o => !o)}><Settings2 size={14} /></button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} align="end" width={250}>
          <button className="menu-item" aria-checked={ignoreWhitespace} onClick={() => toggle('ignoreWhitespace')}><span className="grow">Hide whitespace changes</span><kbd>w</kbd>{ignoreWhitespace && <Check size={13} />}</button>
          <button className="menu-item" aria-checked={wrap} onClick={() => toggle('wrap')}><span className="grow">Wrap long lines</span>{wrap && <Check size={13} />}</button>
          <div className="menu-sep" />
          <div className="menu-label">Context lines</div>
          <div className="seg" style={{ margin: '2px 6px 6px' }}>
            {[0, 3, 5, 10, 25].map(n => <button key={n} aria-pressed={context === n} onClick={() => setContext(n)}>{n}</button>)}
          </div>
        </Popover>
      )}
    </>
  )
}

/** A bound map holds the review on its code: what it shows, and the way to change it (on the map, not here). */
function BoundBar() {
  const { bound, root, source, diff, loading, refresh, editCode } = useReview()
  if (!bound) return null
  const adds = diff?.files.reduce((n, f) => n + f.additions, 0) ?? 0
  const dels = diff?.files.reduce((n, f) => n + f.deletions, 0) ?? 0
  return (
    <div className="source-bar bound">
      <span className="bound-chip" title="캔버스에 연 지도가 이 코드를 가리켜. 지도와 리뷰는 같은 코드를 보여 줘">
        <MapIcon size={13} /><span className="ellipsis">지도 <b>{bound.title}</b>의 코드</span>
      </span>
      <span className="ref-pick static" title={root}><FolderGit2 size={13} /><b className="ellipsis">{root?.split('/').pop()}</b></span>
      <span className="bound-source">{source.kind === 'branch' && source.compare === 'WORKTREE' ? `${sourceLabel(source).split(' ← ')[1]} 이후 지금까지(커밋 안 한 것 포함)` : sourceLabel(source)}</span>
      <button className="btn sm" onClick={editCode}>코드 기준 바꾸기</button>
      <span className="grow" />
      {diff && <span className="summary">파일 <b>{diff.files.length}</b>개 <b className="add">+{adds}</b> <b className="del">−{dels}</b></span>}
      <ViewMenu />
      <button className="iconbtn" title="Refresh (r)" onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
    </div>
  )
}

function SourceBar() {
  const { source, setSource, info, root, diff, loading, refresh, showLastTurn, bound, editing, saveCode, cancelCode } = useReview()
  const currentSession = useApp(s => s.currentSession)
  const turns = useTurns(currentSession, root, source.kind === 'branch')
  const pick = (kind: DiffSource['kind']) => {
    if (kind === source.kind) return
    if (kind === 'working') setSource({ kind: 'working' })
    else if (kind === 'branch') setSource({ kind: 'branch', base: info?.defaultBase ?? 'main', compare: 'WORKTREE' })
    else if (kind === 'commits') setSource({ kind: 'commits', to: 'HEAD' })
    else if (kind === 'pr') setSource({ kind: 'pr' })
    else if (currentSession) void showLastTurn(currentSession)
    else useApp.getState().toast('먼저 에이전트와 대화를 시작해 줘', 'error')
  }
  const adds = diff?.files.reduce((n, f) => n + f.additions, 0) ?? 0
  const dels = diff?.files.reduce((n, f) => n + f.deletions, 0) ?? 0
  if (bound && !editing) return <BoundBar />
  return (
    <div className={`source-bar ${editing ? 'editing' : ''}`}>
      {editing && <span className="bound-chip"><MapIcon size={13} /><span className="ellipsis">지도 <b>{bound?.title}</b>의 기준 바꾸는 중</span></span>}
      <div className="seg kinds">
        {KINDS.filter(k => !editing || k.kind !== 'turn').map(k => (
          <button key={k.kind} aria-pressed={source.kind === k.kind} onClick={() => pick(k.kind)} title={k.label}>{k.icon}<span className="kind-label">{k.label}</span></button>
        ))}
      </div>
      <RootPicker info={info} />
      {source.kind === 'branch' && (
        <>
          <RefPicker label="base" value={source.base} info={info} turns={turns} onPick={v => setSource({ ...source, base: v })} />
          <span className="muted">←</span>
          <RefPicker label="compare" value={source.compare} info={info} allowWorktree onPick={v => setSource({ ...source, compare: v })} />
        </>
      )}
      {source.kind === 'commits' && root && <CommitPicker root={root} source={source} onPick={setSource} />}
      {source.kind === 'turn' && <TurnPicker source={source} onPick={setSource} />}
      {source.kind === 'pr' && root && <PrPicker root={root} source={source} onPick={setSource} />}
      <span className="grow" />
      {editing && (
        <>
          <button className="btn sm primary" onClick={() => void saveCode()}>이 기준으로 저장</button>
          <button className="btn sm" onClick={() => void cancelCode()}>취소</button>
        </>
      )}
      {diff && <span className="summary">파일 <b>{diff.files.length}</b>개 <b className="add">+{adds}</b> <b className="del">−{dels}</b></span>}
      <ViewMenu />
      <button className="iconbtn" title="Refresh (r)" onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
    </div>
  )
}

type TreeNode = { name: string; path: string; dir: boolean; children: TreeNode[]; file?: DiffFile }

/** Folders with one child folder fold into one row, like `src/main/kotlin`. */
function buildTree(files: DiffFile[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let cur = root
    parts.forEach((p, i) => {
      const isFile = i === parts.length - 1
      let next = cur.children.find(c => c.name === p && c.dir !== isFile)
      if (!next) {
        next = { name: p, path: parts.slice(0, i + 1).join('/'), dir: !isFile, children: [], file: isFile ? f : undefined }
        cur.children.push(next)
      }
      cur = next
    })
  }
  const squash = (n: TreeNode): TreeNode => {
    n.children = n.children.map(squash)
    if (n.dir && n.children.length === 1 && n.children[0].dir && n.name) {
      const c = n.children[0]
      return { ...c, name: `${n.name}/${c.name}` }
    }
    return n
  }
  const sort = (n: TreeNode) => { n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1)); n.children.forEach(sort) }
  const out = squash(root)
  sort(out)
  return out.children
}

type RowCtx = { counts: Map<string, number>; now: number }

function useRowCtx(): RowCtx {
  const { comments, recent } = useReview()
  const now = useNow(Object.keys(recent).length > 0, 2000)
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of comments) if (c.state !== 'resolved') m.set(c.path, (m.get(c.path) ?? 0) + 1)
    return m
  }, [comments])
  return { counts, now }
}

function FileRow({ f, name, depth, ctx, sub }: { f: DiffFile; name: string; depth: number; ctx: RowCtx; sub?: string }) {
  const { selected, select, viewed, recent } = useReview()
  const total = f.additions + f.deletions
  return (
    <button className={`tree-row file ${selected === f.path ? 'on' : ''} ${viewed[f.path] ? 'viewed' : ''}`} style={{ paddingLeft: 8 + depth * 12 + 14 }} onClick={() => select(f.path)} data-path={f.path} title={f.path}>
      <span className={`st ${f.status}`}>{STATUS_LETTER[f.status]}</span>
      <span className="ellipsis grow">{name}{sub && <span className="row-sub"> {sub}</span>}</span>
      {recent[f.path] && ctx.now - recent[f.path] < 12_000 && <span className="touched" title="방금 바뀜" />}
      {ctx.counts.get(f.path) ? <span className="badge">{ctx.counts.get(f.path)}</span> : null}
      {viewed[f.path] ? <Check size={12} className="viewed-mark" /> : (
        <span className="bars" title={`+${f.additions} −${f.deletions}`}>
          {total > 0 && <><i className="a" style={{ width: Math.max(2, Math.round((f.additions / total) * 28)) }} /><i className="d" style={{ width: Math.max(f.deletions ? 2 : 0, Math.round((f.deletions / total) * 28)) }} /></>}
        </span>
      )}
    </button>
  )
}

function FileTree({ files }: { files: DiffFile[] }) {
  const ctx = useRowCtx()
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const tree = useMemo(() => buildTree(files), [files])
  const render = (n: TreeNode, depth: number): React.ReactNode => {
    if (n.dir) {
      const isClosed = closed.has(n.path)
      return (
        <div key={`d:${n.path}`}>
          <button className="tree-row dir" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => setClosed(s => { const x = new Set(s); if (x.has(n.path)) x.delete(n.path); else x.add(n.path); return x })}>
            {isClosed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <Folder size={12} />
            <span className="ellipsis">{n.name}</span>
          </button>
          {!isClosed && n.children.map(c => render(c, depth + 1))}
        </div>
      )
    }
    return <FileRow key={n.file!.path} f={n.file!} name={n.name} depth={depth} ctx={ctx} />
  }
  return <div className="tree">{tree.map(n => render(n, 0))}</div>
}

const CHANGE_WORD: Record<string, string> = { add: 'New', modify: 'Modified', delete: 'Deleted', result: 'Result' }

/** The changed files as the map lays the code out: packages, the boxes in them, the files of each box. */
function MapTree({ model }: { model: ReturnType<typeof mapGroups> }) {
  const ctx = useRowCtx()
  const viewed = useReview(s => s.viewed)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setClosed(s => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x })
  const base = (p: string) => p.split('/').pop() ?? p
  const pathsOf = (n: MapNode): string[] => [...n.files.map(f => f.path), ...n.children.flatMap(pathsOf)]
  /** A group's files: how many, how many of them viewed ("1/3"), or a check once all are. */
  const tally = (paths: string[]) => {
    const all = new Set(paths)
    const seen = [...all].filter(p => viewed[p]).length
    if (seen === all.size) return <Check size={12} className="viewed-mark" aria-label="All viewed" />
    return <span className="row-count" title={seen ? `${seen} of ${all.size} viewed` : undefined}>{seen ? `${seen}/${all.size}` : all.size}</span>
  }
  const render = (n: MapNode, depth: number): React.ReactNode => {
    const label = n.el.label ?? n.el.id
    if (n.package) {
      const isClosed = closed.has(n.el.id)
      return (
        <div key={`p:${n.el.id}`}>
          <button className="tree-row dir map-pkg" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => toggle(n.el.id)} title={n.el.id}>
            {isClosed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <Package size={12} />
            <span className="ellipsis grow">{label}</span>
            {tally(pathsOf(n))}
          </button>
          {!isClosed && <>
            {n.files.map(f => <FileRow key={`${n.el.id}:${f.path}`} f={f} name={base(f.path)} depth={depth + 1} ctx={ctx} />)}
            {n.children.map(c => render(c, depth + 1))}
          </>}
        </div>
      )
    }
    return (
      <div key={`b:${n.el.id}`}>
        <div className="tree-row map-box" style={{ paddingLeft: 8 + depth * 12 + 14 }} title={n.el.id}>
          <Box size={11} />
          <span className="ellipsis grow">{label}</span>
          {n.el.change && n.el.change !== 'keep' && <span className={`map-chg ${n.el.change}`}>{CHANGE_WORD[n.el.change]}</span>}
        </div>
        {n.files.map(f => <FileRow key={`${n.el.id}:${f.path}`} f={f} name={base(f.path)} depth={depth + 1} ctx={ctx} />)}
        {n.children.map(c => render(c, depth + 1))}
      </div>
    )
  }
  return (
    <div className="tree">
      {model.nodes.map(n => render(n, 0))}
      {model.outside.length > 0 && (
        <div>
          <button className="tree-row dir map-pkg outside" style={{ paddingLeft: 8 }} onClick={() => toggle(' outside')} title="지도의 어느 상자도 가리키지 않는 파일">
            {closed.has(' outside') ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <Folder size={12} />
            <span className="ellipsis grow">지도 밖</span>
            {tally(model.outside.map(f => f.path))}
          </button>
          {!closed.has(' outside') && model.outside.map(f => <FileRow key={`o:${f.path}`} f={f} name={base(f.path)} sub={f.path.split('/').slice(0, -1).join('/')} depth={1} ctx={ctx} />)}
        </div>
      )}
    </div>
  )
}

export function ReviewView() {
  const workspace = useApp(s => s.workspace)
  const { home, root, init, diff, loading, error, selected, select, fileView, toggleViewed, viewed, setMode, toggle, refresh, closeFile, source, comments, group, setGroup, scope, setScope, filter, setFilter, sinceTurn } = useReview()
  const map = useCanvas(s => s.map)
  const [navTab, setNavTab] = useState<'files' | 'comments'>('files')
  const [finding, setFinding] = useState(false)
  const findScope = useCallback(() => document.querySelector<HTMLElement>('.review-main .file-diff'), [])
  const drafts = comments.filter(c => c.state === 'draft').length
  const openComments = comments.filter(c => c.state !== 'resolved').length
  // A part of the map, the filter box, then the layout (folders or the map) decide the list and its order.
  const filtered = useMemo(() => listedFiles(diff?.files ?? [], root, scope, filter), [diff, scope, root, filter])
  const byMap = group === 'map' && map?.diagram === 'class' && home && root
  const model = useMemo(() => (byMap ? mapGroups(map, filtered, root, home) : undefined), [byMap, map, filtered, root, home])
  const files = model ? model.order : filtered
  const file = files.find(f => f.path === selected)

  useEffect(() => {
    if (workspace && home !== workspace.path) void init(workspace.path)
  }, [workspace, home, init])

  // The map layout needs the workspace's map even before the canvas tab was opened.
  useEffect(() => {
    if (group === 'map' && workspace && !useCanvas.getState().map) void useCanvas.getState().loadList()
  }, [group, workspace])

  // Keep the selection inside what is listed (a part of the map narrows it).
  useEffect(() => {
    if (files.length && !files.some(f => f.path === selected)) select(files[0].path)
  }, [files, selected, select])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (useApp.getState().tab !== 'review') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !e.shiftKey) { e.preventDefault(); setFinding(true); return }
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') { e.preventDefault(); setFinding(true); return }
      const i = files.findIndex(f => f.path === selected)
      const go = (d: number) => { const f = files[Math.max(0, Math.min(files.length - 1, i + d))]; if (f) select(f.path) }
      const hunk = (d: number) => {
        const scroller = document.querySelector('.review-main')
        const hunks = [...document.querySelectorAll<HTMLElement>('.file-diff .hunk-row')]
        if (!scroller || !hunks.length) { go(d); return }
        const top = scroller.getBoundingClientRect().top + 60
        const idx = hunks.findIndex(h => h.getBoundingClientRect().top > top + 2)
        const target = d > 0 ? hunks[idx === -1 ? hunks.length : idx] : hunks[(idx === -1 ? hunks.length : idx) - 2]
        if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' })
        else go(d)
      }
      switch (e.key) {
        case 'j': go(1); break
        case 'k': go(-1); break
        case ']': case 'n': hunk(1); break
        case '[': case 'p': hunk(-1); break
        case 'v': if (file) { toggleViewed(file); if (!viewed[file.path]) { const next = files.slice(i + 1).find(f => !viewed[f.path]); if (next) select(next.path) } } break
        case 'u': setMode('unified'); break
        case 's': setMode('split'); break
        case 'w': toggle('ignoreWhitespace'); break
        case 'r': void refresh(); break
        case 'm': setNavTab(t => (t === 'files' ? 'comments' : 'files')); break
        case 'Escape': if (fileView) closeFile(); break
        default: return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [files, selected, file, viewed, select, toggleViewed, setMode, toggle, refresh, fileView, closeFile])

  useEffect(() => {
    document.querySelector(`.tree-row[data-path="${CSS.escape(selected ?? '')}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const viewedCount = files.filter(f => viewed[f.path]).length
  // A turn that kept no record of this tree can still be seen from the commit it started on.
  const unrecorded = source.kind === 'turn' && /이 저장소의 변경 기록이 없어/.test(error ?? '')
  const turns = useTurns(source.kind === 'turn' ? source.sessionId : undefined, root, unrecorded)
  const stand = unrecorded && source.kind === 'turn' ? turns?.find(t => t.turnId === source.turnId && t.base) : undefined

  return (
    <div className="review">
      <SourceBar />
      <RepoHint />
      <div className="review-body">
        <nav className="review-nav">
          <div className="nav-tabs">
            <button aria-selected={navTab === 'files'} onClick={() => setNavTab('files')}>파일 <span className="count">{files.length}</span></button>
            <button aria-selected={navTab === 'comments'} onClick={() => setNavTab('comments')}>
              코멘트 {openComments > 0 && <span className="count">{openComments}</span>}{drafts > 0 && <span className="badge agent">{drafts}</span>}
            </button>
          </div>
          {navTab === 'comments' ? <CommentsDock /> : <>
          <div className="nav-layout">
            <div className="seg">
              <button aria-pressed={group === 'folders'} onClick={() => setGroup('folders')}><Folder size={12} /> 폴더</button>
              <button aria-pressed={group === 'map'} onClick={() => setGroup('map')} disabled={!map || map.diagram !== 'class'} title={map?.diagram === 'class' ? `지도 "${map.title}"의 패키지·상자로 묶기` : '클래스 지도가 필요해'}><Shapes size={12} /> 지도</button>
            </div>
            {group === 'map' && map && <span className="muted ellipsis small">{map.title}</span>}
          </div>
          {scope && (
            <div className="scope-chip">
              <Shapes size={12} />
              <span className="ellipsis grow"><b>{scope.label}</b>의 변경만</span>
              <button className="iconbtn" title="모든 변경 보기" onClick={() => setScope(undefined)}><X size={12} /></button>
            </div>
          )}
          <div className="nav-search">
            <Search size={13} />
            <input placeholder="파일 찾기" value={filter} onChange={e => setFilter(e.target.value)} />
            {filter && <button className="iconbtn" onClick={() => setFilter('')}><X size={12} /></button>}
          </div>
          {diff && files.length > 0 && (
            <div className="nav-progress">
              <span className="bar"><i style={{ width: `${(viewedCount / files.length) * 100}%` }} /></span>
              <span className="muted">{viewedCount}/{files.length} viewed</span>
            </div>
          )}
          {model ? <MapTree model={model} /> : <FileTree files={files} />}
          {diff && <div className="nav-foot muted" title={`${diff.oldRef} → ${diff.newRef}`}>{diff.oldLabel} → {diff.newLabel}</div>}
          </>}
        </nav>
        <main className="review-main">
          {finding && <FindBar key={selected ?? fileView?.path} scope={findScope} onClose={() => setFinding(false)} />}
          {fileView ? (
            <>
              <div className="fileview-back"><button className="btn sm ghost" onClick={closeFile}><ArrowLeft size={13} /> diff로 돌아가기 <kbd>esc</kbd></button></div>
              <FileView path={fileView.path} gitRef={fileView.ref} line={fileView.line} />
            </>
          ) : error ? (
            <div className="empty">
              <h3>{source.kind === 'pr' ? 'PR을 보여 줄 수 없어' : 'diff를 만들지 못했어'}</h3><p>{error}</p>
              {stand && <button className="btn primary" onClick={() => sinceTurn(stand)}>턴 {stand.n} 시작 직전 커밋부터 지금까지 보기</button>}
              <button className="btn" onClick={() => void refresh()}>다시 시도</button>
            </div>
          ) : !diff ? (
            <div className="empty"><Loader2 className="spin" size={18} /></div>
          ) : !files.length ? (
            <div className="empty">
              <h3>{scope && diff.files.length ? `${scope.label}에는 바뀐 파일이 없어` : source.kind === 'turn' ? '이 턴은 파일을 바꾸지 않았어' : '바뀐 파일이 없어'}</h3>
              <p>{sourceLabel(source)}</p>
            </div>
          ) : file ? (
            <>
              {source.kind === 'pr' && root && <PrPanel root={root} number={source.number} />}
              <DiffView key={file.path} file={file} />
            </>
          ) : null}
          {loading && diff && <div className="refreshing"><Loader2 size={12} className="spin" /></div>}
        </main>
      </div>
      <div className="review-keys muted">
        <span><kbd>j</kbd><kbd>k</kbd> 파일</span><span><kbd>n</kbd><kbd>p</kbd> hunk</span><span><kbd>v</kbd> Viewed</span>
        <span><kbd>u</kbd><kbd>s</kbd> Unified·Split</span><span><kbd>/</kbd> 찾기</span><span><kbd>m</kbd> 코멘트</span><span>줄 번호 드래그 → 코멘트</span>
        <span className="grow" />
        {root && <button className="link-btn" onClick={() => void navigator.clipboard.writeText(root)}><Copy size={11} /> {root}</button>}
      </div>
    </div>
  )
}
