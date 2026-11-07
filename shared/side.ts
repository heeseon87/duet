// Side chats: short branches off a terminal's conversation. Each question is answered by a fork of that conversation,
// at once and without tools, and nothing of it enters the conversation; the chat keeps the Q&A instead.

/** A decision or one of its options on a map. Set at creation, never changed. */
export type SideAnchor = { map: string; target: string }
/** `kind: 'failure'`: no answer came; `text` says why, in the person's words. */
export type SideReply = { kind: 'answer' | 'failure'; text: string; at: number }
/** One question and at most one fork reply. `id` is the ask id the terminal answers by; `terminal`: the session asked. */
export type SideTurn = { id: string; question: string; terminal: string; terminalLabel: string; at: number; reply?: SideReply }
/** A short branch off a terminal's conversation. Only the server's `Sides` writes it. */
export type SideChat = { id: string; about?: SideAnchor; turns: [SideTurn, ...SideTurn[]]; created: number }
/** As the browser gets it: whether the last turn's fork is still in its terminal's ask queue. */
export type SideChatView = SideChat & { isAsking: boolean }
export type TurnState = 'asking' | 'answered' | 'failed' | 'ended'

/** The session a follow-up goes to: whichever answered last. */
export const bindingOf = (c: SideChat): string => c.turns[c.turns.length - 1].terminal

export const lastTurn = (c: SideChat): SideTurn => c.turns[c.turns.length - 1]

const TITLE_MAX = 50

export function titleOf(c: SideChat): string {
  const line = c.turns[0].question.trim().split('\n')[0].trim()
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line
}

export function lastAt(c: SideChat): number {
  const t = lastTurn(c)
  return t.reply?.at ?? t.at
}

/** Only the last turn can still be waited on: an earlier one without a reply was given up on. */
export function turnState(c: SideChatView, i: number): TurnState {
  const reply = c.turns[i].reply
  if (reply) return reply.kind === 'answer' ? 'answered' : 'failed'
  return i === c.turns.length - 1 && c.isAsking ? 'asking' : 'ended'
}

export const TURN_LABEL: Record<TurnState, string> = { asking: '곁에서 답하는 중', answered: '', failed: '답 못 함', ended: '끝남 · 답 없음' }

/**
 * Whether a follow-up can be asked now: not while the last question waits, and not of a session that closed or was
 * cleared (`gone`; it can move to a live one instead). The server refuses by it and the browser renders by it.
 */
export function followUpOf(c: SideChatView, live: readonly { id: string }[]): 'ok' | 'asking' | 'gone' {
  if (c.isAsking) return 'asking'
  const bound = bindingOf(c)
  return live.some(t => t.id === bound) ? 'ok' : 'gone'
}

/** The chats about a decision or its options, oldest first. */
export function chatsAbout<C extends SideChat>(all: C[], map: string, d: { id: string; options: { id: string }[] }): C[] {
  const about = new Set([d.id, ...d.options.map(o => o.id)])
  return all.filter(c => c.about?.map === map && about.has(c.about.target)).sort((a, b) => a.created - b.created)
}
