import { memo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Block, ToolBlock } from './transcript.ts'
import { focusTurns, type Part } from './focusModel.ts'
import { workSentence } from './workSummary.ts'
import { BlockView } from './BlockView.tsx'
import { Blocks } from './Blocks.tsx'
import { Status, ToolCall, toolHead, type ToolCtx } from './ToolCall.tsx'

// Focus: each turn reads as a timeline, the way Claude Code prints it. What the agent says along
// the way and what waits for the person stay in full; the work between them becomes one line
// ("Thought for 7s, read 1 file, ran 2 shell commands"), and only the call in flight shows on its own line until it
// finishes and joins the line.

const finished = (t: ToolBlock) => t.state === 'done' || t.state === 'error'
const inFlight = (t: ToolBlock) => t.state === 'running' || t.state === 'input'

/** The tool call in flight: what it does, on what, and for how long. Opens to its full card. */
const LiveTool = memo(function LiveTool({ t, ctx }: { t: ToolBlock; ctx: ToolCtx; rev: number }) {
  const [open, setOpen] = useState(false)
  const head = toolHead(t, ctx)
  return (
    <div className="live-tool">
      {/* Not a <button>: a button centers content wider than itself, pushing a long command off both edges. */}
      <div className="live-tool-head" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }} title={open ? '접기' : '펼치기'}>
        <span className="tool-icon">{head.icon}</span>
        <span className="tool-title">{head.title}</span>
        <span className="tool-sub">{head.sub}</span>
        <Status t={t} />
      </div>
      {open && <div className="live-tool-body"><ToolCall t={t} ctx={ctx} rev={t.rev} /></div>}
    </div>
  )
}, (a, b) => a.rev === b.rev && a.t === b.t && a.ctx === b.ctx)

/** A run of work between two things the agent said: the finished calls as a count, the live ones as lines. */
const Run = memo(function Run({ blocks, ctx }: { blocks: Block[]; ctx: ToolCtx; sig: string }) {
  const [open, setOpen] = useState(false)
  const tools = blocks.filter((b): b is ToolBlock => b.kind === 'tool')
  const done = tools.filter(finished)
  const live = tools.filter(inFlight)
  const thinking = blocks.filter(b => b.kind === 'thinking' && b.streaming)
  // Work without tool calls (thinking, a note): its own rows, already compact.
  if (!tools.length) return <>{blocks.map(b => <div key={b.key} className={`ftl-item ${b.kind === 'thinking' && b.streaming ? 'live' : ''}`}><BlockView block={b} ctx={ctx} /></div>)}</>
  return (
    <div className={`ftl-item run ${live.length || thinking.length ? 'live' : ''}`}>
      {done.length > 0 && (
        <button className="run-head" onClick={() => setOpen(o => !o)} title={open ? '접기' : '펼치기'}>
          <span className="run-tally">{workSentence(blocks.filter(b => (b.kind === 'tool' ? finished(b) : !(b.kind === 'thinking' && b.streaming))))}</span>
          <ChevronRight size={12} className={`chev ${open ? 'open' : ''}`} />
        </button>
      )}
      {open && <div className="run-body"><Blocks blocks={blocks.filter(b => b.kind !== 'tool' || finished(b))} ctx={ctx} /></div>}
      {thinking.map(b => <BlockView key={b.key} block={b} ctx={ctx} />)}
      {live.map(t => <LiveTool key={t.key} t={t} ctx={ctx} rev={t.rev} />)}
    </div>
  )
}, (a, b) => a.sig === b.sig && a.ctx === b.ctx)

function TimelinePart({ p, ctx }: { p: Part; ctx: ToolCtx }) {
  if (p.kind === 'work') return <Run blocks={p.blocks} ctx={ctx} sig={p.blocks.map(b => `${b.key}:${b.rev}`).join(',')} />
  const b = p.block
  const kind = b.kind === 'text' ? 'say' : 'ask'
  return <div className={`ftl-item ${kind} ${b.kind === 'text' && b.streaming ? 'live' : ''}`}><BlockView block={b} ctx={ctx} /></div>
}

export function FocusBlocks({ blocks, ctx, running, onReviewTurn }: { blocks: Block[]; ctx: ToolCtx; running: boolean; onReviewTurn?: (turnId: string) => void }) {
  return (
    <>
      {focusTurns(blocks, running).map(t => (
        <div key={t.key} className="focus-turn">
          {t.asked.map(b => <BlockView key={b.key} block={b} ctx={ctx} />)}
          {(t.parts.length > 0 || t.live) && (
            <div className={`ftl ${t.live ? 'running' : ''}`}>
              {t.parts.map(p => <TimelinePart key={p.kind === 'work' ? p.key : p.block.key} p={p} ctx={ctx} />)}
              {t.live && !t.parts.length && <div className="ftl-item live"><span className="muted small">시작하는 중…</span></div>}
            </div>
          )}
          {t.foot && <BlockView block={t.foot} ctx={ctx} onReviewTurn={onReviewTurn} />}
          {t.later.map(b => <BlockView key={b.key} block={b} ctx={ctx} />)}
        </div>
      ))}
    </>
  )
}
