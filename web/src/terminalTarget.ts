import type { TerminalInfo } from '../../shared/protocol.ts'

/**
 * The terminal things go to: the one picked while it lives, else the only one live. A picked one that closed
 * stays the target while no other is alone, so a send fails out loud rather than going elsewhere unasked.
 */
export function targetTerminal(s: { terminals: readonly TerminalInfo[]; currentTerminal?: string }): string | undefined {
  if (s.currentTerminal && s.terminals.some(t => t.id === s.currentTerminal)) return s.currentTerminal
  return s.terminals.length === 1 ? s.terminals[0]!.id : s.currentTerminal
}
