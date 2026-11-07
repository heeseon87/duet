import type { CanvasDecision } from '../shared/canvas.ts'
import type { CanvasThread } from '../shared/protocol.ts'

// Side questions on a decision: asked of a fork of a terminal's conversation, which answers at once with no tools and
// leaves no trace in that conversation; the main agent hears of them only with the decision, in `sideDigest`.

/** The longest answer kept on a thread, as for a terminal's reply. */
export const ANSWER_MAX = 1500

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

/**
 * What the fork reads after the conversation: what it is (the 11/1 trial showed a fork asked mid-turn goes on with the
 * turn's work unless told), the decision as the person sees it, the thread so far (the fork remembers no earlier
 * fork), and the question.
 */
export function sidePrompt(a: {
  title: string
  name: string
  revision: number
  decision: CanvasDecision
  target: string
  earlier: { who: 'person' | 'agent'; text: string }[]
  question: string
}): string {
  const d = a.decision
  const seen = d.options.find(o => o.id === a.target)
  const lines = [
    '[Duet 곁질문] 사람이 Duet 결정 화면에서 결정을 고르기 전에 묻는 곁질문이야.',
    '- 도구는 없어. 지금까지의 대화와 아래 내용만으로, 오래 생각하지 말고 바로 답해.',
    '- 하던 작업을 이어 가지 말고, 이 질문에만 짧게 답해.',
    '- 대화에서 확인하지 못한 것은 모른다고 하고, 확인하려면 무엇을 봐야 하는지 말해.',
    '- 이 질문과 답은 네 대화 기록에 남지 않고 결정 화면의 스레드에만 보여. 사람이 결정을 보낼 때 함께 전해져.',
    '',
    `지도 "${a.title}" (${a.name}, rev ${a.revision})`,
    `결정 ${d.id}: ${d.question}`,
    ...(d.why ? [`사람에게 묻는 이유: ${d.why.text} (${d.why.tags.join(', ')})`] : []),
    '선택지:',
    ...d.options.map(o => `- ${o.id} ${o.text}${o.impact ? ` · 영향: ${o.impact}` : ''}${d.recommended === o.id ? ' (네 추천)' : ''}`),
    ...(seen ? [`사람이 보고 있는 선택지: ${seen.id} ${seen.text}`] : []),
  ]
  const earlier = a.earlier.slice(-6)
  if (earlier.length) lines.push('', '이 스레드에서 앞서 나눈 말:', ...earlier.map(i => `- ${i.who === 'person' ? '사람' : '너'}: ${cut(i.text, 600)}`))
  lines.push('', `질문: ${a.question}`)
  return lines.join('\n')
}

/** The digest of a decision's side threads is cut here, so a decision asked about at length stays one prompt. */
const DIGEST_MAX = 2000
const DIGEST_HEAD = '- 곁질문(결정 전에 사람이 물었고, 네 대화 기록에는 없어. 답은 네 대화에서 갈라진 곁 답이야):'

/**
 * The side questions asked about a decision or its options, with the fork's answers: what the main agent did not see,
 * passed on with the decision. Empty when none were asked.
 */
export function sideDigest(threads: CanvasThread[], d: CanvasDecision): string[] {
  const about = new Set([d.id, ...d.options.map(o => o.id)])
  const out: string[] = []
  let size = 0
  for (const t of threads) {
    if (!t.side || !about.has(t.target)) continue
    for (const [i, item] of t.items.entries()) {
      if (item.who !== 'person') continue
      const answer = t.items[i + 1]?.who === 'agent' ? t.items[i + 1].text : undefined
      const pair = [`  - ${t.target}에 대해 물음: ${cut(item.text, 300)}`, `    곁 답: ${answer ? cut(answer, 400) : '없음'}`]
      size += pair.join('\n').length
      if (size > DIGEST_MAX) {
        out.push('  - (곁질문이 더 있어. 결정 화면의 스레드에 남아 있어)')
        return [DIGEST_HEAD, ...out]
      }
      out.push(...pair)
    }
  }
  return out.length ? [DIGEST_HEAD, ...out] : []
}

/** What the thread says when the fork gave no answer, in the person's words. */
export function sideFailure(reason: string | undefined, status?: number): string {
  if (reason === 'nothing-to-fork') return '이 터미널에는 아직 곁질문에 쓸 대화가 없어. 첫 턴이 끝나기 전이거나 /clear 뒤야.'
  if (reason === 'api-error') return `API 오류${status ? ` ${status}` : ''} 때문에 곁질문에 답하지 못했어.`
  if (reason === 'empty-reply') return '곁질문에 빈 답이 왔어.'
  if (reason === 'aborted') return '곁질문이 중간에 끊겼어.'
  return `곁질문에 답하지 못했어${reason ? ` (${cut(reason, 200)})` : ''}.`
}
