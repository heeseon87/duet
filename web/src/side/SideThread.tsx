import { Fragment, useState } from 'react'
import { Bot, Forward, Loader2, User } from 'lucide-react'
import { TURN_LABEL, followUpOf, lastTurn, turnState, type SideChatView } from '../../../shared/side.ts'
import { Markdown } from '../lib/Markdown.tsx'
import { targetTerminal, useApp } from '../state.ts'
import { useSide } from './store.ts'

/**
 * A side chat's turns: each question, then its answer, the reason none came, or that it is still being answered; a line
 * where the chat moved to another session. `compact` (decision mode) carries its own follow-up box and ↗.
 */
export function SideThread({ chat, compact }: { chat: SideChatView; compact?: boolean }) {
  return (
    <div className={`side-thread${compact ? ' compact' : ''}`} data-chat={chat.id}>
      {chat.turns.map((t, i) => {
        const state = turnState(chat, i)
        return (
          <Fragment key={t.id}>
            {i > 0 && t.terminal !== chat.turns[i - 1].terminal && <div className="side-moved">여기부터 {t.terminalLabel}</div>}
            <div className="side-turn" data-state={state}>
              <div className="side-q"><span className="who"><User size={12} /></span><div className="grow">{t.question}</div></div>
              {t.reply?.kind === 'answer'
                ? <div className="side-a"><span className="who"><Bot size={12} /></span><div className="grow"><Markdown text={t.reply.text} /></div></div>
                : <div className={`side-state ${state}`}>{state === 'asking' && <Loader2 className="spin" size={12} />}{t.reply?.text ?? TURN_LABEL[state]}</div>}
            </div>
          </Fragment>
        )
      })}
      {compact && <FollowUp chat={chat} withMain />}
    </div>
  )
}

/**
 * The box for the next question on a chat. While the last waits it is shut; when the chat's session is gone it says so,
 * and asking moves the chat to the terminal picked on the rail, as the button says.
 */
export function FollowUp({ chat, withMain, autoFocus }: { chat: SideChatView; withMain?: boolean; autoFocus?: boolean }) {
  const terminals = useApp(s => s.terminals)
  const rail = useApp(targetTerminal)
  const text = useSide(s => s.drafts[chat.id] ?? '')
  const setDraft = useSide(s => s.setDraft)
  const [busy, setBusy] = useState(false)
  const state = followUpOf(chat, terminals)
  const railLive = terminals.find(t => t.id === rail)
  const go = async () => {
    const question = text.trim()
    if (!question || busy || state === 'asking' || (state === 'gone' && !railLive)) return
    setBusy(true)
    try {
      const asked = await useSide.getState().ask({ text: question, chat: chat.id, ...(state === 'gone' ? { moveTo: railLive?.id } : {}) })
      if (asked) setDraft(chat.id, '')
    } finally { setBusy(false) }
  }
  return (
    <div className="side-follow">
      {state === 'gone' && <div className="side-gone">{lastTurn(chat).terminalLabel} 세션이 닫혔거나 /clear로 바뀌었어. {railLive ? `이어 물으면 ${railLive.label}로 옮겨 물어.` : '레일에서 살아 있는 터미널을 골라 줘.'}</div>}
      <div className="side-follow-row">
        <textarea className="input grow" rows={1} autoFocus={autoFocus} value={text} disabled={state === 'asking'}
          placeholder={state === 'asking' ? '곁에서 답하는 중' : state === 'gone' ? '이어서 물을 말' : '이어서 묻기'}
          onChange={e => setDraft(chat.id, e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void go() } }} />
        {state === 'gone' && (
          <button className="btn sm side-move" disabled={!railLive || !text.trim() || busy} title={railLive ? `${railLive.label}에서 이어 묻기` : '레일의 터미널 칸에서 살아 있는 터미널을 골라 줘'} onClick={() => void go()}>
            지금 터미널에서 이어 묻기
          </button>
        )}
        {withMain && (
          <button className="iconbtn side-to-main" title="메인 대화로: 이 곁 대화의 문답과 마지막 질문을 보내 (하던 작업이 끝나면 한 턴으로 돌아)" onClick={() => void useSide.getState().toMain(chat.id)}>
            <Forward size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
