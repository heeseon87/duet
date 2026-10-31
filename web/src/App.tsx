import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileDiff, FolderGit2, GitBranch, Keyboard, MessageSquare, Monitor, Moon, RotateCw, Search, Shapes, Sun, WifiOff } from 'lucide-react'
import { connection, subscribe } from './api.ts'
import { local, useApp } from './state.ts'
import { Popover, isTypingTarget, shortcutKey } from './lib/ui.tsx'
import { PALETTES } from './lib/highlight.ts'
import { RepoPicker } from './lib/RepoPicker.tsx'
import { AgentPanel } from './agent/AgentPanel.tsx'
import { Reader } from './agent/Reader.tsx'
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

function WorkspaceMenu() {
  const { workspace, workspaces, openWorkspace, toast } = useApp()
  const info = useReview(s => s.homeInfo)
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  if (!workspace) return null
  const go = async (p: string) => {
    try { await openWorkspace(p); setOpen(false) } catch (e) { toast((e as Error).message, 'error') }
  }
  const worktrees = info?.worktrees.filter(w => !w.bare) ?? []
  return (
    <>
      <button ref={ref} className="ws-pick" onClick={() => setOpen(o => !o)} title={workspace.path}>
        {workspace.name.includes(' / ')
          ? <span className="ws-name"><span className="repo">{workspace.name.split(' / ')[0]}</span><span className="slash">/</span><b>{workspace.name.split(' / ')[1]}</b></span>
          : <span className="ws-name"><b>{workspace.name}</b></span>}
        {info?.branch && <span className="branch"><GitBranch size={12} />{info.branch}</span>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} width={Math.min(620, window.innerWidth - 16)} className="ws-popover">
          <RepoPicker recents={workspaces} current={workspace.path} worktrees={worktrees} onOpen={go} autoFocus listHeight="min(62vh, 600px)" />
        </Popover>
      )}
    </>
  )
}

/** Where the current conversation works, when that is not the workspace; a click reviews it there. */
function WorkChip() {
  const workspace = useApp(s => s.workspace?.path)
  const tree = useApp(s => s.sessions.find(x => x.id === s.currentSession)?.workTree)
  const branch = useReview(s => s.repos.find(r => r.path === tree)?.branch)
  if (!tree || tree === workspace) return null
  return (
    <button className="work-chip" title={`${tree}\n이 대화가 일하는 저장소`} onClick={() => {
      useApp.getState().closeReader()
      useApp.getState().setTab('review')
      void useReview.getState().setRoot(tree)
    }}>
      <FolderGit2 size={13} /><b>{tree.split('/').pop()}</b>{branch && <span className="muted">{branch}</span>}
    </button>
  )
}

function ThemeButton() {
  const { theme, setTheme, codePalette, setCodePalette } = useApp()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={ref} className="rail-btn" title="테마" onClick={() => setOpen(o => !o)}>
        {theme === 'system' ? <Monitor size={16} /> : theme === 'light' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} align="side" width={300}>
          <div className="menu-label">테마</div>
          <div className="seg" style={{ margin: '2px 6px 8px', display: 'flex' }}>
            {(['system', 'light', 'dark'] as const).map(t => (
              <button key={t} style={{ flex: 1, justifyContent: 'center' }} aria-pressed={theme === t} onClick={() => setTheme(t)}>
                {t === 'system' ? <Monitor size={13} /> : t === 'light' ? <Sun size={13} /> : <Moon size={13} />}{t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
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

function Divider() {
  const setSide = useApp(s => s.setSide)
  const [drag, setDrag] = useState(false)
  return (
    <div
      className={`divider ${drag ? 'dragging' : ''}`}
      onPointerDown={e => {
        e.preventDefault()
        setDrag(true)
        // The panel sits left of the divider, so its width runs from its own left edge to the pointer.
        const left = e.currentTarget.previousElementSibling?.getBoundingClientRect().left ?? 0
        const move = (ev: PointerEvent) => setSide(ev.clientX - left)
        const up = () => { setDrag(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      onDoubleClick={() => setSide(460)}
    />
  )
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

/** The conversation's place on the rail: what it is doing, and what waits for you. A click shows or hides the panel. */
function ClaudeSlot() {
  const { sideOpen, sideWidth, setSide, setTab } = useApp()
  const status = useApp(s => s.sessions.find(x => x.id === s.currentSession)?.status)
  const decisions = useCanvas(s => (s.map?.decisions ?? []).filter(d => !d.chosen).length)
  const busy = status === 'running' || status === 'starting'
  const label = status === 'waiting' ? '대기' : busy ? '작업' : 'Claude'
  return (
    <div className="rail-claude">
      <button className={`rail-btn claude ${status ?? 'idle'}`} aria-pressed={sideOpen} onClick={() => setSide(sideWidth, !sideOpen)}
        title={`Claude · ${status === 'waiting' ? '네 답을 기다려' : busy ? '일하는 중' : '쉬는 중'} · 대화 ${sideOpen ? '접기' : '펼치기'} (⌘3)`}>
        <span className="claude-ring"><MessageSquare size={14} /></span>{label}
      </button>
      {decisions > 0 && (
        <button className="rail-badge" title={`결정 ${decisions}개가 너를 기다려 · 눌러서 하나씩 정하기`} onClick={() => {
          useApp.getState().closeReader()
          setTab('canvas')
          useCanvas.getState().setDeciding(true)
        }}>{decisions}</button>
      )}
    </div>
  )
}

/** The app's left rail: the two views, the conversation, and what is about the app itself. */
function Rail({ onHelp }: { onHelp: () => void }) {
  const { tab, setTab, setPalette } = useApp()
  const reading = useApp(s => Boolean(s.reader))
  const drafts = useReview(s => s.comments.filter(c => c.state === 'draft').length)
  const fileCount = useReview(s => s.diff?.files.length)
  const counted = useReview(s => s.root && `${s.repos.find(r => r.path === s.root)?.label ?? s.root.split('/').pop()} · ${sourceLabel(s.source)}`)
  const go = (t: 'canvas' | 'review') => { useApp.getState().closeReader(); setTab(t) }
  return (
    <nav className="rail" aria-label="앱">
      <span className="brand-mark rail-logo" title="Duet"><i /><i /></span>
      <div className="tabs" role="tablist" aria-orientation="vertical">
        <button role="tab" className="rail-btn" aria-selected={!reading && tab === 'canvas'} onClick={() => go('canvas')} title="지도 (⌘1)">
          <Shapes size={16} />지도
        </button>
        <button role="tab" className="rail-btn" aria-selected={!reading && tab === 'review'} onClick={() => go('review')} title={counted ? `리뷰 (⌘2) · ${counted}${fileCount ? ` 파일 ${fileCount}개` : ''}` : '리뷰 (⌘2)'}>
          <FileDiff size={16} /><span>리뷰{fileCount ? <> <span className="count">{fileCount > 999 ? '999+' : fileCount}</span></> : null}</span>
          {drafts > 0 && <span className="badge agent" title={`보내기 전 코멘트 ${drafts}개`}>{drafts}</span>}
        </button>
      </div>
      <span className="rail-sep" />
      <ClaudeSlot />
      <span className="grow" />
      <Offline />
      <Stale />
      <button className="rail-btn" title="찾기 · 명령 (⌘K)" onClick={() => setPalette(true)}><Search size={16} />찾기</button>
      <button className="rail-btn" title="단축키 (?)" onClick={onHelp}><Keyboard size={16} /></button>
      <ThemeButton />
    </nav>
  )
}

export function App() {
  const { workspace, tab, setTab, sideOpen, sideWidth, setSide, paletteOpen, setPalette, openWorkspace, toast } = useApp()
  const [booted, setBooted] = useState(false)
  const [help, setHelp] = useState(false)
  const sessions = useApp(s => s.sessions)
  const reading = useApp(s => Boolean(s.reader))

  // A turn that ends, or waits for a yes, while the tab is in the background says so in the tab title.
  useEffect(() => {
    const waiting = sessions.some(s => s.status === 'waiting')
    const running = sessions.some(s => s.status === 'running' || s.status === 'starting')
    const base = workspace ? `${workspace.name.split(' / ').pop()} · Duet` : 'Duet'
    if (!document.hidden) { document.title = running ? `● ${base}` : base; return }
    document.title = waiting ? `⏸ 입력 대기 · ${base}` : running ? `● ${base}` : `✓ 끝남 · ${base}`
  }, [sessions, workspace])
  useEffect(() => {
    const vis = () => { if (!document.hidden && workspace) document.title = `${workspace.name.split(' / ').pop()} · Duet` }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
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
      else if (mod && e.key === '1') { e.preventDefault(); useApp.getState().closeReader(); setTab('canvas') }
      else if (mod && e.key === '2') { e.preventDefault(); useApp.getState().closeReader(); setTab('review') }
      else if (mod && e.key === '.') { e.preventDefault(); const s = useApp.getState(); s.setFocus(!s.focus) }
      else if (mod && e.key === '3') { e.preventDefault(); setSide(useApp.getState().sideWidth, !useApp.getState().sideOpen) }
      else if (mod && e.shiftKey && shortcutKey(e).toLowerCase() === 'o') { e.preventDefault(); void useApp.getState().newSession() }
      else if (e.key === '?' && !isTypingTarget(e.target)) { e.preventDefault(); setHelp(h => !h) }
      else if (e.key === 'Escape' && !isTypingTarget(e.target)) {
        const s = useApp.getState()
        // Esc closes decision mode; the conversation goes on.
        if (useCanvas.getState().deciding && s.tab === 'canvas') return
        const cur = s.sessions.find(x => x.id === s.currentSession)
        if (cur && (cur.status === 'running' || cur.status === 'waiting')) void s.interrupt()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [setPalette, setTab, setSide])

  if (!booted) return <div className="app" />
  if (!workspace) return <><Welcome /><Toasts /></>

  return (
    <div className="app">
      <Rail onHelp={() => setHelp(true)} />
      <div className="main">
        {sideOpen && <div className="side" style={{ width: sideWidth }}><AgentPanel /></div>}
        {sideOpen && <Divider />}
        <section className="stage">
          <div className="ws-line"><WorkspaceMenu /><WorkChip /></div>
          {tab === 'canvas' ? <CanvasView /> : <ReviewView />}
          {reading && <Reader />}
        </section>
      </div>
      {paletteOpen && <Palette onClose={() => setPalette(false)} />}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
      <Toasts />
    </div>
  )
}
