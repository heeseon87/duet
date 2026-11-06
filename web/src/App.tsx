import { useEffect, useRef, useState } from 'react'
import { FileDiff, Keyboard, Palette as PaletteIcon, Signpost, RotateCw, Search, Shapes, Terminal, WifiOff } from 'lucide-react'
import type { TerminalInfo } from '../../shared/protocol.ts'
import { connection, subscribe } from './api.ts'
import { local, targetTerminal, useApp } from './state.ts'
import { doingOf } from './terminalTarget.ts'
import { Popover, isTypingTarget, shortcutKey } from './lib/ui.tsx'
import { PALETTES } from './lib/highlight.ts'
import { RepoPicker } from './lib/RepoPicker.tsx'
import { ReviewView } from './review/ReviewView.tsx'
import { CanvasView } from './canvas/CanvasView.tsx'
import { Palette } from './Palette.tsx'
import { Shortcuts } from './Shortcuts.tsx'
import { sourceLabel, useReview } from './review/store.ts'
import { useCanvas } from './canvas/store.ts'

function Welcome() {
  const { workspaces, openWorkspace, toast } = useApp()
  const go = async (p: string) => {
    try { await openWorkspace(p) } catch (e) { toast((e as Error).message, 'error') }
  }
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="brand"><span className="brand-mark"><i /><i /></span> Duet</div>
        <h1>설계와 코드를 에이전트와 함께</h1>
        <p>작업할 git 저장소를 골라.</p>
        <div className="welcome-picker">
          <RepoPicker recents={workspaces} onOpen={go} autoFocus listHeight="min(46vh, 440px)" />
        </div>
        <p className="muted">터미널에서는 저장소 안에서 <code>duet</code>을 실행하면 바로 열려.</p>
      </div>
    </div>
  )
}

function CodeColorButton() {
  const { codePalette, setCodePalette } = useApp()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={ref} className="rail-btn" title="코드 색" onClick={() => setOpen(o => !o)}>
        <PaletteIcon size={16} />
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} align="side" width={360}>
          <div className="menu-label">코드 색</div>
          <div className="palette-grid">
            {PALETTES.map(p => (
              <button key={p.id} className="menu-item" aria-checked={codePalette === p.id} onClick={() => setCodePalette(p.id)}>
                <span className="swatches">{SWATCH[p.id]?.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
                <span className="grow">{p.label}</span>
                {codePalette === p.id && <span className="sub">✓</span>}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}

/** A few signature colors per palette (keyword, string, function, type) for the picker. */
const SWATCH: Record<string, string[]> = {
  github: ['#cf222e', '#0a3069', '#8250df', '#953800'], vitesse: ['#1e754f', '#b56959', '#59873a', '#2e8f82'],
  one: ['#a626a4', '#50a14f', '#4078f2', '#c18401'], catppuccin: ['#cba6f7', '#a6e3a1', '#89b4fa', '#f9e2af'],
  'rose-pine': ['#31748f', '#f6c177', '#ebbcba', '#9ccfd8'], solarized: ['#859900', '#2aa198', '#268bd2', '#b58900'],
  everforest: ['#e67e80', '#a7c080', '#7fbbb3', '#dbbc7f'], kanagawa: ['#957fb8', '#98bb6c', '#7e9cd8', '#c0a36e'],
  gruvbox: ['#fb4934', '#b8bb26', '#83a598', '#fabd2f'], material: ['#c792ea', '#c3e88d', '#82aaff', '#ffcb6b'],
  'night-owl': ['#c792ea', '#ecc48d', '#82aaff', '#addb67'], ayu: ['#ff8f40', '#aad94c', '#ffb454', '#59c2ff'],
  vscode: ['#569cd6', '#ce9178', '#dcdcaa', '#4ec9b0'], min: ['#d73a49', '#22863a', '#6f42c1', '#005cc5'],
  'tokyo-night': ['#bb9af7', '#9ece6a', '#7aa2f7', '#e0af68'], nord: ['#81a1c1', '#a3be8c', '#88c0d0', '#ebcb8b'],
  dracula: ['#ff79c6', '#f1fa8c', '#50fa7b', '#8be9fd'], monokai: ['#f92672', '#e6db74', '#a6e22e', '#66d9ef'],
}

function Toasts() {
  const toasts = useApp(s => s.toasts)
  return <div className="toasts">{toasts.map(t => <div key={t.id} className={`toast ${t.kind ?? ''}`}>{t.text}</div>)}</div>
}

function Offline() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const l = (v: boolean) => setOnline(v)
    connection.listeners.add(l)
    return () => { connection.listeners.delete(l) }
  }, [])
  if (online) return null
  return <span className="rail-warn" title="연결 끊김 · 재연결 중"><WifiOff size={15} />끊김</span>
}

/** The server runs older code than the page; until `duet` restarts it, new features can reach it half-understood. */
function Stale() {
  const [stale, setStale] = useState(connection.stale)
  useEffect(() => subscribe(ev => { if (ev.topic === 'stale' || ev.topic === 'hello') setStale(connection.stale) }), [])
  if (!stale) return null
  return <span className="rail-warn" title="서버 재시작 필요: 서버 코드가 바뀌었는데 서버는 예전 코드로 떠 있어. 터미널에서 duet을 실행하면 다시 떠."><RotateCw size={15} />재시작</span>
}

/** Picking a terminal opens the map it is pinned to. */
function openPinned(t: TerminalInfo) {
  const canvas = useCanvas.getState()
  if (t.map && t.map !== canvas.name && canvas.list.some(m => m.name === t.map)) void canvas.open(t.map)
}

/**
 * The terminal things go to, on the rail: whether a turn runs there, or it waits on the person; what it does is in the
 * title. A click lists the terminals to pick from, each with what it does.
 */
function TerminalSlot() {
  const terminals = useApp(s => s.terminals)
  const target = useApp(targetTerminal)
  const selectTerminal = useApp(s => s.selectTerminal)
  const maps = useCanvas(s => s.list)
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const t = terminals.find(x => x.id === target)
  const doing = t && doingOf(t)
  const state = doing?.isWaiting ? 'waiting' : t?.status ?? (terminals.length ? 'pick' : 'none')
  const label = { waiting: '대기', working: '작업', idle: '터미널', pick: '고르기', none: '없음' }[state]
  const title = t && doing ? `${t.label} · ${doing.status}${doing.line ? ` · ${doing.line}` : ''} · 보낼 터미널 고르기`
    : terminals.length ? `터미널 ${terminals.length}개 · 보낼 터미널을 골라 줘` : '연결된 터미널이 없어 · 터미널에서 /duet을 켜 줘'
  return (
    <>
      <button ref={ref} className={`rail-btn term ${state}`} aria-expanded={open} title={title} onClick={() => setOpen(o => !o)}>
        <span className="term-ring"><Terminal size={14} /></span>{label}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} align="side" width={300}>
          <div className="menu-label">보낼 터미널</div>
          {terminals.length === 0 && <div className="menu-label term-empty">연결된 터미널이 없어. Claude Code 터미널에서 /duet을 켜면 여기에 나와.</div>}
          {terminals.map(x => {
            const pinned = maps.find(m => m.name === x.map)?.title
            const d = doingOf(x)
            return (
              <button key={x.id} className="menu-item" data-terminal={x.id} aria-checked={x.id === target} title={d.line} onClick={() => { selectTerminal(x.id); openPinned(x); setOpen(false) }}>
                <span className={`term-dot ${d.isWaiting ? 'waiting' : x.status}`} />
                <span className="grow ellipsis">
                  <span className="ellipsis">{x.label}</span>
                  <span className="meta">{d.status}{pinned ? ` · 📌 ${pinned}` : ''}</span>
                  {d.line && <span className={`meta ellipsis term-doing ${d.isWaiting ? 'wait' : ''}`}>{d.line}</span>}
                </span>
              </button>
            )
          })}
        </Popover>
      )}
    </>
  )
}

/** Decision mode from anywhere: the open decisions of the map on the canvas, one at a time (all made, what was made). */
function DecideSlot() {
  const tab = useApp(s => s.tab)
  const all = useCanvas(s => s.map?.decisions?.length ?? 0)
  const open = useCanvas(s => (s.map?.decisions ?? []).filter(d => !d.chosen).length)
  const deciding = useCanvas(s => s.deciding), setDeciding = useCanvas(s => s.setDeciding)
  const preview = useCanvas(s => s.preview?.revision)
  const on = deciding && tab === 'canvas'
  const title = !all ? '결정 · 이 지도에는 정할 결정이 없어'
    : preview ? `결정 · rev ${preview}을 보는 동안은 열 수 없어`
    : on ? '결정 모드 닫기 (esc)'
    : open ? `결정 ${open}개가 너를 기다려 · 하나씩 정하기` : '결정을 모두 정했어 · 다시 보기'
  return (
    <button className="rail-btn rail-decide" aria-pressed={on} disabled={!all || Boolean(preview)} title={title} onClick={() => {
      if (on) { setDeciding(false); return }
      useApp.getState().setTab('canvas')
      setDeciding(true)
    }}>
      <Signpost size={16} />결정
      {open > 0 && <span className="badge">{open}</span>}
    </button>
  )
}

/** The app's left rail: the two views, decision mode, the terminal things go to, and what is about the app itself. */
function Rail({ onHelp }: { onHelp: () => void }) {
  const { tab, setTab, setPalette } = useApp()
  const drafts = useReview(s => s.comments.filter(c => c.state === 'draft').length)
  const fileCount = useReview(s => s.diff?.files.length)
  const counted = useReview(s => s.root && `${s.repos.find(r => r.path === s.root)?.label ?? s.root.split('/').pop()} · ${sourceLabel(s.source)}`)
  return (
    <nav className="rail" aria-label="앱">
      <span className="brand-mark rail-logo" title="Duet"><i /><i /></span>
      <div className="tabs" role="tablist" aria-orientation="vertical">
        <button role="tab" className="rail-btn" aria-selected={tab === 'canvas'} onClick={() => setTab('canvas')} title="지도 (⌘1)">
          <Shapes size={16} />지도
        </button>
        <button role="tab" className="rail-btn" aria-selected={tab === 'review'} onClick={() => setTab('review')} title={counted ? `리뷰 (⌘2) · ${counted}${fileCount ? ` 파일 ${fileCount}개` : ''}` : '리뷰 (⌘2)'}>
          <FileDiff size={16} /><span>리뷰{fileCount ? <> <span className="count">{fileCount > 999 ? '999+' : fileCount}</span></> : null}</span>
          {drafts > 0 && <span className="badge agent" title={`보내기 전 코멘트 ${drafts}개`}>{drafts}</span>}
        </button>
      </div>
      <DecideSlot />
      <span className="rail-sep" />
      <TerminalSlot />
      <span className="grow" />
      <Offline />
      <Stale />
      <button className="rail-btn" title="찾기 · 명령 (⌘K)" onClick={() => setPalette(true)}><Search size={16} />찾기</button>
      <button className="rail-btn" title="단축키 (?)" onClick={onHelp}><Keyboard size={16} /></button>
      <CodeColorButton />
    </nav>
  )
}

export function App() {
  const { workspace, tab, setTab, paletteOpen, setPalette, openWorkspace, toast } = useApp()
  const [booted, setBooted] = useState(false)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    document.title = workspace ? `${workspace.name.split(' / ').pop()} · Duet` : 'Duet'
  }, [workspace])

  useEffect(() => {
    void (async () => {
      const all = await fetch('/api/workspaces').then(r => r.json()).catch(() => [])
      useApp.setState({ workspaces: all })
      const fromUrl = new URLSearchParams(location.search).get('ws')
      const start = fromUrl ?? local.get('workspace')
      if (start) await openWorkspace(start).catch(e => toast(e.message, 'error'))
      setBooted(true)
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The review's git info feeds the top bar's branch and worktree list, whichever tab is open.
  useEffect(() => {
    if (workspace && useReview.getState().home !== workspace.path) void useReview.getState().init(workspace.path)
  }, [workspace?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && shortcutKey(e).toLowerCase() === 'k') { e.preventDefault(); setPalette(!useApp.getState().paletteOpen) }
      else if (mod && e.key === '1') { e.preventDefault(); setTab('canvas') }
      else if (mod && e.key === '2') { e.preventDefault(); setTab('review') }
      else if (e.key === '?' && !isTypingTarget(e.target)) { e.preventDefault(); setHelp(h => !h) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [setPalette, setTab])

  if (!booted) return <div className="app" />
  if (!workspace) return <><Welcome /><Toasts /></>

  return (
    <div className="app">
      <Rail onHelp={() => setHelp(true)} />
      <div className="main">
        <section className="stage">
          {tab === 'canvas' ? <CanvasView /> : <ReviewView />}
        </section>
      </div>
      {paletteOpen && <Palette onClose={() => setPalette(false)} />}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
      <Toasts />
    </div>
  )
}
