import type { CanvasDecision } from '../shared/canvas.ts'
import type { CanvasThread, TerminalInfo } from '../shared/protocol.ts'
import { bindingOf, chatsAbout, followUpOf, lastAt, lastTurn, type SideAnchor, type SideChat, type SideChatView, type SideReply, type SideTurn } from '../shared/side.ts'
import type { Terminals } from './terminals.ts'
import { HttpError, newId, readJson, writeJson } from './util.ts'

// Side chats: each question is asked of a fork of a terminal's conversation, which answers at once with no tools and
// leaves no trace in that conversation. The chat keeps the Q&A, and a follow-up replays it, as no fork remembers another.
// The main agent hears of a decision's side Q&A only with the decision, in `sideDigest`.

/** The longest side answer kept. */
export const ANSWER_MAX = 4000
/** Earlier Q&A replayed per prompt, newest kept; the newest earlier answer is kept up to ANSWER_MAX, older ones to A_CUT. */
const REPLAY_BUDGET = 6000
const Q_CUT = 600
const A_CUT = 1500
/** Chats kept per workspace; the least recently active go first. */
const CHATS_MAX = 200

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** `chat`: a follow-up (`moveTo` only when its session is gone); `about`: a new chat on a decision; else a new workspace chat. */
export type SideQuestion =
  | { chat: string; question: string; moveTo?: string }
  | { about: SideAnchor; question: string; terminal?: string }
  | { question: string; terminal?: string }
/** What the terminal sent back: the fork's answer, or why it gave none. */
export type Outcome = { answer: string } | { reason?: string; status?: number }
/** The decision a chat is about, as the person sees it now; `opener`: the terminal whose agent brought it onto the map. */
export type DecisionContext = { title: string; name: string; revision: number; decision: CanvasDecision; target: string; opener?: string }

function decisionBlock(c: DecisionContext): string[] {
  const d = c.decision
  const seen = d.options.find(o => o.id === c.target)
  return [
    `지도 "${c.title}" (${c.name}, rev ${c.revision})`,
    `결정 ${d.id}: ${d.question}`,
    ...(d.why ? [`사람에게 묻는 이유: ${d.why.text} (${d.why.tags.join(', ')})`] : []),
    '선택지:',
    ...d.options.map(o => `- ${o.id} ${o.text}${o.impact ? ` · 영향: ${o.impact}` : ''}${d.recommended === o.id ? ' (네 추천)' : ''}`),
    ...(seen ? [`사람이 보고 있는 선택지: ${seen.id} ${seen.text}`] : []),
  ]
}

/**
 * What the fork reads after the conversation: what it is (the 11/1 trial showed a fork asked mid-turn goes on with the
 * turn's work unless told), the decision for a decision chat, the chat so far, and the question.
 */
export function sidePrompt(a: { decision?: DecisionContext; earlier: string[]; question: string }): string {
  const lines = [
    '[Duet 곁질문] 사람이 Duet에서 하던 일 옆으로 묻는 곁질문이야.',
    '- 도구는 없어. 지금까지의 대화와 아래 내용만으로, 오래 생각하지 말고 바로 답해.',
    '- 하던 작업을 이어 가지 말고, 이 질문에만 답해.',
    '- 대화에서 확인하지 못한 것은 모른다고 하고, 확인하려면 무엇을 봐야 하는지 말해.',
    `- 이 문답은 네 대화 기록에 남지 않고 Duet의 사이드 채팅에만 남아.${a.decision ? ' 사람이 결정을 보낼 때 함께 전해져.' : ''}`,
  ]
  if (a.decision) lines.push('', ...decisionBlock(a.decision))
  if (a.earlier.length) lines.push('', '이 사이드 채팅에서 앞서 나눈 말 (오래된 것부터):', ...a.earlier)
  lines.push('', `질문: ${a.question}`)
  return lines.join('\n')
}

type Answered = SideTurn & { reply: SideReply & { kind: 'answer' } }
const isAnswered = (t: SideTurn): t is Answered => t.reply?.kind === 'answer'

/** The answered turns that fit the budget, newest first, given back oldest first; `dropped` counts the older ones left out. */
function replay(turns: SideTurn[], line: (t: Answered, answerCut: number) => string[]): { lines: string[]; dropped: number; kept: Answered[] } {
  const answered = turns.filter(isAnswered)
  const kept: Answered[] = []
  const lines: string[][] = []
  let size = 0
  for (let i = answered.length - 1; i >= 0; i--) {
    const pair = line(answered[i], lines.length ? A_CUT : ANSWER_MAX)
    const n = pair.join('\n').length
    if (lines.length && size + n > REPLAY_BUDGET) break
    lines.unshift(pair)
    kept.unshift(answered[i])
    size += n
  }
  return { lines: lines.flat(), dropped: answered.length - kept.length, kept }
}

/**
 * The chat so far as a fork of `asked` reads it: answered turns within the budget, oldest first, with `※` on those
 * another session answered (this fork's conversation may lack what they stood on).
 */
export function earlierOf(turns: SideTurn[], asked: string): string[] {
  const { lines, dropped, kept } = replay(turns, (t, answerCut) => {
    const mark = t.terminal === asked ? '' : '※ '
    return [`- ${mark}사람: ${cut(t.question, Q_CUT)}`, `- ${mark}너: ${cut(t.reply.text, answerCut)}`]
  })
  return [
    ...(dropped ? [`(앞선 문답 ${dropped}개는 줄였어)`] : []),
    ...(kept.some(t => t.terminal !== asked) ? ['(※는 다른 세션에서 나눈 문답이야. 네 대화에는 그 바탕이 없을 수 있어.)'] : []),
    ...lines,
  ]
}

/** A chat taken to the main conversation (↗): its Q&A, which the main agent never saw, and its last question to take up. */
export function mainPrompt(c: SideChat): string {
  const { lines, dropped } = replay(c.turns, (t, answerCut) => [`- 사람: ${cut(t.question, Q_CUT)}`, `- 곁 답: ${cut(t.reply.text, answerCut)}`])
  return [
    '[Duet 사이드 채팅] 사람이 Duet에서 네 대화 옆으로 나눈 사이드 채팅이야. 곁 답은 네 대화에서 갈라진 fork가 도구 없이 바로 한 답이라, 너는 이 문답을 보지 못했어.',
    ...(lines.length ? ['', '사이드 채팅의 문답 (오래된 것부터):', ...(dropped ? [`(앞선 문답 ${dropped}개는 줄였어)`] : []), ...lines] : []),
    '',
    '이 사이드 채팅의 마지막 질문을 메인 대화에서 이어 받아 줘. 필요하면 확인해서 답해:',
    lastTurn(c).question,
  ].join('\n')
}

/** The digest of a decision's side Q&A is cut here, so a decision asked about at length stays one prompt. */
const DIGEST_MAX = 2000
const DIGEST_HEAD = '- 곁질문(결정 전에 사람이 물었고, 네 대화 기록에는 없어. 답은 네 대화에서 갈라진 곁 답이야):'

/**
 * The side questions asked about a decision or its options, with the fork's answers: what the main agent did not see,
 * passed on with the decision. Empty when none were asked.
 */
export function sideDigest(chats: SideChat[], map: string, d: CanvasDecision): string[] {
  const out: string[] = []
  let size = 0
  for (const c of chatsAbout(chats, map, d)) {
    for (const t of c.turns) {
      const answer = isAnswered(t) ? t.reply.text : undefined
      const pair = [`  - ${c.about?.target}에 대해 물음: ${cut(t.question, 300)}`, `    곁 답: ${answer ? cut(answer, 400) : '없음'}`]
      size += pair.join('\n').length
      if (size > DIGEST_MAX) {
        out.push('  - (곁질문이 더 있어. 사이드 채팅 기록에 남아 있어)')
        return [DIGEST_HEAD, ...out]
      }
      out.push(...pair)
    }
  }
  return out.length ? [DIGEST_HEAD, ...out] : []
}

/** What a turn says when the fork gave no answer, in the person's words. */
export function sideFailure(reason: string | undefined, status?: number): string {
  if (reason === 'nothing-to-fork') return '이 터미널에는 아직 곁질문에 쓸 대화가 없어. 첫 턴이 끝나기 전이거나 /clear 뒤야.'
  if (reason === 'api-error') return `API 오류${status ? ` ${status}` : ''} 때문에 곁질문에 답하지 못했어.`
  if (reason === 'empty-reply') return '곁질문에 빈 답이 왔어.'
  if (reason === 'aborted') return '곁질문이 중간에 끊겼어.'
  return `곁질문에 답하지 못했어${reason ? ` (${cut(reason, 200)})` : ''}.`
}

/** What `sideFailure` wrote on a side thread before side chats: those items were kept as the agent's. */
const FAILED = /^(이 터미널에는 아직 곁질문에 쓸 대화가 없어\.|API 오류( \d+)? 때문에 곁질문에 답하지 못했어\.$|곁질문에 빈 답이 왔어\.$|곁질문이 중간에 끊겼어\.$|곁질문에 답하지 못했어( \(.*\))?\.$)/s

/** A map's side threads from before side chats, as chats: the chat keeps the thread's id, each question becomes a turn. */
export function adoptThreads(map: string, threads: (CanvasThread & { side?: true })[]): SideChat[] {
  const out: SideChat[] = []
  for (const t of threads) {
    if (!t.side) continue
    const turns: SideTurn[] = []
    t.items.forEach((item, i) => {
      if (item.who !== 'person') return
      const next = t.items[i + 1]
      const terminal = item.terminal ?? ''
      const reply: SideReply | undefined = next?.who === 'agent' ? { kind: FAILED.test(next.text) ? 'failure' : 'answer', text: next.text, at: next.ts } : undefined
      // Those items named no label: the session id's start stands in.
      turns.push({ id: item.messageId ?? item.id, question: item.text, terminal, terminalLabel: terminal.slice(0, 8), at: item.ts, ...(reply ? { reply } : {}) })
    })
    const [first, ...rest] = turns
    if (first) out.push({ id: t.id, about: { map, target: t.target }, turns: [first, ...rest], created: t.created })
  }
  return out
}

type Deps = {
  terminals: Terminals
  /** The file a workspace's chats are kept in. */
  file: (ws: string) => string
  /** `gone`: the chat was deleted. */
  changed: (ws: string, chat: string, gone?: true) => void
  decision: (ws: string, about: SideAnchor) => DecisionContext | undefined
}

/** A workspace's side chats: the only writer of them, and where every side answer lands. */
export class Sides {
  /** Where each ask belongs, so its answer lands by ask id alone. In memory: a reply after a restart is dropped. */
  private asks = new Map<string, { ws: string; chat: string }>()

  constructor(private deps: Deps) {}

  private read(ws: string): SideChat[] {
    return readJson<{ chats?: SideChat[] }>(this.deps.file(ws), {}).chats ?? []
  }

  private write(ws: string, chats: SideChat[]) {
    const kept = chats.length > CHATS_MAX ? [...chats].sort((a, b) => lastAt(b) - lastAt(a)).slice(0, CHATS_MAX) : chats
    writeJson(this.deps.file(ws), { chats: kept })
  }

  private view(c: SideChat): SideChatView {
    const t = lastTurn(c)
    return { ...c, isAsking: !t.reply && this.deps.terminals.isAsking(t.terminal, t.id) }
  }

  /** The most recently active first. */
  list(ws: string): SideChatView[] {
    return this.read(ws).map(c => this.view(c)).sort((a, b) => lastAt(b) - lastAt(a))
  }

  get(ws: string, id: string): SideChatView {
    const c = this.read(ws).find(x => x.id === id)
    if (!c) throw new HttpError(404, '그 사이드 채팅은 없어')
    return this.view(c)
  }

  /**
   * Asks a fork and keeps the question on its chat. A follow-up goes to the session that answered last and never to
   * another, unless that one is gone and `moveTo` names a live one; a decision chat starts with the terminal that opened
   * the decision while it is there. Every refusal comes before anything is written.
   */
  ask(ws: string, q: SideQuestion): SideChatView {
    const { terminals } = this.deps
    const all = this.read(ws)
    const live = terminals.list(ws)
    let chat: SideChat | undefined
    let about: SideAnchor | undefined
    let decision: DecisionContext | undefined
    let to: TerminalInfo
    if ('chat' in q) {
      chat = all.find(c => c.id === q.chat)
      if (!chat) throw new HttpError(404, '그 사이드 채팅은 없어')
      const state = followUpOf(this.view(chat), live)
      if (state === 'asking') throw new HttpError(409, '앞 질문의 답을 아직 기다려')
      if (state === 'gone') {
        const moved = live.find(t => t.id === q.moveTo)
        if (!moved) throw new HttpError(410, `${lastTurn(chat).terminalLabel} 세션이 닫혔거나 /clear로 바뀌었어`)
        to = moved
      } else to = terminals.get(bindingOf(chat))
      about = chat.about
      // A decision since taken off the map leaves the follow-up without its block.
      decision = about && this.deps.decision(ws, about)
    } else if ('about' in q) {
      decision = this.deps.decision(ws, q.about)
      if (!decision) throw new HttpError(400, '곁질문은 지도에 있는 결정이나 그 선택지에만 할 수 있어')
      about = q.about
      const opener = decision.opener
      to = live.find(t => t.id === opener && terminals.canAsk(t.id)) ?? terminals.target(ws, q.terminal)
    } else to = terminals.target(ws, q.terminal)
    if (!terminals.canAsk(to.id)) throw new HttpError(409, '이 터미널의 Duet mod는 곁질문을 몰라. mod를 새로 받거나 메인 대화로 물어 줘.')

    const turn: SideTurn = { id: newId('a-'), question: q.question, terminal: to.id, terminalLabel: to.label, at: Date.now() }
    const prompt = sidePrompt({ decision, earlier: chat ? earlierOf(chat.turns, to.id) : [], question: q.question })
    const next: SideChat = chat
      ? { ...chat, turns: [chat.turns[0], ...chat.turns.slice(1), turn] }
      : { id: newId('s-'), ...(about ? { about } : {}), turns: [turn], created: turn.at }
    this.write(ws, chat ? all.map(c => (c.id === next.id ? next : c)) : [...all, next])
    this.asks.set(turn.id, { ws, chat: next.id })
    terminals.ask(to.id, { id: turn.id, prompt })
    this.deps.changed(ws, next.id)
    return this.view(next)
  }

  /** The terminal's reply to an ask, by ask id only: the first reply wins, and one for an ask not known here is dropped. */
  settle(askId: string, outcome: Outcome) {
    const at = this.asks.get(askId)
    if (!at) return
    this.asks.delete(askId)
    const all = this.read(at.ws)
    const chat = all.find(c => c.id === at.chat)
    const turn = chat?.turns.find(t => t.id === askId)
    if (!chat || !turn || turn.reply) return
    turn.reply = 'answer' in outcome
      ? { kind: 'answer', text: cut(outcome.answer, ANSWER_MAX), at: Date.now() }
      : { kind: 'failure', text: sideFailure(outcome.reason, outcome.status), at: Date.now() }
    this.write(at.ws, all)
    this.deps.changed(at.ws, chat.id)
  }

  /** Asks no terminal holds any more (timed out, or their terminal closed): their turns read as ended. A late reply still lands. */
  dropped(askIds: string[]) {
    const seen = new Set<string>()
    for (const id of askIds) {
      const at = this.asks.get(id)
      if (!at || seen.has(`${at.ws}\0${at.chat}`)) continue
      seen.add(`${at.ws}\0${at.chat}`)
      this.deps.changed(at.ws, at.chat)
    }
  }

  remove(ws: string, id: string) {
    const all = this.read(ws)
    const rest = all.filter(c => c.id !== id)
    if (rest.length === all.length) return
    this.write(ws, rest)
    this.deps.changed(ws, id, true)
  }

  /** Takes in side threads from before side chats; a thread already taken in is left alone, so this runs on every start. */
  adopt(ws: string, legacy: { map: string; threads: (CanvasThread & { side?: true })[] }[]) {
    const all = this.read(ws)
    const have = new Set(all.map(c => c.id))
    const fresh = legacy.flatMap(l => adoptThreads(l.map, l.threads)).filter(c => !have.has(c.id))
    if (fresh.length) this.write(ws, [...all, ...fresh])
  }
}
