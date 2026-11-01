import type { ContextItem } from '../shared/protocol.ts'

/** The prompt text a terminal reads: the person's words, then what they pointed at. */
export function composePrompt(text: string, context?: ContextItem[]): string {
  if (!context?.length) return text
  return `${text}\n\n<context from Duet>\n${context.map(refOf).join('\n')}\n</context from Duet>`
}

function refOf(c: ContextItem): string {
  switch (c.kind) {
    case 'canvas': return `- canvas map "${c.map}", ${c.target ? `target ${c.target}` : 'whole map'} (${c.label})`
    case 'review': return `- ${c.path}${c.lines ? `:${c.lines}` : ''} (${c.label})`
    case 'file': return `- ${c.path}`
  }
}
