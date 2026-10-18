import type { SdkMessage } from '../../shared/protocol.ts'

/** What the context meter knows: the context the main agent's latest call read, and its model's window. */
export type Meter = { tokens?: number; window?: number; model?: string }

/** The context one call of the main agent read (fresh input, cache reads, cache writes); undefined for any other message. */
export function contextOf(msg: SdkMessage): number | undefined {
  if (msg.type !== 'assistant' || msg.parent_tool_use_id) return undefined
  const m = msg.message as { model?: string; usage?: Record<string, unknown> } | undefined
  // A local command (`/plugin`) answers with a synthetic message that read nothing.
  if (!m?.usage || m.model === '<synthetic>') return undefined
  const u = m.usage
  return (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) || undefined
}

/**
 * The meter after one logged message; the same object when nothing changed. A turn's result sums
 * every call of the turn, so the tokens come from single calls and only the window from the result.
 * A compaction's `post_tokens` leaves out the system prompt and tools, so the next call sets the value.
 */
export function metered(m: Meter, msg: SdkMessage): Meter {
  const tokens = contextOf(msg)
  if (tokens !== undefined) {
    const model = (msg.message as { model?: string }).model
    return tokens === m.tokens && model === m.model ? m : { ...m, tokens, model }
  }
  if (msg.type === 'result' && m.model) {
    // Side calls (titles, summaries) run on another model with its own entry.
    const usage = (msg.modelUsage ?? {}) as Record<string, { contextWindow?: number }>
    const key = m.model in usage ? m.model : Object.keys(usage).find(k => k.startsWith(m.model!))
    const window = key ? usage[key].contextWindow : undefined
    return window && window !== m.window ? { ...m, window } : m
  }
  return m
}
