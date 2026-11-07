import { useEffect, useRef, useState } from 'react'
import { Forward, History, SquarePen, Trash2, X } from 'lucide-react'
import { bindingOf, lastAt, lastTurn, titleOf, type SideChatView } from '../../../shared/side.ts'
import type { TerminalInfo } from '../../../shared/protocol.ts'
import { confirmDialog } from '../lib/confirm.tsx'
import { relTime } from '../lib/ui.tsx'
import { local, targetTerminal, useApp } from '../state.ts'
import { useCanvas } from '../canvas/store.ts'
import { FollowUp, SideThread } from './SideThread.tsx'
import { useSide } from './store.ts'

const dotOf = (t: TerminalInfo | undefined) => (t ? (t.activity?.waiting ? 'waiting' : t.status) : 'gone')

const WIDTH = 380
const WIDTH_MIN = 300
/** The main area keeps at least this much beside the drawer. */
const MAIN_MIN = 480
const fitWidth = (w: number) => Math.round(Math.max(WIDTH_MIN, Math.min(w, window.innerWidth - MAIN_MIN)))

/** The drawer's width, dragged by its right edge and remembered; a double-click puts it back. */
function useDrawerWidth() {
  const [wanted, setWanted] = useState(() => Number(local.get('side.width')) || WIDTH)
  const [dragging, setDragging] = useState(false)
  const width = fitWidth(wanted)
  const drag = (e: React.PointerEvent) => {
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    let last = width
    setDragging(true)
    const move = (m: PointerEvent) => { last = fitWidth(width + m.clientX - x0); setWanted(last) }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      setDragging(false)
      local.set('side.width', String(last))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }
  const reset = () => { setWanted(WIDTH); local.set('side.width', String(WIDTH)) }
  return { width, dragging, drag, reset }
}

/** What a chat is about, for its row: the decision and its map, else the session it is bound to. */
function useAboutLabel() {
  const maps = useCanvas(s => s.list)
  return (c: SideChatView) => (c.about ? `${c.about.target} · ${maps.find(m => m.name === c.about?.map)?.title ?? c.about.map}` : lastTurn(c).terminalLabel)
}

/**
 * The side chat drawer (⌘J), beside whatever the main area shows: one chat at a time, a new one, or the list of them.
 * A chat is a short branch off a terminal's conversation; esc in an empty box closes the drawer and nothing else.
 */
export function SidePanel() {
  const chats = useSide(s => s.chats), shown = useSide(s => s.shown), listing = useSide(s => s.listing)
  const { show, setListing, toggle } = useSide.getState()
  const terminals = useApp(s => s.terminals)
  const rail = useApp(targetTerminal)
  const aboutLabel = useAboutLabel()
  const chat = shown === 'new' ? undefined : chats.find(c => c.id === shown)
  const head = chat ? terminals.find(t => t.id === bindingOf(chat)) : terminals.find(t => t.id === rail)
  const headLabel = chat ? lastTurn(chat).terminalLabel : head?.label ?? '보낼 터미널 없음'
  const panel = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const size = useDrawerWidth()
  const turns = chat?.turns.length ?? 0
  const lastReply = chat ? lastTurn(chat).reply?.at : undefined

  // Opened, or moved to another chat: the box takes the keys.
  useEffect(() => {
    if (!listing) panel.current?.querySelector<HTMLTextAreaElement>('.side-panel-foot textarea:not(:disabled)')?.focus()
  }, [shown, listing])
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight }) }, [shown, turns, lastReply])

  // esc in an empty box closes the drawer only: decision mode under it stays open.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
    const t = e.target as HTMLTextAreaElement
    if (t.tagName === 'TEXTAREA' && t.value === '') { e.preventDefault(); e.stopPropagation(); toggle() }
  }

  return (
    <aside ref={panel} className="side-panel" aria-label="사이드 채팅" style={{ width: size.width, flexBasis: size.width }} onKeyDown={onKeyDown}>
      <div className={`side-split${size.dragging ? ' dragging' : ''}`} onPointerDown={size.drag} onDoubleClick={size.reset} title="끌어서 너비 조절, 두 번 누르면 처음 너비로" />
      <header className="side-panel-head">
        <span className={`term-dot ${dotOf(head)}`} title={head ? '살아 있는 세션' : '세션이 닫혔어'} />
        <span className="side-panel-term ellipsis" title={chat ? `이 사이드 채팅이 묶인 세션: ${headLabel}` : `새 사이드 채팅을 받을 터미널: ${headLabel}`}>{headLabel}</span>
        <span className="grow" />
        <button className="btn sm ghost side-new" onClick={() => show('new')} title="새 사이드 채팅"><SquarePen size={13} /> 새 사이드 채팅</button>
        <button className="btn sm ghost side-history-btn" aria-pressed={listing} onClick={() => setListing(!listing)} title="사이드 채팅 기록"><History size={13} /> 기록</button>
        <button className="iconbtn side-to-main" disabled={!chat} title="메인 대화로: 이 사이드 채팅의 문답과 마지막 질문을 보내 (하던 작업이 끝나면 한 턴으로 돌아)"
          aria-label="메인 대화로" onClick={() => chat && void useSide.getState().toMain(chat.id)}><Forward size={14} /></button>
        <button className="iconbtn" title="닫기 (⌘J)" aria-label="닫기" onClick={toggle}><X size={14} /></button>
      </header>
      {listing ? <SideHistory chats={chats} shown={chat?.id} aboutLabel={aboutLabel} terminals={terminals} /> : (
        <>
          <div ref={body} className="side-panel-body quiet-scroll">
            {chat ? (
              <>
                <div className="side-panel-title"><b>{titleOf(chat)}</b>{chat.about && <span className="chip side-chip">{aboutLabel(chat)}</span>}</div>
                <SideThread chat={chat} />
              </>
            ) : (
              <div className="side-empty">
                <h3>사이드 채팅</h3>
                <p>메인 대화에서 갈라져 묻는 대화야. {head ? <b>{head.label}</b> : '레일에서 고른 터미널'}의 지금까지 대화로 도구 없이 바로 답하고, 하던 일은 멈추지 않아. 문답은 그 대화 기록에 남지 않고 여기 기록에만 남아.</p>
                <p className="muted">이어서 물으면 앞선 문답을 같이 보내. 메인 대화가 알아야 하면 ↗로 보내.</p>
              </div>
            )}
          </div>
          <div className="side-panel-foot">{chat ? <FollowUp chat={chat} /> : <NewAsk />}</div>
        </>
      )}
    </aside>
  )
}

/** The first question of a chat not started yet: the chat comes to be with it, on the terminal picked on the rail. */
function NewAsk() {
  const text = useSide(s => s.drafts.new ?? '')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    const question = text.trim()
    if (!question || busy) return
    setBusy(true)
    try {
      const c = await useSide.getState().ask({ text: question })
      if (c) { useSide.getState().setDraft('new', ''); useSide.getState().show(c.id) }
    } finally { setBusy(false) }
  }
  return (
    <div className="side-follow">
      <div className="side-follow-row">
        <textarea className="input grow" rows={2} value={text} placeholder="곁에서 물을 말 (⏎ 묻기, ⇧⏎ 줄바꿈)" disabled={busy}
          onChange={e => useSide.getState().setDraft('new', e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void go() } }} />
      </div>
    </div>
  )
}

/** 기록: every chat, the most recently active first; a click reopens one. */
function SideHistory({ chats, shown, aboutLabel, terminals }: { chats: SideChatView[]; shown?: string; aboutLabel: (c: SideChatView) => string; terminals: TerminalInfo[] }) {
  const sorted = [...chats].sort((a, b) => lastAt(b) - lastAt(a))
  const remove = async (c: SideChatView) => {
    if (await confirmDialog({ title: '이 사이드 채팅을 지울까?', body: titleOf(c), ok: '지우기', danger: true })) await useSide.getState().remove(c.id)
  }
  if (!sorted.length) return <div className="side-panel-body quiet-scroll"><div className="side-empty muted">아직 사이드 채팅이 없어.</div></div>
  return (
    <div className="side-panel-body side-history quiet-scroll">
      {sorted.map(c => (
        <div key={c.id} role="button" tabIndex={0} className="side-row" data-chat={c.id} aria-current={c.id === shown}
          onClick={() => useSide.getState().show(c.id)} onKeyDown={e => { if (e.key === 'Enter') useSide.getState().show(c.id) }}>
          <div className="side-row-text">
            <div className="side-row-title ellipsis">{titleOf(c)}</div>
            <div className="side-row-meta">
              <span className="chip side-chip ellipsis">{aboutLabel(c)}</span>
              <span>{c.turns.length}문답</span>
              <span>{relTime(lastAt(c))}</span>
              {c.isAsking ? <span className="side-row-asking">답하는 중</span> : !terminals.some(t => t.id === bindingOf(c)) && <span className="side-row-gone">세션 끝남</span>}
            </div>
          </div>
          <button className="iconbtn side-row-del" title="지우기" aria-label="지우기" onClick={e => { e.stopPropagation(); void remove(c) }}><Trash2 size={13} /></button>
        </div>
      ))}
    </div>
  )
}
