import { memo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Block, ToolBlock } from './transcript.ts'
import { BlockView } from './BlockView.tsx'
import type { ToolCtx } from './ToolCall.tsx'
import { workSentence } from './workSummary.ts'

/**
 * Work worth seeing on demand, not worth a card each: looking around, shell commands, the web.
 * Edits, new files, subagents and anything waiting for the person keep their own cards.
 */
const FOLDABLE = new Set(['Read', 'Grep', 'Glob', 'LS', 'ToolSearch', 'NotebookRead', 'Bash', 'WebFetch', 'WebSearch', 'mcp__duet__canvas_read', 'mcp__duet__canvas_list'])

const quiet = (b: Block): b is ToolBlock => b.kind === 'tool' && FOLDABLE.has(b.name) && (b.state === 'done' || b.state === 'error') && b.permission?.state !== 'pending'
const settled = (b: Block) => b.kind === 'thinking' && !b.streaming

type Item = { kind: 'one'; block: Block } | { kind: 'group'; key: string; blocks: Block[]; tools: ToolBlock[] }

/**
 * Finished thinking and quiet tool calls in a row fold into one line ("Thought for 23s, ran 6 shell commands"),
 * as long as the run holds a tool call and more than that one call alone.
 */
function groupBlocks(blocks: Block[]): Item[] {
  const out: Item[] = []
  let run: Block[] = []
  const flush = () => {
    // Thinking at the end of a run belongs to what comes next (an edit, the answer).
    let tail: Block[] = []
    while (run.length && run[run.length - 1].kind === 'thinking') tail = [run.pop()!, ...tail]
    const tools = run.filter((b): b is ToolBlock => b.kind === 'tool')
    if (tools.length && run.length >= 2) out.push({ kind: 'group', key: run[0].key, blocks: run, tools })
    else for (const b of run) out.push({ kind: 'one', block: b })
    for (const b of tail) out.push({ kind: 'one', block: b })
    run = []
  }
  for (const b of blocks) {
    if (quiet(b) || settled(b)) run.push(b)
    else { flush(); out.push({ kind: 'one', block: b }) }
  }
  flush()
  return out
}

const Group = memo(function Group({ blocks, tools, ctx }: { blocks: Block[]; tools: ToolBlock[]; ctx: ToolCtx; sig: string }) {
  const [open, setOpen] = useState(false)
  const failed = tools.some(t => t.state === 'error')
  return (
    <div className={`explore ${open ? 'open' : ''} ${failed ? 'failed' : ''}`}>
      <button className="explore-head" onClick={() => setOpen(o => !o)} title={open ? '접기' : '펼치기'}>
        <ChevronRight size={13} className={`chev ${open ? 'open' : ''}`} />
        <span className="explore-line">{workSentence(blocks)}</span>
      </button>
      {open && <div className="explore-body">{blocks.map(b => <BlockView key={b.key} block={b} ctx={ctx} nested />)}</div>}
    </div>
  )
}, (a, b) => a.sig === b.sig && a.ctx === b.ctx)

export function Blocks({ blocks, ctx, nested, onReviewTurn }: { blocks: Block[]; ctx: ToolCtx; nested?: boolean; onReviewTurn?: (turnId: string) => void }) {
  return (
    <>
      {groupBlocks(blocks).map(item => item.kind === 'one'
        ? <BlockView key={item.block.key} block={item.block} ctx={ctx} nested={nested} onReviewTurn={onReviewTurn} />
        : <Group key={item.key} blocks={item.blocks} tools={item.tools} ctx={ctx} sig={item.blocks.map(b => `${b.key}:${b.rev}`).join(',')} />)}
    </>
  )
}
