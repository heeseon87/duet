import type { TerminalInfo } from '../../shared/protocol.ts'

/**
 * The terminal things go to: the one picked while it lives, else the only one live. A picked one that closed
 * stays the target while no other is alone, so a send fails out loud rather than going elsewhere unasked.
 */
export function targetTerminal(s: { terminals: readonly TerminalInfo[]; currentTerminal?: string }): string | undefined {
  if (s.currentTerminal && s.terminals.some(t => t.id === s.currentTerminal)) return s.currentTerminal
  return s.terminals.length === 1 ? s.terminals[0]!.id : s.currentTerminal
}

/** The terminal to send to, or why there is none, in words for the person. */
export function sendingTo(s: { terminals: readonly TerminalInfo[]; currentTerminal?: string }): { terminal: string } | { refused: string } {
  const terminal = targetTerminal(s)
  if (terminal) return { terminal }
  return { refused: s.terminals.length ? '보낼 터미널을 레일의 터미널 칸에서 골라 줘.' : '연결된 터미널이 없어. Claude Code 터미널에서 /duet을 켜 줘.' }
}

/**
 * What a terminal does, in words: `status`, whether its turn runs; `line`, what it waits on the person for (`isWaiting`),
 * else its last words, else none.
 */
export function doingOf(t: TerminalInfo): { status: string; line?: string; isWaiting: boolean } {
  const status = t.status === 'working' ? '일하는 중' : '쉬는 중'
  const w = t.activity?.waiting
  if (w) return { status, line: `터미널에서 ${w.kind === 'question' ? '답을' : '승인을'} 기다려 · ${w.text}`, isWaiting: true }
  return { status, line: t.activity?.said, isWaiting: false }
}
