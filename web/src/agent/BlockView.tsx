import { memo, useState } from 'react'
import { Brain, Check, ChevronRight, CircleAlert, Copy, Eye, FileDiff, Info, MessageSquareQuote, Shapes, TriangleAlert, Clock, Maximize2, History, BookOpen } from 'lucide-react'
import { plain, thinkingGist, type Block, type ThinkingBlock, type TurnBlock, type UserBlock } from './transcript.ts'
import { Markdown } from '../lib/Markdown.tsx'
import { OrphanPermission, ToolCall, type ToolCtx } from './ToolCall.tsx'
import { duration, useNow } from '../lib/ui.tsx'
import { useApp } from '../state.ts'

const Thinking = memo(function Thinking({ b }: { b: ThinkingBlock; rev: number }) {
  const [open, setOpen] = useState(false)
  const now = useNow(b.streaming)
  const ms = (b.ended ?? now) - b.started
  const empty = !b.text.trim()
  // Folded, the row still says what the thinking was about: the latest line while it runs, its gist after.
  const preview = empty ? '' : b.streaming ? plain(b.text.trim().split('\n').filter(Boolean).pop() ?? '') : thinkingGist(b.text)
  return (
    <div className={`thinking ${b.streaming ? 'live' : ''}`}>
      <button className="thinking-head" onClick={() => setOpen(o => !o)} disabled={empty && !b.streaming} aria-label={b.streaming ? '생각하는 중' : '생각'} title={open ? '접기' : '생각 펼치기'}>
        <ChevronRight size={13} className={`chev ${open ? 'open' : ''}`} />
        <Brain size={13} />
        {ms > 400 && <span className="muted">{duration(ms)}</span>}
        {!open && preview && <span className="thinking-ticker" title={b.streaming ? undefined : preview}>{preview}</span>}
      </button>
      {open && !empty && <div className="thinking-body"><Markdown text={b.text} /></div>}
    </div>
  )
}, (a, b) => a.rev === b.rev)

/** The summary Claude Code wrote when the conversation was compacted: folded, readable wide. */
const Summary = memo(function Summary({ b, sessionId }: { b: UserBlock; rev: number; sessionId?: string }) {
  const [open, setOpen] = useState(false)
  const openReader = useApp(s => s.openReader)
  return (
    <div className={`summary-card ${open ? 'open' : ''}`}>
      <div className="summary-head">
        <History size={13} />
        <b>이전 대화 요약</b>
        <span className="grow" />
        {sessionId && <button className="btn sm ghost" onClick={() => openReader(sessionId, b.key)}><BookOpen size={13} /> 넓게 읽기</button>}
      </div>
      <div className="summary-body"><Markdown text={b.text} /></div>
      <button className="summary-more" onClick={() => setOpen(o => !o)}>{open ? '접기' : '펼치기'}</button>
    </div>
  )
}, (a, b) => a.rev === b.rev)

const User = memo(function User({ b, sessionId }: { b: UserBlock; rev: number; sessionId?: string }) {
  const [open, setOpen] = useState(false)
  const long = b.text.length > 700 || b.text.split('\n').length > 14
  const isReview = /코멘트 \d+개/.test(b.text.split('\n')[0] ?? '') && b.context?.some(c => c.kind === 'review')
  const isCanvas = b.text.startsWith('[캔버스 코멘트]')
  const canvasTarget = isCanvas ? b.context?.find(c => c.kind === 'canvas')?.label : undefined
  return (
    <div className={`msg-user ${b.queued ? 'queued' : ''}`}>
      {(isReview || isCanvas) && (
        <div className="msg-user-kind">
          {isReview ? <><FileDiff size={12} /> 리뷰 코멘트</> : <><Shapes size={12} /> 캔버스 · {canvasTarget ?? '지도 전체'}</>}
        </div>
      )}
      <div className={`msg-user-text ${long && !open ? 'clamped' : ''}`}>
        {b.display && isCanvas ? <p>{b.display}</p> : isCanvas ? <Markdown text={b.text.replace(/^\[캔버스 코멘트\] /, '').replace(/\n\n\(thread [^)]*\)$/, '')} /> : isReview ? <Markdown text={b.text} /> : <p>{b.text}</p>}
      </div>
      {long && <button className="more" onClick={() => setOpen(o => !o)}>{open ? '접기' : '전체 보기'}</button>}
      {b.context && b.context.length > 0 && !isReview && !isCanvas && (
        <div className="ctx-chips">
          {b.context.map((c, i) => <span key={i} className="chip">{c.kind === 'review-view' || c.kind === 'map-view' ? <Eye size={11} /> : <MessageSquareQuote size={11} />}{c.label}</span>)}
        </div>
      )}
      {b.images && b.images.length > 0 && sessionId && (
        <div className="msg-images">
          {b.images.map(img => (
            <a key={img.file} href={`/api/sessions/${sessionId}/files/${img.file}`} target="_blank" rel="noreferrer"><img src={`/api/sessions/${sessionId}/files/${img.file}`} alt="붙인 이미지" /></a>
          ))}
        </div>
      )}
      {b.queued && <div className="queued-tag"><Clock size={11} /> 대기열</div>}
    </div>
  )
}, (a, b) => a.rev === b.rev)

const Turn = memo(function Turn({ b, onReviewTurn }: { b: TurnBlock; rev: number; onReviewTurn?: (turnId: string) => void }) {
  const s = b.summary
  return (
    <div className={`turn-foot ${s?.isError ? 'error' : ''}`}>
      <span className="line" />
      {s ? (
        <>
          <span>{duration(s.durationMs)}</span>
          {s.isError && <span className="chip del">{s.subtype === 'error_during_execution' ? '중단됨' : s.subtype}</span>}
        </>
      ) : <span>끝</span>}
      {onReviewTurn && (!s?.changes || s.changes.files > 0) && (
        <button className="link-btn" onClick={() => onReviewTurn(b.turnId)}>
          <FileDiff size={12} />
          {s?.changes ? <>파일 {s.changes.files}개 <b className="add">+{s.changes.additions}</b> <b className="del">−{s.changes.deletions}</b></> : '이 턴의 변경'}
        </button>
      )}
      <span className="line" />
    </div>
  )
}, (a, b) => a.rev === b.rev)

/** Long answers, or ones with headings, tables or diagrams, read better wide. */
const LONG = 900
const isDocument = (text: string) => text.length > LONG || /^#{1,3} |^\|.*\|$|^```mermaid/m.test(text)

function AnswerTools({ text, sessionId, blockKey }: { text: string; sessionId?: string; blockKey: string }) {
  const [done, setDone] = useState(false)
  const openReader = useApp(s => s.openReader)
  return (
    <span className="msg-tools">
      {sessionId && <button className="iconbtn" title="넓게 읽기" onClick={() => openReader(sessionId, blockKey)}><Maximize2 size={13} /></button>}
      <button className="iconbtn" title="마크다운으로 복사" onClick={() => { void navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) }}>
        {done ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </span>
  )
}

function ReadWide({ sessionId, blockKey }: { sessionId: string; blockKey: string }) {
  const openReader = useApp(s => s.openReader)
  const reading = useApp(s => s.reader?.key === blockKey)
  return (
    <button className={`read-wide ${reading ? 'on' : ''}`} onClick={() => openReader(sessionId, blockKey)}>
      <BookOpen size={12} /> {reading ? '왼쪽에서 읽는 중' : '넓게 읽기'}
    </button>
  )
}

export function BlockView({ block, ctx, nested, onReviewTurn }: { block: Block; ctx: ToolCtx; nested?: boolean; onReviewTurn?: (turnId: string) => void }) {
  switch (block.kind) {
    case 'user':
      if (nested) return null
      return block.summary ? <Summary b={block} rev={block.rev} sessionId={ctx.sessionId} /> : <User b={block} rev={block.rev} sessionId={ctx.sessionId} />
    case 'text':
      return block.text.trim() || block.streaming
        ? (
          <div className={`msg-agent ${nested ? 'nested' : ''}`} data-key={block.key}>
            <Markdown text={block.text} streaming={block.streaming} onOpenPath={ctx.onOpenPath} />
            {block.streaming ? <span className="caret" /> : <AnswerTools text={block.text} sessionId={nested ? undefined : ctx.sessionId} blockKey={block.key} />}
            {!nested && ctx.sessionId && isDocument(block.text) && <ReadWide sessionId={ctx.sessionId} blockKey={block.key} />}
          </div>
        )
        : null
    case 'thinking':
      return <Thinking b={block} rev={block.rev} />
    case 'tool':
      return <ToolCall t={block} ctx={ctx} rev={block.rev} />
    case 'turn':
      return nested ? null : <Turn b={block} rev={block.rev} onReviewTurn={onReviewTurn} />
    case 'notice':
      return (
        <div className={`notice ${block.level}`}>
          {block.level === 'error' ? <CircleAlert size={13} /> : block.level === 'warn' ? <TriangleAlert size={13} /> : <Info size={13} />}
          <span>{block.text}</span>
        </div>
      )
    case 'permission':
      return <OrphanPermission p={block.permission} />
  }
}
