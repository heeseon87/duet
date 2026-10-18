import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Check, ChevronDown, Copy, Focus, History, Loader2, Plus, Sparkles, Terminal, Trash2, CircleDot, ListChecks } from 'lucide-react'
import type { SessionInfo, TerminalInfo } from '../../../shared/protocol.ts'
import { api, q } from '../api.ts'
import { transcriptOf, useApp, useTranscript } from '../state.ts'
import { Popover, relTime, useNow } from '../lib/ui.tsx'
import { Blocks } from './Blocks.tsx'
import { FocusBlocks } from './Focus.tsx'
import { Composer, modelLabel } from './Composer.tsx'
import { confirmDialog } from '../lib/confirm.tsx'
import type { ToolCtx } from './ToolCall.tsx'
import { narration, waitLabel, type Transcript } from './transcript.ts'
import { useReview } from '../review/store.ts'
import { useCanvas } from '../canvas/store.ts'

type ClaudeSession = { claudeId: string; title: string; updated: number; branch?: string; liveHint: boolean; imported?: string }

function SessionMenu({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const { sessions, currentSession, selectSession, newSession, workspace, toast, terminals, currentTerminal, selectTerminal } = useApp()
  const [claude, setClaude] = useState<ClaudeSession[] | null>(null)
  const [showClaude, setShowClaude] = useState(false)
  const [find, setFind] = useState('')
  const shown = find ? sessions.filter(s => s.title.toLowerCase().includes(find.toLowerCase())) : sessions
  useEffect(() => {
    if (!showClaude || !workspace) return
    void api.get<ClaudeSession[]>(`/api/claude-sessions${q({ ws: workspace.path })}`).then(setClaude).catch(e => toast(e.message, 'error'))
  }, [showClaude, workspace, toast])
  const importOne = async (c: ClaudeSession) => {
    if (c.imported) { await selectSession(c.imported); onClose(); return }
    if (c.liveHint && !(await confirmDialog({ title: '터미널에서 쓰는 중일 수 있어', body: '두 곳에서 동시에 쓰면 기록이 엉켜. 터미널을 닫았으면 계속해.', ok: '가져오기' }))) return
    const info = await api.post<SessionInfo>('/api/sessions', { ws: workspace!.path, resume: c.claudeId, title: c.title.slice(0, 60) })
    useApp.setState(s => ({ sessions: [info, ...s.sessions.filter(x => x.id !== info.id)] }))
    await selectSession(info.id)
    onClose()
  }
  return (
    <Popover anchor={anchor} onClose={onClose} width={360}>
      <button className="menu-item" onClick={() => { void newSession(); onClose() }}><Plus size={14} /><span className="grow">새 대화</span><span className="sub">⌘⇧O</span></button>
      <button className="menu-item" onClick={() => setShowClaude(s => !s)}><Terminal size={14} /><span className="grow">Claude Code 세션 가져오기</span><ChevronDown size={12} /></button>
      {showClaude && (
        <div className="claude-sessions">
          {!claude && <div className="menu-label"><Loader2 size={12} className="spin" /> 불러오는 중</div>}
          {claude?.length === 0 && <div className="menu-label">이 폴더의 Claude Code 세션이 없어</div>}
          {claude?.map(c => (
            <button key={c.claudeId} className="menu-item" onClick={() => void importOne(c)}>
              <span className="grow ellipsis">
                <span className="ellipsis">{c.title}</span>
                <span className="meta">{relTime(c.updated)}{c.branch ? ` · ${c.branch}` : ''}{c.liveHint ? ' · 사용 중일 수 있음' : ''}{c.imported ? ' · 이미 가져옴' : ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="menu-sep" />
      <div className="menu-label">터미널 {terminals.length > 0 && <span className="muted">{terminals.length}</span>}</div>
      {terminals.length === 0 && <div className="menu-label" style={{ fontWeight: 400 }}>Duet mod를 켠 Claude Code 세션이 없어</div>}
      {terminals.map(t => (
        <button key={t.id} className="menu-item" data-terminal={t.id} aria-checked={t.id === currentTerminal} onClick={() => { selectTerminal(t.id); openPinned(t); onClose() }}>
          <Terminal size={14} />
          <span className="grow ellipsis">
            <span className="ellipsis">{t.label}</span>
            <span className="meta">{tilde(t.cwd)} · {relTime(t.lastSeen)}</span>
          </span>
        </button>
      ))}
      <div className="menu-sep" />
      <div className="menu-label">이 작업 공간의 대화 {sessions.length > 0 && <span className="muted">{sessions.length}</span>}</div>
      {sessions.length > 6 && <input autoFocus className="input session-find" placeholder="대화 찾기" value={find} onChange={e => setFind(e.target.value)} />}
      {sessions.length === 0 && <div className="menu-label" style={{ fontWeight: 400 }}>아직 없어</div>}
      {shown.map(s => (
        <button key={s.id} className="menu-item" aria-checked={!currentTerminal && s.id === currentSession} onClick={() => { void selectSession(s.id); onClose() }}>
          <span className={`dot ${s.status}`} />
          <span className="grow ellipsis">
            <span className="ellipsis">{s.title}</span>
            <span className="meta">{relTime(s.updated)} · {modelLabel(s.model)} · {s.turns}턴</span>
          </span>
        </button>
      ))}
    </Popover>
  )
}

const tilde = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')

/** A terminal picked in the menu brings the map it works from onto the canvas. */
function openPinned(t: TerminalInfo) {
  const canvas = useCanvas.getState()
  if (t.map && t.map !== canvas.name && canvas.list.some(m => m.name === t.map)) void canvas.open(t.map)
}

/** What the panel shows while a terminal is the target: where things go, instead of a transcript. */
function TerminalCard({ terminal }: { terminal?: TerminalInfo }) {
  useNow(true, 5000)
  const pinned = useCanvas(s => s.list.find(m => m.name === terminal?.map)?.title)
  if (!terminal) {
    return (
      <div className="terminal-card gone">
        <div className="terminal-card-head"><Terminal size={15} /><b>터미널이 닫혔어</b></div>
        <p>보내면 실패해. 대화 목록에서 다른 대화나 터미널을 골라 줘.</p>
      </div>
    )
  }
  return (
    <div className="terminal-card">
      <div className="terminal-card-head"><Terminal size={15} /><b className="ellipsis">{terminal.label}</b><span className="dot idle" /></div>
      <dl>
        <dt>폴더</dt><dd className="ellipsis" title={terminal.cwd}>{tilde(terminal.cwd)}</dd>
        <dt>마지막 연락</dt><dd>{relTime(terminal.lastSeen)}</dd>
        {terminal.map && <><dt>기준 지도</dt><dd className="ellipsis pinned-map" title={terminal.map}>{pinned ?? terminal.map}</dd></>}
      </dl>
      <p>여기 쓰는 말, 캔버스 코멘트와 결정, 리뷰 코멘트가 이 터미널의 Claude Code 세션으로 가. 답은 터미널에 나오고, 캔버스에서 보낸 건 그 스레드에도 달려.</p>
    </div>
  )
}

/** A live counter: whole seconds, then minutes and seconds. */
const clock = (sec: number) => (sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`)

/**
 * What the turn under way needs from the person, or else what the agent last said it is doing.
 * The activity ("명령 실행 중") is in the tooltip, and is the label until the agent says something.
 */
function StatusStrip({ t, session, onShow }: { t: Transcript; session: SessionInfo; onShow: (selector: string) => void }) {
  const interrupt = useApp(s => s.interrupt)
  const active = session.status === 'running' || session.status === 'waiting' || session.status === 'starting'
  const now = useNow(active)
  if (!active) return null
  const a = t.activity()
  const waits = t.waiting()
  const said = waits.length ? undefined : narration(t.blocks, now)
  const elapsed = t.turnStarted ? Math.max(0, Math.round((now - t.turnStarted) / 1000)) : 0
  return (
    <div className={`status-strip ${a.tone}`} title={a.label || '작업 중'}>
      <span className="orb"><i /><i /><i /></span>
      {waits.length
        ? <button className="label link" onClick={() => onShow(`[data-waiting="${waits[0].id}"]`)}>{waitLabel(waits)}</button>
        : said
          ? <><button className="label said" onClick={() => onShow(`[data-key="${said.key}"]`)}>{said.text}</button>{said.since && <span className="muted ago">· {relTime(said.since)}</span>}</>
          : <span className="label">{a.label || '작업 중'}</span>}
      {elapsed > 0 && <span className="muted elapsed">{clock(elapsed)}</span>}
      <span className="grow" />
      <button className="btn sm ghost" onClick={() => void interrupt()}>중단 <kbd>esc</kbd></button>
    </div>
  )
}

function Plan({ t }: { t: Transcript }) {
  const [open, setOpen] = useState(false)
  const todos = t.todos
  if (!todos?.length) return null
  const done = todos.filter(x => x.status === 'completed').length
  if (done === todos.length && t.status === 'idle') return null
  const current = todos.find(x => x.status === 'in_progress')
  return (
    <div className="plan-pin">
      <button className="plan-pin-head" onClick={() => setOpen(o => !o)}>
        <ListChecks size={13} />
        <span className="progress"><i style={{ width: `${(done / todos.length) * 100}%` }} /></span>
        <span className="muted">{done}/{todos.length}</span>
        <span className="grow ellipsis">{current ? current.activeForm ?? current.content : ''}</span>
        <ChevronDown size={12} className={open ? 'flip' : ''} />
      </button>
      {open && (
        <ul className="todo-list">
          {todos.map((x, i) => <li key={i} className={x.status}><span className="box">{x.status === 'completed' ? <Check size={11} /> : x.status === 'in_progress' ? <CircleDot size={10} /> : null}</span>{x.content}</li>)}
        </ul>
      )}
    </div>
  )
}

const SUGGESTIONS = [
  { title: '이 저장소 구조를 클래스 지도로', text: '이 저장소의 핵심 모듈 구조를 파악해서 캔버스에 클래스 지도로 그려 줘. 패키지는 group으로 묶고, 관계선에는 무엇이 오가는지 라벨을 달아 줘.' },
  { title: '작업 중인 변경 설명', text: '지금 작업 트리에 있는 변경(git diff)을 읽고, 무엇을 왜 바꿨는지 요약해 줘. 걱정되는 부분이 있으면 짚어 줘.' },
  { title: '요청 흐름을 시퀀스로', text: '이 프로젝트의 대표적인 요청 하나를 골라 처리 흐름을 캔버스에 시퀀스 지도로 그려 줘.' },
]

export function AgentPanel() {
  const { sessions, currentSession, workspace, toast, setDraft, setTab, focus, setFocus, terminals, currentTerminal } = useApp()
  const session = sessions.find(s => s.id === currentSession)
  const terminal = terminals.find(x => x.id === currentTerminal)
  const t = useTranscript(currentSession)
  const scroller = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(true)
  const menuRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const openFile = useReview(s => s.openFile)
  const setTurnSource = useReview(s => s.setTurnSource)
  const openMap = useCanvas(s => s.open)

  const ctx: ToolCtx = useMemo(() => ({
    root: workspace?.path,
    sessionId: currentSession,
    onOpenPath: (path, line) => { setTab('review'); void openFile(path, line) },
    onOpenCanvas: name => { setTab('canvas'); void openMap(name) },
  }), [workspace?.path, currentSession, setTab, openFile, openMap])

  const onReviewTurn = useCallback((turnId: string) => {
    if (!currentSession) return
    setTab('review')
    // Show the turn where it wrote most: the workspace, or another repo it wrote in (a tie goes to the other repo).
    const turn = transcriptOf(currentSession)?.blocks.find(b => b.kind === 'turn' && b.turnId === turnId)
    const s = turn?.kind === 'turn' ? turn.summary : undefined
    const elsewhere = s?.repos?.reduce((n, r) => n + r.files, 0) ?? 0
    const top = s?.repos?.slice().sort((a, b) => b.files - a.files)[0]
    const own = (s?.changes?.files ?? 0) - elsewhere
    const root = top && top.files >= own ? top.path : useReview.getState().home
    setTurnSource(currentSession, turnId, root)
  }, [currentSession, setTab, setTurnSource])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stuck) el.scrollTop = el.scrollHeight
  })
  useEffect(() => { setStuck(true) }, [currentSession])

  // Off the bottom first, so the next streamed delta does not pull the view back down.
  const show = useCallback((selector: string) => {
    const el = scroller.current?.querySelector(selector)
    if (!el) return
    setStuck(false)
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
  }

  const blocks = t?.blocks ?? []
  const status = session?.status ?? 'idle'

  return (
    <aside className="agent-panel">
      <header className="agent-head">
        <button ref={menuRef} className="session-pick" onClick={() => setMenu(m => !m)}>
          {currentTerminal
            ? <><Terminal size={13} /><span className="ellipsis">{terminal?.label ?? '닫힌 터미널'}</span></>
            : <><span className={`dot ${status}`} /><span className="ellipsis">{session?.title ?? '새 대화'}</span></>}
          <ChevronDown size={13} />
        </button>
        <span className="grow" />
        <button className={`focus-toggle ${focus ? 'on' : ''}`} aria-pressed={focus} onClick={() => setFocus(!focus)} title={focus ? '포커스 끄기 (⌘.)' : '포커스 (⌘.)'}>
          <Focus size={13} /> 포커스
        </button>
        {!currentTerminal && session?.claudeId && (
          <button
            className="iconbtn"
            title="claude --resume 명령 복사"
            onClick={() => {
              void navigator.clipboard.writeText(`cd ${JSON.stringify(session.workspace)} && claude --resume ${session.claudeId}`)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
              toast('복사했어')
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
        <button className="iconbtn" title="대화 목록" onClick={() => setMenu(true)}><History size={14} /></button>
        <button className="iconbtn" title="새 대화" onClick={() => void useApp.getState().newSession()}><Plus size={15} /></button>
        {!currentTerminal && session && status !== 'running' && (
          <button
            className="iconbtn"
            title="대화 지우기"
            onClick={async () => {
              if (!(await confirmDialog({ title: '이 대화를 목록에서 지울까?', body: 'Duet 목록에서만 사라지고, Claude Code 쪽 기록은 그대로 남아.', ok: '지우기', danger: true }))) return
              await api.del(`/api/sessions/${session.id}`)
              const rest = sessions.filter(s => s.id !== session.id)
              useApp.setState({ sessions: rest })
              await useApp.getState().selectSession(rest[0]?.id)
            }}
          ><Trash2 size={14} /></button>
        )}
        {menu && <SessionMenu anchor={menuRef.current} onClose={() => setMenu(false)} />}
      </header>

      <div className="transcript" ref={scroller} onScroll={onScroll}>
        {currentTerminal ? <TerminalCard terminal={terminal} /> : blocks.length === 0 ? (
          <div className="agent-empty">
            <div className="agent-empty-mark"><Sparkles size={18} /></div>
            <h3>무엇을 할까?</h3>
            <p>Claude Code가 이 작업 공간에서 일해.</p>
            <div className="suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s.title} onClick={() => setDraft(s.text)}>{s.title}</button>
              ))}
            </div>
          </div>
        ) : (
          focus
            ? <FocusBlocks blocks={blocks} ctx={ctx} running={status === 'running' || status === 'starting' || status === 'waiting'} onReviewTurn={onReviewTurn} />
            : <Blocks blocks={blocks} ctx={ctx} onReviewTurn={onReviewTurn} />
        )}
      </div>
      {!stuck && (
        <button className="jump" onClick={() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; setStuck(true) }}>
          <ArrowDown size={13} /> 최신으로
        </button>
      )}
      {!currentTerminal && t && <Plan t={t} />}
      {!currentTerminal && t && session && <StatusStrip t={t} session={session} onShow={show} />}
      {currentTerminal ? <Composer terminal /> : <Composer session={session} transcript={t} />}
    </aside>
  )
}
