import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsDown, ChevronsUp, Eye, EyeOff, FileCode2, Loader2, MessageSquarePlus, UnfoldVertical, Copy } from 'lucide-react'
import type { DiffFile, DiffResult, ReviewComment } from '../../../shared/protocol.ts'
import { api, q } from '../api.ts'
import { CodeText, Line, useTokens } from '../lib/Code.tsx'
import type { TokenLines } from '../lib/highlight.ts'
import { Markdown } from '../lib/Markdown.tsx'
import { splitRows, unifiedRows, widestCols, type Expansion, type Seg, type Side } from './diffModel.ts'
import { useReview, type Draft } from './store.ts'
import { CommentCard, CommentEditor } from './Comments.tsx'

/** Whole old/new texts, for highlighting with full context and for expanding gaps. */
function useTexts(root: string | undefined, diff: DiffResult | undefined, file: DiffFile | undefined) {
  const [texts, setTexts] = useState<{ old: string; new: string; key: string } | null>(null)
  const key = `${diff?.oldRef}|${diff?.newRef}|${file?.path}|${diff?.generatedAt}`
  useEffect(() => {
    if (!root || !diff || !file || file.binary) { setTexts(null); return }
    let live = true
    const oldPath = file.oldPath ?? file.path
    const needOld = file.status !== 'added' && file.status !== 'untracked'
    const needNew = file.status !== 'deleted'
    void Promise.all([
      needOld ? api.get<{ text: string }>(`/api/git/file${q({ ws: root, ref: diff.oldRef, path: oldPath })}`) : Promise.resolve({ text: '' }),
      needNew ? api.get<{ text: string }>(`/api/git/file${q({ ws: root, ref: diff.newRef, path: file.path })}`) : Promise.resolve({ text: '' }),
    ]).then(([o, n]) => { if (live) setTexts({ old: o.text, new: n.text, key }) }).catch(() => { if (live) setTexts({ old: '', new: '', key }) })
    return () => { live = false }
  }, [root, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return texts && texts.key === key ? texts : null
}


type Anchor = { side: 'old' | 'new'; no: number }

/** Lines one ↑ or ↓ opens in a hidden stretch. */
const STEP = 20

export const DiffView = memo(function DiffView({ file }: { file: DiffFile }) {
  const { root, diff, mode, wrap, comments, draft, setDraft, viewed, toggleViewed, focusLine, openFile } = useReview()
  const texts = useTexts(root, diff, file)
  const oldLines = useMemo(() => (texts ? splitLines(texts.old) : []), [texts])
  const newLines = useMemo(() => (texts ? splitLines(texts.new) : []), [texts])
  const oldTokens = useTokens(texts?.old ?? '', file.oldPath ?? file.path)
  const newTokens = useTokens(texts?.new ?? '', file.path)
  const [exp, setExp] = useState<Expansion>({})
  const [preview, setPreview] = useState(false)
  const [full, setFull] = useState<DiffFile | null>(null)
  const [loadingFull, setLoadingFull] = useState(false)
  const shown = full ?? file
  const scroller = useRef<HTMLDivElement>(null)
  const [sel, setSel] = useState<{ side: 'old' | 'new'; from: number; to: number } | null>(null)
  const dragging = useRef(false)

  useEffect(() => { setExp({}); setFull(null); setPreview(false); setSel(null) }, [file.path, diff?.generatedAt])

  const fileComments = useMemo(() => comments.filter(c => c.path === file.path), [comments, file.path])
  const commentsAt = useMemo(() => {
    const m = new Map<string, ReviewComment[]>()
    for (const c of fileComments) {
      const k = `${c.side}:${c.endLine}`
      m.set(k, [...(m.get(k) ?? []), c])
    }
    return m
  }, [fileComments])

  const rowsU = useMemo(() => (mode === 'unified' ? unifiedRows(shown, newLines, exp) : []), [mode, shown, newLines, exp])
  const rowsS = useMemo(() => (mode === 'split' ? splitRows(shown, newLines, exp) : []), [mode, shown, newLines, exp])

  // Long lines scroll the whole file sideways (not one line at a time): the table is as wide as its widest line.
  const width = useMemo(() => {
    if (wrap) return undefined
    if (mode === 'unified') {
      const cols = widestCols(rowsU.flatMap(r => (r.t === 'line' ? [r.text] : [])))
      return `max(100%, calc(${cols}ch + 150px))`
    }
    const cols = widestCols(rowsS.flatMap(r => (r.t === 'pair' ? [r.left.text, r.right.text] : [])))
    return `max(100%, calc(${cols * 2}ch + 190px))`
  }, [wrap, mode, rowsU, rowsS])

  const textOf = useCallback((side: 'old' | 'new', no: number): string => {
    const lines = side === 'new' ? newLines : oldLines
    if (lines.length) return lines[no - 1] ?? ''
    for (const h of shown.hunks) for (const l of h.lines) if ((side === 'new' ? l.newNo : l.oldNo) === no) return l.text
    return ''
  }, [newLines, oldLines, shown])

  const startDraft = useCallback((side: 'old' | 'new', from: number, to: number) => {
    const a = Math.min(from, to), b = Math.max(from, to)
    const excerpt = Array.from({ length: b - a + 1 }, (_, i) => textOf(side, a + i)).join('\n')
    setDraft({ path: file.path, side, start: a, end: b, excerpt })
    setSel(null)
  }, [file.path, setDraft, textOf])

  // Drag over line numbers to pick a range; release opens the comment box.
  useEffect(() => {
    const up = () => {
      if (!dragging.current) return
      dragging.current = false
      setSel(s => { if (s) startDraft(s.side, s.from, s.to); return null })
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [startDraft])

  const gutter = (a: Anchor | undefined) => a && ({
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      if (e.shiftKey && draft && draft.path === file.path && draft.side === a.side && !draft.editing) {
        startDraft(a.side, draft.start, a.no)
        return
      }
      dragging.current = true
      setSel({ side: a.side, from: a.no, to: a.no })
    },
    onMouseEnter: () => { if (dragging.current) setSel(s => (s && s.side === a.side ? { ...s, to: a.no } : s)) },
  })

  const inSel = (a: Anchor | undefined) => {
    if (!a) return false
    if (sel && sel.side === a.side && a.no >= Math.min(sel.from, sel.to) && a.no <= Math.max(sel.from, sel.to)) return true
    if (draft && draft.path === file.path && draft.side === a.side && a.no >= draft.start && a.no <= draft.end) return true
    return false
  }

  // Scroll to a line asked for from elsewhere (a link in the chat, a comment in the dock).
  useEffect(() => {
    if (!focusLine || focusLine.path !== file.path) return
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector(`[data-new="${focusLine.line}"]`) ?? scroller.current?.querySelector(`[data-old="${focusLine.line}"]`)
      el?.scrollIntoView({ block: 'center' })
      el?.classList.add('flash')
      setTimeout(() => el?.classList.remove('flash'), 1400)
    })
  }, [focusLine, file.path, rowsU.length, rowsS.length])

  const expand = (gap: number, dir: 'up' | 'down' | 'all', hidden: number) => setExp(e => {
    const cur = e[gap] ?? { top: 0, bottom: 0 }
    const step = STEP
    if (dir === 'all') return { ...e, [gap]: { top: cur.top + hidden, bottom: cur.bottom } }
    // "Up" reveals the lines just above the next hunk; "down" those just below the previous one.
    return { ...e, [gap]: dir === 'up' ? { ...cur, bottom: cur.bottom + Math.min(step, hidden) } : { ...cur, top: cur.top + Math.min(step, hidden) } }
  })

  const after = (side: 'old' | 'new', no: number | undefined, span: number) => {
    if (no === undefined) return null
    const list = commentsAt.get(`${side}:${no}`)
    const showDraft = draft && draft.path === file.path && draft.side === side && draft.end === no
    if (!list?.length && !showDraft) return null
    return (
      <tr className="comment-row">
        <td colSpan={span}>
          <div className="row-pin comment-pin">
            {list?.map(c => (draft?.editing === c.id ? null : <CommentCard key={c.id} c={c} />))}
            {showDraft && <CommentEditor draft={draft as Draft} />}
          </div>
        </td>
      </tr>
    )
  }

  // Each button says which lines it opens: ↓ grows the code above downward, ↑ grows the code below upward.
  // When 20 or fewer lines are hidden, both would open everything, so only "모두" stays.
  const gapRow = (r: { gap: number; hidden: number; canUp: boolean; canDown: boolean; from: number; to: number }, span: number) => {
    const partial = r.hidden > STEP
    return (
      <tr key={`g${r.gap}`} className="gap-row">
        <td colSpan={span}>
          <div className="gap row-pin">
            {partial && r.canDown && (
              <button onClick={() => expand(r.gap, 'down', r.hidden)} title="Expand down">
                <ChevronsDown size={12} /> {r.from}–{r.from + STEP - 1}줄
              </button>
            )}
            <button onClick={() => expand(r.gap, 'all', r.hidden)} title="Expand all"><UnfoldVertical size={12} /> 숨은 {r.hidden}줄 모두</button>
            {partial && r.canUp && (
              <button onClick={() => expand(r.gap, 'up', r.hidden)} title="Expand up">
                <ChevronsUp size={12} /> {r.to - STEP + 1}–{r.to}줄
              </button>
            )}
          </div>
        </td>
      </tr>
    )
  }

  const isMarkdown = /\.(md|mdx|markdown)$/i.test(file.path)
  const isViewed = Boolean(viewed[file.path])
  const commentButton = (a: Anchor | undefined) => a && (
    <button className="add-comment" onMouseDown={e => { e.stopPropagation(); e.preventDefault(); startDraft(a.side, a.no, a.no) }} title="코멘트 달기">
      <MessageSquarePlus size={12} />
    </button>
  )

  let body: React.ReactNode
  if (file.binary) body = <div className="diff-note">바이너리 파일이라 내용을 비교하지 않아.</div>
  else if (file.large && !full) {
    body = (
      <div className="diff-note">
        큰 diff라 접어 뒀어 ({file.additions + file.deletions}줄).
        <button className="btn sm" disabled={loadingFull} onClick={async () => {
          if (!root || !diff) return
          setLoadingFull(true)
          try {
            const one = await api.post<DiffResult>('/api/review/diff', { ws: root, source: diff.source, path: file.path, context: useReview.getState().context })
            setFull(one.files.find(f => f.path === file.path) ?? null)
          } finally { setLoadingFull(false) }
        }}>{loadingFull ? <Loader2 size={12} className="spin" /> : null} Load diff</button>
      </div>
    )
  } else if (!shown.hunks.length) body = <div className="diff-note">{file.status === 'renamed' ? '이름만 바뀌었어.' : '보여 줄 줄 변경이 없어 (모드나 공백만 바뀌었을 수 있어).'}</div>
  else if (preview && isMarkdown) body = <div className="md-preview"><Markdown text={texts?.new ?? ''} /></div>
  else if (mode === 'unified') {
    body = (
      <table className={`diff unified hl ${wrap ? 'wrap' : ''}`} style={{ width }}>
        <colgroup><col className="c-no" /><col className="c-no" /><col /></colgroup>
        <tbody>
          {rowsU.map((r, i) => {
            if (r.t === 'gap') return gapRow(r, 3)
            if (r.t === 'hunk') return <tr key={`h${i}`} className="hunk-row" data-hunk={r.hunk}><td colSpan={3}><div className="row-pin"><span>@@</span> {r.header}</div></td></tr>
            const a: Anchor | undefined = r.type === 'del' ? (r.oldNo ? { side: 'old', no: r.oldNo } : undefined) : r.newNo ? { side: 'new', no: r.newNo } : undefined
            const tokens = r.type === 'del' ? oldTokens[(r.oldNo ?? 0) - 1] : newTokens[(r.newNo ?? 0) - 1]
            return (
              <Fragment key={`l${i}`}>
                <tr className={`line ${r.type}${r.expanded ? ' expanded' : ''}${inSel(a) ? ' selected' : ''}`} data-new={r.newNo} data-old={r.type === 'del' ? r.oldNo : undefined}>
                  <td className="no" {...gutter(a)}>{r.oldNo ?? ''}</td>
                  <td className="no" {...gutter(a)}>{r.newNo ?? ''}{commentButton(a)}</td>
                  <td className="code"><span className="sign">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span><CodeText tokens={tokens} text={r.text} words={r.words} kind={r.type === 'ctx' ? undefined : r.type} /></td>
                </tr>
                {a && after(a.side, a.no, 3)}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    )
  } else {
    const cell = (s: Side, side: 'old' | 'new') => {
      const a: Anchor | undefined = s.no && s.type !== 'blank' ? { side, no: s.no } : undefined
      const tokens = s.no ? (side === 'old' ? oldTokens : newTokens)[s.no - 1] : undefined
      return [
        <td key="n" className={`no ${s.type}${inSel(a) ? ' selected' : ''}`} {...gutter(a)}>{s.no ?? ''}{commentButton(a)}</td>,
        <td key="c" className={`code ${s.type}${inSel(a) ? ' selected' : ''}`}>{s.type !== 'blank' && <CodeText tokens={tokens} text={s.text} words={s.words} kind={s.type === 'add' || s.type === 'del' ? s.type : undefined} />}</td>,
      ]
    }
    body = (
      <table className={`diff split hl ${wrap ? 'wrap' : ''}`} style={{ width }}>
        <colgroup><col className="c-no" /><col className="c-half" /><col className="c-no" /><col className="c-half" /></colgroup>
        <tbody>
          {rowsS.map((r, i) => {
            if (r.t === 'gap') return gapRow(r, 4)
            if (r.t === 'hunk') return <tr key={`h${i}`} className="hunk-row" data-hunk={r.hunk}><td colSpan={4}><div className="row-pin"><span>@@</span> {r.header}</div></td></tr>
            return (
              <Fragment key={`p${i}`}>
                <tr className={`line pair${r.expanded ? ' expanded' : ''}`} data-new={r.right.no} data-old={r.left.type === 'del' ? r.left.no : undefined}>
                  {cell(r.left, 'old')}
                  {cell(r.right, 'new')}
                </tr>
                {r.left.type === 'del' && r.left.no !== undefined && after('old', r.left.no, 4)}
                {r.right.no !== undefined && r.right.type !== 'blank' && after('new', r.right.no, 4)}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    )
  }

  return (
    <section className="file-diff" ref={scroller}>
      <header className="file-head">
        <span className={`status-badge ${file.status}`}>{STATUS_LETTER[file.status]}</span>
        <PathLabel path={file.path} oldPath={file.oldPath} />
        <button className="iconbtn" title="Copy path" onClick={() => void navigator.clipboard.writeText(file.path)}><Copy size={13} /></button>
        <span className="delta"><b className="add">+{file.additions}</b> <b className="del">−{file.deletions}</b></span>
        <span className="grow" />
        {isMarkdown && <button className="btn sm ghost" onClick={() => setPreview(p => !p)}>{preview ? <EyeOff size={13} /> : <Eye size={13} />}{preview ? 'Diff' : 'Preview'}</button>}
        {file.status !== 'deleted' && <button className="btn sm ghost" onClick={() => void openFile(file.path, undefined, diff?.newRef)}><FileCode2 size={13} /> View file</button>}
        <label className="toggle" title="Viewed (v)"><input type="checkbox" checked={isViewed} onChange={() => toggleViewed(file)} /> Viewed</label>
      </header>
      <div className="file-body">{body}</div>
    </section>
  )
})

/** A long path keeps its file name: the folders shrink from the left. */
export function PathLabel({ path, oldPath }: { path: string; oldPath?: string }) {
  const cut = path.lastIndexOf('/')
  const dir = cut >= 0 ? path.slice(0, cut + 1) : ''
  const name = path.slice(cut + 1)
  return (
    <span className="file-path" title={oldPath ? `${oldPath} → ${path}` : path}>
      {oldPath && <span className="old">{oldPath.split('/').pop()} → </span>}
      {dir && <span className="dir"><bdi>{dir}</bdi></span>}
      <b className="name">{name}</b>
    </span>
  )
}

export const STATUS_LETTER: Record<string, string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: 'U', binary: 'B' }

function splitLines(s: string): string[] {
  if (!s) return []
  const lines = s.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}
