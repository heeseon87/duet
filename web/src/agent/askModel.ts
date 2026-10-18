import { partialInput, type ToolBlock } from './transcript.ts'

export type Question = { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string }[] }

/** One question once its card closed: the options picked, words typed instead, or neither (skipped). */
export type Answer = { q: Question; picked: string[]; own?: string }

/** How each question was answered, read from what the tool returned, so a reload keeps it. Undefined until the call has ended. */
export function answersOf(t: ToolBlock): Answer[] | undefined {
  if (t.state !== 'done' && t.state !== 'error') return undefined
  const meta = (t.resultMeta && typeof t.resultMeta === 'object' ? t.resultMeta : {}) as { questions?: Question[]; answers?: Record<string, string> }
  const questions = meta.questions ?? (partialInput(t).questions as Question[] | undefined) ?? []
  return questions.map(q => {
    const raw = meta.answers?.[q.question]?.trim() ?? ''
    const labels = q.options.map(o => o.label)
    if (labels.includes(raw)) return { q, picked: [raw] }
    // Several picks and typed words come joined with ", ", the way the card sends them.
    const parts = raw ? raw.split(', ') : []
    const own = parts.filter(p => !labels.includes(p)).join(', ')
    return { q, picked: labels.filter(l => parts.includes(l)), own: own || undefined }
  })
}
