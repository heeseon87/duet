import { useState } from 'react'
import { Bot, Check, Forward, Send, Undo2, User } from 'lucide-react'
import { deliveryLabel, type CanvasDecision, type DecisionWhyTag } from '../../../shared/canvas.ts'
import type { CanvasThread } from '../../../shared/protocol.ts'
import { relTime } from '../lib/ui.tsx'
import { Markdown } from '../lib/Markdown.tsx'
import { useApp } from '../state.ts'
import { useCanvas } from './store.ts'

/** Pieces of a decision and its threads: decision mode's, and the canvas's ask box. */

export const WHY_TAG_LABEL: Record<DecisionWhyTag, string> = { convention: '관례가 둘', scope: '이 일 밖에 미침', irreversible: '되돌리기 어려움', context: '네가 아는 것', tie: '무게가 비슷' }

export const letterOf = (d: CanvasDecision, optionId: string) => optionId.replace(`${d.id}-`, '')

/** Why the agent asks instead of going on: its tags, then its sentence. */
export function WhyAsk({ why }: { why: NonNullable<CanvasDecision['why']> }) {
  return (
    <div className="decision-ask">
      <div className="decision-ask-head">왜 Claude가 혼자 정하지 않았나</div>
      <div className="ask-tags">{why.tags.map(t => <span key={t} className="ask-tag">{WHY_TAG_LABEL[t]}</span>)}</div>
      <div className="decision-ask-text">{why.text}</div>
    </div>
  )
}

/** Where the latest thing sent about this target stands with the agent. */
export function DeliveryLine({ target }: { target: string }) {
  const threads = useCanvas(s => s.threads)
  const deliveries = useCanvas(s => s.deliveries)
  const last = threads.filter(t => t.target === target).flatMap(t => t.items).filter(i => deliveries[i.id]).sort((a, b) => a.ts - b.ts).pop()
  return last ? <div className="delivery">{deliveryLabel(deliveries[last.id])}</div> : null
}

/** A thread's items and reply box. A side thread's reply is another side question; its last question can go to the main conversation. */
export function ThreadView({ t }: { t: CanvasThread }) {
  const { comment, askSide, setThread, deliveries } = useCanvas()
  const [reply, setReply] = useState('')
  const send = (text: string) => (t.side ? askSide(t.target, text, t.id) : comment(t.target, text, t.id))
  const lastAsked = t.side ? [...t.items].reverse().find(i => i.who === 'person') : undefined
  return (
    <div className={`thread ${t.state}${t.side ? ' side' : ''}`}>
      {t.items.map(i => (
        <div key={i.id} className={`thread-item ${i.who}`}>
          <span className="who">{i.who === 'agent' ? <Bot size={12} /> : <User size={12} />}</span>
          <div className="grow">
            <Markdown text={i.text} /><span className="meta">{relTime(i.ts)}{t.side ? ' · 곁질문' : i.terminal ? ' · 터미널' : ''}</span>
            {deliveries[i.id] && <div className="delivery">{deliveryLabel(deliveries[i.id])}</div>}
          </div>
        </div>
      ))}
      <div className="thread-actions">
        <input className="input grow" placeholder={t.side ? '이어서 곁질문' : '답글'} value={reply} onChange={e => setReply(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && reply.trim()) void send(reply).then(ok => { if (ok) setReply('') }) }} />
        {lastAsked && (
          <button className="iconbtn thread-to-main" title="이 질문을 메인 대화로 보내기 (하던 작업이 끝나면 한 턴으로 돌아)"
            onClick={() => void comment(t.target, lastAsked.text).then(ok => { if (ok) useApp.getState().toast('메인 대화로 보냈어') })}><Forward size={13} /></button>
        )}
        {t.state === 'open'
          ? <button className="iconbtn" title="Resolve" onClick={() => void setThread(t.id, 'resolved')}><Check size={13} /></button>
          : <button className="iconbtn" title="Reopen" onClick={() => void setThread(t.id, 'open')}><Undo2 size={13} /></button>}
      </div>
    </div>
  )
}

/** `side`: a side question, answered from a fork of the conversation instead of a turn of it. */
export function Ask({ target, placeholder, autoFocus, side, onSent }: { target: string; placeholder: string; autoFocus?: boolean; side?: boolean; onSent?: () => void }) {
  const comment = useCanvas(s => s.comment), askSide = useCanvas(s => s.askSide)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!text.trim()) return
    setBusy(true)
    try { if (await (side ? askSide : comment)(target, text)) { setText(''); onSent?.() } } finally { setBusy(false) }
  }
  return (
    <div className="cv-ask">
      <textarea className="input" rows={3} autoFocus={autoFocus} placeholder={placeholder} value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void go() } }} />
      <div className="row">
        <span className="grow" />
        <button className="btn sm agent" disabled={!text.trim() || busy} onClick={() => void go()}><Send size={12} /> {side ? '곁에서 묻기' : '에이전트에게'} <kbd>⌘⏎</kbd></button>
      </div>
    </div>
  )
}
