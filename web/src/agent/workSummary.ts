import type { Block, ToolBlock } from './transcript.ts'

const path = (t: ToolBlock) => String((t.input?.file_path ?? t.input?.notebook_path ?? '') as string)
/** Files touched, each once (a call without a path counts as one). */
const unique = (tools: ToolBlock[]) => new Set(tools.map(path).filter(Boolean)).size || tools.length

function seconds(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A stretch of work told in one line, the way Claude Code folds it: "Thought for 7s, read 1 file, ran 2 shell commands". */
export function workSentence(blocks: Block[]): string {
  const tools = blocks.filter((b): b is ToolBlock => b.kind === 'tool')
  const of = (...names: string[]) => tools.filter(t => names.includes(t.name))
  const thought = blocks.reduce((ms, b) => ms + (b.kind === 'thinking' && b.ended ? b.ended - b.started : 0), 0)
  const canvasRead = tools.filter(t => /^mcp__duet__canvas_(read|list)$/.test(t.name))
  const canvasWrite = tools.filter(t => t.name.startsWith('mcp__duet__canvas_') && !canvasRead.includes(t))
  const known = new Set(['Read', 'NotebookRead', 'Grep', 'Glob', 'LS', 'ToolSearch', 'Bash', 'Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'TodoWrite'])
  const other = tools.filter(t => !known.has(t.name) && !t.name.startsWith('mcp__duet__canvas_'))
  const parts: string[] = []
  const add = (n: number, say: (n: number) => string) => { if (n) parts.push(say(n)) }
  if (thought >= 1000) parts.push(`thought for ${seconds(thought)}`)
  add(unique(of('Read', 'NotebookRead')), n => `read ${count(n, 'file')}`)
  add(of('Grep', 'Glob', 'LS', 'ToolSearch').length, n => `searched for ${count(n, 'pattern')}`)
  add(of('Bash').length, n => `ran ${count(n, 'shell command')}`)
  add(unique(of('Edit', 'MultiEdit', 'NotebookEdit')), n => `edited ${count(n, 'file')}`)
  add(unique(of('Write')), n => `wrote ${count(n, 'file')}`)
  add(of('WebFetch').length, n => `fetched ${count(n, 'page')}`)
  add(of('WebSearch').length, n => `ran ${count(n, 'web search', 'web searches')}`)
  add(canvasRead.length, n => `viewed the canvas${n > 1 ? ` ${n} times` : ''}`)
  add(canvasWrite.length, n => `updated the canvas${n > 1 ? ` ${n} times` : ''}`)
  add(of('Task', 'Agent').length, n => `ran ${count(n, 'subagent')}`)
  add(Number(of('TodoWrite').length > 0), () => 'updated todos')
  add(other.length, n => `used ${count(n, 'tool')}`)
  const line = parts.join(', ').replace(/^./, c => c.toUpperCase())
  const failed = tools.filter(t => t.state === 'error').length
  return failed ? `${line} (${failed} failed)` : line
}
