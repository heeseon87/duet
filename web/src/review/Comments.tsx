import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CornerDownLeft, MessageSquare, Pencil, Send, Trash2, Undo2, X, ArrowUpRight } from 'lucide-react'
import type { ReviewComment } from '../../../shared/protocol.ts'
import { Markdown } from '../lib/Markdown.tsx'
import { relTime } from '../lib/ui.tsx'
import { useApp } from '../state.ts'
import { useReview, type Draft } from './store.ts'

/** Drops the indentation every line shares, so a short excerpt starts at the code. */
function dedent(text: string): string {
  const lines = text.split('\n')
  const pad = Math.min(...lines.filter(l => l.trim()).map(l => /^\s*/.exec(l)![0].length))
  return Number.isFinite(pad) ? lines.map(l => l.slice(pad)).join('\n') : text
}

const range = (c: { startLine: number; endLine: number }) => (c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}–${c.endLine}`)

export function CommentEditor({ draft }: { draft: Draft }) {
  const { setDraft, saveComment, send, comments } = useReview()
  const existing = draft.editing ? comments.find(c => c.id === draft.editing) : undefined
  const [body, setBody] = useState(existing?.body ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const save = async (andSend: boolean) => {
    const saved = await saveComment(body)
    if (saved && andSend) await send([saved.id])
  }
  return (
    <div className="comment-editor fade-in" onMouseDown={e => e.stopPropagation()}>
      <div className="comment-where">
        <MessageSquare size={12} />
        {draft.side === 'old' ? '지운 쪽 ' : ''}{range({ startLine: draft.start, endLine: draft.end })}번 줄
      </div>
      <textarea
        ref={ref}
        className="input"
        rows={3}
        placeholder="코멘트 남기기"
        value={body}
        onChange={e => setBody(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.stopPropagation(); setDraft(undefined) }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void save(!e.shiftKey && !draft.editing) }
        }}
      />
      <div className="comment-actions">
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => setDraft(undefined)}>취소</button>
        <button className="btn sm" disabled={!body.trim()} onClick={() => void save(false)} title={draft.editing ? '⌘⏎' : '⇧⌘⏎'}>{draft.editing ? '저장' : '모아 두기'}</button>
        {!draft.editing && <button className="btn sm agent" disabled={!body.trim()} onClick={() => void save(true)}><Send size={12} /> 바로 보내기 <kbd>⌘⏎</kbd></button>}
      </div>
    </div>
  )
}

export function CommentCard({ c, compact }: { c: ReviewComment; compact?: boolean }) {
  const { setDraft, updateComment, removeComment, send, openFile } = useReview()
  const selectSession = useApp(s => s.selectSession)
  const state = c.outdated ? 'Outdated' : c.state === 'draft' ? 'Pending' : c.state === 'sent' ? 'Sent' : 'Resolved'
  // Sent to a terminal: there is no Duet conversation to open.
  const sentSession = c.state === 'sent' && c.sentTo && 'sessionId' in c.sentTo ? c.sentTo.sessionId : undefined
  return (
    <div className={`comment-card ${c.state}${c.outdated ? ' outdated' : ''}`}>
      <div className="comment-meta">
        {compact && <button className="link-btn" onClick={() => void openFile(c.path, c.startLine)}>{c.path.split('/').pop()}:{range(c)}</button>}
        <span className={`chip ${c.state === 'draft' ? 'accent' : c.state === 'sent' ? 'agent' : ''}`}>{state}</span>
        <span className="muted">{relTime(c.created)}</span>
        <span className="grow" />
        {c.state === 'draft' && <button className="iconbtn" title="보내기" onClick={() => void send([c.id])}><Send size={13} /></button>}
        {sentSession && <button className="iconbtn" title="보낸 대화 보기" onClick={() => void selectSession(sentSession)}><ArrowUpRight size={13} /></button>}
        {c.state !== 'resolved'
          ? <button className="iconbtn" title="Resolve" onClick={() => void updateComment(c.id, { state: 'resolved' })}><Check size={13} /></button>
          : <button className="iconbtn" title="Reopen" onClick={() => void updateComment(c.id, { state: 'draft' })}><Undo2 size={13} /></button>}
        <button className="iconbtn" title="고치기" onClick={() => setDraft({ path: c.path, side: c.side, start: c.startLine, end: c.endLine, excerpt: c.excerpt, editing: c.id })}><Pencil size={13} /></button>
        <button className="iconbtn" title="지우기" onClick={() => void removeComment(c.id)}><Trash2 size={13} /></button>
      </div>
      {compact && c.excerpt && <pre className="comment-excerpt">{dedent(c.excerpt).split('\n').slice(0, 3).join('\n')}</pre>}
      <div className="comment-body"><Markdown text={c.body} /></div>
    </div>
  )
}

/** Everything written in this review: collect, then send as one prompt. */
export function CommentsDock() {
  const { comments, send } = useReview()
  const [extra, setExtra] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const [newSession, setNewSession] = useState(false)
  const drafts = comments.filter(c => c.state === 'draft')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(drafts.map(c => c.id)))
  useEffect(() => { setPicked(new Set(useReview.getState().comments.filter(c => c.state === 'draft').map(c => c.id))) }, [comments.length])
  const visible = useMemo(() => comments.filter(c => showResolved || c.state !== 'resolved'), [comments, showResolved])
  const byFile = useMemo(() => {
    const m = new Map<string, ReviewComment[]>()
    for (const c of visible) m.set(c.path, [...(m.get(c.path) ?? []), c])
    for (const list of m.values()) list.sort((a, b) => a.startLine - b.startLine)
    return [...m.entries()]
  }, [visible])
  const pickedDrafts = drafts.filter(c => picked.has(c.id))
  const go = async () => {
    if (!pickedDrafts.length) return
    await send(pickedDrafts.map(c => c.id), extra, newSession)
    setExtra('')
  }
  return (
    <div className="dock">
      <header className="dock-head">
        <span className="muted">{drafts.length ? `${drafts.length} pending` : 'No pending comments'}</span>
        <span className="grow" />
        <label className="toggle"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> Show resolved</label>
      </header>
      <div className="dock-list">
        {byFile.length === 0 && (
          <div className="empty small">
            <p>코멘트가 없어. diff에서 줄 번호를 눌러 달아.</p>
          </div>
        )}
        {byFile.map(([path, list]) => (
          <div key={path} className="dock-file">
            <div className="dock-file-name">{path}</div>
            {list.map(c => (
              <div key={c.id} className="dock-item">
                {c.state === 'draft' && (
                  <input type="checkbox" checked={picked.has(c.id)} onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n })} />
                )}
                <CommentCard c={c} compact />
              </div>
            ))}
          </div>
        ))}
      </div>
      <footer className="dock-foot">
        <textarea className="input" rows={2} placeholder="덧붙일 말 (선택)" value={extra} onChange={e => setExtra(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void go() } }} />
        <div className="row">
          <label className="toggle"><input type="checkbox" checked={newSession} onChange={e => setNewSession(e.target.checked)} /> 새 대화로</label>
          <span className="grow" />
          <button className="btn agent" disabled={!pickedDrafts.length} onClick={() => void go()} title="⌘⏎">
            <CornerDownLeft size={13} /> {pickedDrafts.length}개 보내기
          </button>
        </div>
      </footer>
    </div>
  )
}
