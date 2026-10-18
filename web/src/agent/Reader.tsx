import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDownToLine, BookOpen, Check, ChevronLeft, ChevronRight, Copy, History, X } from 'lucide-react'
import { transcriptOf, useApp } from '../state.ts'
import { useReview } from '../review/store.ts'
import { Markdown } from '../lib/Markdown.tsx'
import { readableBlocks } from './transcript.ts'

type Heading = { id: string; text: string; level: number }

/** An answer (or a compaction summary) opened wide over the stage, set like a document. */
export function Reader() {
  const reader = useApp(s => s.reader)
  const close = useApp(s => s.closeReader)
  const open = useApp(s => s.openReader)
  const setTab = useApp(s => s.setTab)
  const session = useApp(s => s.sessions.find(x => x.id === reader?.sessionId))
  useApp(s => (reader ? s.versions[reader.sessionId] : 0))
  const openFile = useReview(s => s.openFile)
  const doc = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [toc, setToc] = useState<Heading[]>([])
  const [copied, setCopied] = useState(false)

  const t = transcriptOf(reader?.sessionId)
  const list = t ? readableBlocks(t.blocks) : []
  const index = list.findIndex(b => b.key === reader?.key)
  const block = index >= 0 ? list[index] : undefined
  const go = (i: number) => { if (reader && list[i]) open(reader.sessionId, list[i].key) }

  // Esc closes the reader before the app treats it as "stop the agent".
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')
      if (e.key === 'Escape' && !typing) { e.preventDefault(); e.stopImmediatePropagation(); close() }
      else if (!typing && (e.key === '[' || e.key === ']')) { e.preventDefault(); go(index + (e.key === ']' ? 1 : -1)) }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  })

  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [reader?.key])

  // The table of contents comes from the rendered headings, so it matches what is on the page.
  const text = block?.text ?? ''
  useLayoutEffect(() => {
    const hs = [...(doc.current?.querySelectorAll('h1, h2, h3') ?? [])] as HTMLElement[]
    hs.forEach((h, i) => { h.id = `rd-${i}` })
    const next = hs.map((h, i) => ({ id: `rd-${i}`, text: h.textContent ?? '', level: Number(h.tagName[1]) }))
    setToc(cur => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next))
  }, [text])

  if (!reader) return null
  if (!block) {
    return (
      <div className="reader">
        <div className="empty"><p>이 답변을 찾지 못했어.</p><button className="btn sm" onClick={close}>닫기</button></div>
      </div>
    )
  }
  const isSummary = block.kind === 'user'
  const streaming = block.kind === 'text' && block.streaming
  const latest = list.length - 1
  return (
    <div className="reader">
      <header className="reader-head">
        {isSummary ? <History size={15} /> : <BookOpen size={15} />}
        <b>{isSummary ? '이전 대화 요약' : '답변'}</b>
        <span className="muted ellipsis">{session?.title}</span>
        <span className="grow" />
        <span className="reader-pos muted">{index + 1} / {list.length}</span>
        <button className="iconbtn" title="이전 답변 ([)" disabled={index <= 0} onClick={() => go(index - 1)}><ChevronLeft size={15} /></button>
        <button className="iconbtn" title="다음 답변 (])" disabled={index >= latest} onClick={() => go(index + 1)}><ChevronRight size={15} /></button>
        <button className="btn sm ghost" disabled={index === latest} onClick={() => go(latest)} title="가장 최근 답변"><ArrowDownToLine size={13} /> 최신</button>
        <button className="iconbtn" title="마크다운으로 복사" onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button className="iconbtn" title="닫기 (esc)" onClick={close}><X size={16} /></button>
      </header>
      <div className="reader-scroll" ref={scroller}>
        <div className={`reader-body ${toc.length >= 3 ? 'with-toc' : ''}`}>
          <article className="reader-doc" ref={doc}>
            <Markdown text={text} streaming={streaming} onOpenPath={(path, line) => { close(); setTab('review'); void openFile(path, line) }} />
            {streaming && <span className="caret" />}
          </article>
          {toc.length >= 3 && (
            <nav className="reader-toc">
              <div className="menu-label">목차</div>
              {toc.map(h => (
                <button key={h.id} className={`toc-item l${h.level}`} onClick={() => doc.current?.querySelector(`#${h.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{h.text}</button>
              ))}
            </nav>
          )}
        </div>
      </div>
    </div>
  )
}
