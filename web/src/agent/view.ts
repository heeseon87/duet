import { labelOf, type CanvasMap } from '../../../shared/canvas.ts'
import type { ContextItem, DiffFile, DiffResult } from '../../../shared/protocol.ts'

/**
 * Claude Code's own commands. They take no arguments or read them as settings (`/model` followed by the view
 * answers "Model '<context from Duet>…' not found"), so the view never rides along; skills and plugin commands
 * get it as part of their arguments.
 */
const BUILTIN = new Set([
  'compact', 'clear', 'model', 'context', 'cost', 'help', 'init', 'memory', 'config', 'plugin', 'plugins', 'mcp', 'agents', 'hooks',
  'permissions', 'status', 'resume', 'export', 'doctor', 'login', 'logout', 'effort', 'fast', 'usage', 'add-dir', 'rewind',
  'output-style', 'statusline', 'theme', 'vim', 'ide', 'terminal-setup', 'release-notes', 'upgrade', 'exit', 'bug', 'feedback', 'todos', 'sandbox',
])

/** Whether a message may carry what the person is looking at: anything but a built-in command. */
export function takesView(text: string): boolean {
  const command = /^\/(\S+)/.exec(text.trim())?.[1]
  return !command || !BUILTIN.has(command)
}

const MAX_FILES = 60

/** `listed`: the files the review lists now; `scope`: the map part it is narrowed to. */
export function reviewView(diff: DiffResult, root: string, listed: DiffFile[], source: string, scope?: string): ContextItem {
  const label = [`리뷰: ${root.split('/').pop()}`, source, `파일 ${listed.length}개`, scope].filter(Boolean).join(' · ')
  return {
    kind: 'review-view', label, root, source: diff.source, base: diff.oldRef, head: diff.newRef,
    files: listed.slice(0, MAX_FILES).map(f => f.path), total: listed.length, scope,
  }
}

export function mapView(map: CanvasMap, name: string, revision: number, selected?: string): ContextItem {
  const part = selected && labelOf(map, selected)
  return {
    kind: 'map-view', label: `지도: ${map.title}${part ? ` · ${part}` : ''}`, map: name, title: map.title, revision,
    selected: selected && (part === selected ? selected : `${selected} (${part})`),
  }
}
