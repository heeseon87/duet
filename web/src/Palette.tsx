import { useEffect, useMemo, useRef, useState } from 'react'
import { FileCode2, FileDiff, MessagesSquare, Search, Shapes, TextSearch, Loader2, CornerDownLeft } from 'lucide-react'
import { api, q } from './api.ts'
import { useApp } from './state.ts'
import { useReview } from './review/store.ts'
import { useCanvas } from './canvas/store.ts'
import { useSide } from './side/store.ts'
import { cachedFiles, fuzzy, repoFiles } from './lib/files.ts'

type Item = { id: string; icon: React.ReactNode; label: string; hint?: string; run: () => void }

export function Palette({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const review = useReview()
  const canvas = useCanvas()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [files, setFiles] = useState<string[]>(cachedFiles(app.workspace?.path))
  const [grep, setGrep] = useState<{ q: string; hits: { path: string; line: number; text: string }[] } | null>(null)
  const [grepping, setGrepping] = useState(false)
  const [live, setLive] = useState<{ q: string; hits: { path: string; line: number; text: string }[] } | null>(null)
  const list = useRef<HTMLDivElement>(null)

  // Code search runs while you type (debounced); stale answers are dropped.
  useEffect(() => {
    const ws = app.workspace?.path
    const text = query.trim()
    if (!ws || text.length < 3 || grep) { setLive(null); return }
    let alive = true
    const t = setTimeout(() => {
      void api.get<{ path: string; line: number; text: string }[]>(`/api/git/grep${q({ ws, q: text })}`)
        .then(hits => { if (alive) setLive({ q: text, hits: hits.slice(0, 12) }) })
        .catch(() => undefined)
    }, 220)
    return () => { alive = false; clearTimeout(t) }
  }, [query, grep, app.workspace?.path])

  useEffect(() => {
    const ws = app.workspace?.path
    if (ws) void repoFiles(ws).then(setFiles)
  }, [app.workspace?.path])

  const commands: Item[] = useMemo(() => [
    { id: 'tab-canvas', icon: <Shapes size={14} />, label: '캔버스로 가기', hint: '⌘1', run: () => app.setTab('canvas') },
    { id: 'tab-review', icon: <FileDiff size={14} />, label: '리뷰로 가기', hint: '⌘2', run: () => app.setTab('review') },
    { id: 'side-open', icon: <MessagesSquare size={14} />, label: '사이드 채팅 열기', hint: '⌘J', run: () => useSide.setState({ open: true }) },
    { id: 'side-new', icon: <MessagesSquare size={14} />, label: '새 사이드 채팅', run: () => useSide.getState().show('new') },
    { id: 'src-working', icon: <FileDiff size={14} />, label: '리뷰: Changes', run: () => { app.setTab('review'); review.setSource({ kind: 'working' }) } },
    { id: 'src-branch', icon: <FileDiff size={14} />, label: '리뷰: Compare', run: () => { app.setTab('review'); review.setSource({ kind: 'branch', base: review.info?.defaultBase ?? 'main', compare: 'WORKTREE' }) } },
    ...(canvas.map?.diagram === 'class' && canvas.map.elements.some(e => e.kind === 'group') ? [
      { id: 'fold-all', icon: <Shapes size={14} />, label: '캔버스: Collapse all', run: () => { app.setTab('canvas'); canvas.setAllCollapsed(true) } },
      { id: 'unfold-all', icon: <Shapes size={14} />, label: '캔버스: Expand all', run: () => { app.setTab('canvas'); canvas.setAllCollapsed(false) } },
    ] : []),
    ...(canvas.map ? [
    ] : []),
    ...canvas.list.map(m => ({ id: `map-${m.name}`, icon: <Shapes size={14} />, label: `지도 열기: ${m.title}`, hint: m.name, run: () => { app.setTab('canvas'); void canvas.open(m.name) } })),
  ], [app, review, canvas])

  const items: Item[] = useMemo(() => {
    if (grep) {
      return grep.hits.map((h, i) => ({
        id: `g${i}`, icon: <TextSearch size={14} />, label: `${h.path}:${h.line}`, hint: h.text.trim().slice(0, 80),
        run: () => { app.setTab('review'); void review.openFile(h.path, h.line, 'WORKTREE') },
      }))
    }
    const cmd = commands.map(c => ({ c, s: fuzzy(c.label + ' ' + (c.hint ?? ''), query) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.c)
    const out = query ? cmd.slice(0, 6) : cmd.slice(0, 9)
    if (query) {
      const f = files.map(p => ({ p, s: fuzzy(p, query) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 30)
      out.push(...f.slice(0, live?.hits.length ? 12 : 30).map(x => ({ id: `f:${x.p}`, icon: <FileCode2 size={14} />, label: x.p, run: () => { app.setTab('review'); void review.openFile(x.p, undefined, 'WORKTREE') } })))
      if (live && live.q === query.trim()) {
        out.push(...live.hits.map((h, i) => ({
          id: `lg${i}`, icon: <TextSearch size={14} />, label: `${h.path}:${h.line}`, hint: h.text.trim().slice(0, 90),
          run: () => { app.setTab('review'); void review.openFile(h.path, h.line, 'WORKTREE') },
        })))
      }
      out.push({ id: 'grep', icon: <Search size={14} />, label: `코드에서 “${query}” 찾기`, hint: '⇧⏎', run: () => void runGrep(query) })
    }
    return out
  }, [commands, files, query, grep, live]) // eslint-disable-line react-hooks/exhaustive-deps

  const runGrep = async (text: string) => {
    const ws = app.workspace?.path
    if (!ws) return
    setGrepping(true)
    try {
      const hits = await api.get<{ path: string; line: number; text: string }[]>(`/api/git/grep${q({ ws, q: text })}`)
      setGrep({ q: text, hits })
      setActive(0)
    } finally { setGrepping(false) }
  }

  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active])

  const pick = (it: Item | undefined) => {
    if (!it) return
    if (it.id === 'grep') { it.run(); return }
    it.run()
    onClose()
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="palette" role="dialog">
        <input
          autoFocus
          placeholder={grep ? `“${grep.q}” 검색 결과` : '명령, 파일 이름, 지도, 대화 찾기…'}
          value={query}
          onChange={e => { setQuery(e.target.value); setActive(0); if (grep) setGrep(null) }}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); if (grep) setGrep(null); else onClose() }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, items.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (e.shiftKey && query) void runGrep(query)
              else pick(items[active])
            }
          }}
        />
        <div className="list" ref={list}>
          {grepping && <div className="menu-label"><Loader2 size={12} className="spin" /> 찾는 중</div>}
          {items.map((it, i) => (
            <button key={it.id} className="menu-item" data-active={i === active} onMouseEnter={() => setActive(i)} onClick={() => pick(it)}>
              {it.icon}
              <span className="grow ellipsis">{it.label}</span>
              {it.hint && <span className="sub ellipsis" style={{ maxWidth: 260 }}>{it.hint}</span>}
            </button>
          ))}
          {!items.length && !grepping && <div className="menu-label">결과가 없어</div>}
        </div>
        <div className="hint"><span><kbd>↑</kbd><kbd>↓</kbd> 고르기</span><span><kbd>⏎</kbd> 열기</span><span><kbd>⇧</kbd><kbd>⏎</kbd> 코드 검색</span><span className="grow" /><span><CornerDownLeft size={11} /></span></div>
      </div>
    </>
  )
}
