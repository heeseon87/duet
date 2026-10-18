import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, Loader2, MessageSquarePlus } from 'lucide-react'
import { api, q } from '../api.ts'
import { Line, useTokens } from '../lib/Code.tsx'
import { Markdown } from '../lib/Markdown.tsx'
import { useReview } from './store.ts'
import { CommentCard, CommentEditor } from './Comments.tsx'
import { PathLabel } from './DiffView.tsx'
import { widestCols } from './diffModel.ts'

/** A whole file at a ref, with line comments (anchored to the new side). */
export function FileView({ path, gitRef, line }: { path: string; gitRef: string; line?: number }) {
  const { root, comments, draft, setDraft } = useReview()
  const [text, setText] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [preview, setPreview] = useState(/\.(md|mdx)$/i.test(path))
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!root) return
    setText(null)
    setMissing(false)
    void api.get<{ exists: boolean; text: string }>(`/api/git/file${q({ ws: root, ref: gitRef, path })}`).then(r => {
      setText(r.text)
      setMissing(!r.exists)
    })
  }, [root, gitRef, path])
  const lines = useMemo(() => (text ?? '').replace(/\n$/, '').split('\n'), [text])
  const tokens = useTokens(text ?? '', path)
  const width = useMemo(() => `max(100%, calc(${widestCols(lines)}ch + 90px))`, [lines])
  useEffect(() => {
    if (!line || text === null || preview) return
    requestAnimationFrame(() => {
      const el = box.current?.querySelector(`[data-line="${line}"]`)
      el?.scrollIntoView({ block: 'center' })
      el?.classList.add('flash')
      setTimeout(() => el?.classList.remove('flash'), 1400)
    })
  }, [line, text, preview])
  const mine = comments.filter(c => c.path === path && c.side === 'new')
  const isMd = /\.(md|mdx)$/i.test(path)
  if (text === null) return <div className="empty"><Loader2 className="spin" size={18} /></div>
  if (missing) return <div className="empty"><h3>{path}</h3><p>이 시점({gitRef === 'WORKTREE' ? 'Working tree' : gitRef.slice(0, 7)})에는 이 파일이 없어.</p></div>
  return (
    <section className="file-diff" ref={box}>
      <header className="file-head">
        <PathLabel path={path} />
        <span className="muted">{gitRef === 'WORKTREE' ? 'Working tree' : gitRef.slice(0, 7)} · {lines.length}줄</span>
        <span className="grow" />
        {isMd && <button className="btn sm ghost" onClick={() => setPreview(p => !p)}>{preview ? <EyeOff size={13} /> : <Eye size={13} />}{preview ? 'Code' : 'Preview'}</button>}
      </header>
      {preview ? <div className="md-preview"><Markdown text={text} /></div> : (
        <div className="file-body">
        <table className="diff unified hl fileview" style={{ width }}>
          <colgroup><col className="c-no" /><col /></colgroup>
          <tbody>
            {lines.map((l, i) => {
              const no = i + 1
              const here = mine.filter(c => c.endLine === no)
              const showDraft = draft && draft.path === path && draft.side === 'new' && draft.end === no
              const sel = draft && draft.path === path && no >= draft.start && no <= draft.end
              return (
                <FragmentRow key={no}>
                  <tr className={`line ctx${sel ? ' selected' : ''}`} data-line={no} data-new={no}>
                    <td className="no" onMouseDown={e => {
                      e.preventDefault()
                      if (e.shiftKey && draft && draft.path === path && !draft.editing) {
                        const a = Math.min(draft.start, no), b = Math.max(draft.start, no)
                        setDraft({ ...draft, start: a, end: b, excerpt: lines.slice(a - 1, b).join('\n') })
                      } else setDraft({ path, side: 'new', start: no, end: no, excerpt: l })
                    }}>{no}<span className="add-comment"><MessageSquarePlus size={12} /></span></td>
                    <td className="code"><Line tokens={tokens[i]} /></td>
                  </tr>
                  {(here.length > 0 || showDraft) && (
                    <tr className="comment-row"><td colSpan={2}><div className="row-pin comment-pin">
                      {here.map(c => (draft?.editing === c.id ? null : <CommentCard key={c.id} c={c} />))}
                      {showDraft && <CommentEditor draft={draft!} />}
                    </div></td></tr>
                  )}
                </FragmentRow>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
    </section>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
