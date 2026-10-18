import { useEffect, useRef, useState } from 'react'
import { ChevronDown, CircleCheck, CircleDashed, CircleX, ExternalLink, GitPullRequest, Loader2, MessageSquare } from 'lucide-react'
import type { DiffSource } from '../../../shared/protocol.ts'
import { api, q } from '../api.ts'
import { Markdown } from '../lib/Markdown.tsx'
import { Popover, relTime } from '../lib/ui.tsx'

type Check = { name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; targetUrl?: string }
export type PullRequest = {
  provider?: 'github' | 'gitlab' | 'azure'
  number: number; title: string; body: string; state: string; url: string; isDraft: boolean; author?: { login: string }
  baseRefName: string; headRefName: string; additions: number; deletions: number; changedFiles: number; reviewDecision?: string
  createdAt: string; updatedAt: string
  reviews: { author?: { login: string }; state: string; body: string; submittedAt: string }[]
  comments: { author?: { login: string }; body: string; createdAt: string }[]
  statusCheckRollup: Check[]
}
type ListItem = { number: number; title: string; headRefName: string; author?: { login: string }; updatedAt: string; isDraft: boolean }

const prCache = new Map<string, PullRequest | null>()

export function usePr(root: string | undefined, number?: number) {
  const key = `${root}#${number ?? 'branch'}`
  const [pr, setPr] = useState<PullRequest | null | undefined>(prCache.get(key))
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!root) return
    let live = true
    setError(undefined)
    if (!prCache.has(key)) setPr(undefined)
    api.get<{ pr: PullRequest | null }>(`/api/git/pr${q({ ws: root, number })}`)
      .then(r => { prCache.set(key, r.pr); if (live) setPr(r.pr) })
      .catch(e => { if (live) { setError((e as Error).message); setPr(null) } })
    return () => { live = false }
  }, [root, key, number])
  return { pr, error }
}

function checkState(c: Check): 'pass' | 'fail' | 'pending' | 'skip' {
  const v = (c.conclusion || c.state || c.status || '').toUpperCase()
  if (['SUCCESS', 'NEUTRAL'].includes(v)) return 'pass'
  if (['SKIPPED', 'CANCELLED', 'STALE'].includes(v)) return 'skip'
  if (['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(v)) return 'fail'
  return 'pending'
}

const DECISION: Record<string, string> = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review required' }
const REVIEW_STATE: Record<string, string> = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', COMMENTED: 'Commented', DISMISSED: 'Dismissed' }

export function PrPicker({ root, source, onPick }: { root: string; source: Extract<DiffSource, { kind: 'pr' }>; onPick: (s: DiffSource) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<ListItem[] | null>(null)
  const [error, setError] = useState<string>()
  const { pr } = usePr(root, source.number)
  useEffect(() => {
    if (!open || list) return
    api.get<ListItem[]>(`/api/git/prs${q({ ws: root })}`).then(setList).catch(e => setError((e as Error).message))
  }, [open, list, root])
  return (
    <>
      <button ref={ref} className="ref-pick" onClick={() => setOpen(o => !o)}>
        <GitPullRequest size={13} />
        <b className="ellipsis" style={{ maxWidth: 260 }}>{pr ? `#${pr.number} ${pr.title}` : source.number ? `#${source.number}` : '이 브랜치의 PR'}</b>
        <ChevronDown size={11} />
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} width={460}>
          <button className="menu-item" aria-checked={!source.number} onClick={() => { onPick({ kind: 'pr' }); setOpen(false) }}>이 브랜치의 PR</button>
          <div className="menu-sep" />
          {error && <div className="menu-label" style={{ color: 'var(--del)' }}>{error}</div>}
          {!list && !error && <div className="menu-label"><Loader2 size={12} className="spin" /> 열린 PR을 불러오는 중</div>}
          {list?.length === 0 && <div className="menu-label">열린 PR이 없어</div>}
          {list?.map(p => (
            <button key={p.number} className="menu-item" aria-checked={source.number === p.number} onClick={() => { onPick({ kind: 'pr', number: p.number }); setOpen(false) }}>
              <span className="grow ellipsis">
                <span className="ellipsis">#{p.number} {p.title}</span>
                <span className="meta">{p.headRefName} · {p.author?.login ?? ''} · {relTime(Date.parse(p.updatedAt))}{p.isDraft ? ' · draft' : ''}</span>
              </span>
            </button>
          ))}
        </Popover>
      )}
    </>
  )
}

/** The PR's description, checks, reviews and conversation, read-only, above its diff. */
export function PrPanel({ root, number }: { root: string; number?: number }) {
  const { pr, error } = usePr(root, number)
  const [open, setOpen] = useState(true)
  const [showChecks, setShowChecks] = useState(false)
  if (error) return <div className="pr-panel error">{error}</div>
  if (pr === undefined) return <div className="pr-panel muted"><Loader2 size={13} className="spin" /> PR을 읽는 중</div>
  if (!pr) return null
  const checks = pr.statusCheckRollup ?? []
  const counts = { pass: 0, fail: 0, pending: 0, skip: 0 }
  for (const c of checks) counts[checkState(c)]++
  const talk = [
    ...pr.reviews.filter(r => r.body?.trim() || r.state !== 'COMMENTED').map(r => ({ who: r.author?.login ?? '?', when: r.submittedAt, body: r.body, tag: REVIEW_STATE[r.state] ?? r.state })),
    ...pr.comments.map(c => ({ who: c.author?.login ?? '?', when: c.createdAt, body: c.body, tag: '' })),
  ].sort((a, b) => Date.parse(a.when) - Date.parse(b.when))
  return (
    <section className="pr-panel">
      <header className="pr-head">
        <span className={`pr-state ${pr.isDraft ? 'draft' : pr.state.toLowerCase()}`}><GitPullRequest size={13} />{pr.isDraft ? 'Draft' : pr.state === 'OPEN' ? 'Open' : pr.state === 'MERGED' ? 'Merged' : 'Closed'}</span>
        <button className="pr-title" onClick={() => setOpen(o => !o)}><b>{pr.title}</b> <span className="muted">#{pr.number}</span></button>
        <span className="grow" />
        <a className="iconbtn" href={pr.url} target="_blank" rel="noreferrer" title={`${pr.provider === 'gitlab' ? 'GitLab' : pr.provider === 'azure' ? 'Azure DevOps' : 'GitHub'}에서 열기`}><ExternalLink size={14} /></a>
      </header>
      <div className="pr-meta">
        <span>{pr.author?.login}</span>
        <span className="muted">{pr.baseRefName} ← {pr.headRefName}</span>
        <span className="delta"><b className="add">+{pr.additions}</b> <b className="del">−{pr.deletions}</b> · 파일 {pr.changedFiles}개</span>
        {pr.reviewDecision && <span className={`chip ${pr.reviewDecision === 'APPROVED' ? 'add' : pr.reviewDecision === 'CHANGES_REQUESTED' ? 'del' : ''}`}>{DECISION[pr.reviewDecision] ?? pr.reviewDecision}</span>}
        {checks.length > 0 && (
          <button className="checks" onClick={() => setShowChecks(s => !s)}>
            {counts.fail > 0 ? <CircleX size={13} className="del" /> : counts.pending > 0 ? <CircleDashed size={13} className="warn-ink" /> : <CircleCheck size={13} className="add" />}
            Checks {counts.pass}/{checks.length - counts.skip}{counts.fail ? ` · ${counts.fail} failing` : ''}{counts.pending ? ` · ${counts.pending} pending` : ''}
          </button>
        )}
        <span className="muted">{relTime(Date.parse(pr.updatedAt))}</span>
      </div>
      {showChecks && (
        <ul className="check-list">
          {checks.map((c, i) => {
            const s = checkState(c)
            return <li key={i} className={s}>{s === 'pass' ? <CircleCheck size={12} /> : s === 'fail' ? <CircleX size={12} /> : <CircleDashed size={12} />}<a href={c.detailsUrl ?? c.targetUrl} target="_blank" rel="noreferrer">{c.name ?? c.context}</a></li>
          })}
        </ul>
      )}
      {open && (
        <div className="pr-body">
          {pr.body?.trim() ? <Markdown text={pr.body} /> : <p className="muted">설명이 없어.</p>}
          {talk.length > 0 && (
            <div className="pr-talk">
              <h4><MessageSquare size={12} /> Conversation {talk.length}</h4>
              {talk.map((t, i) => (
                <div key={i} className="pr-msg">
                  <div className="pr-msg-head"><b>{t.who}</b>{t.tag && <span className="chip">{t.tag}</span>}<span className="muted">{relTime(Date.parse(t.when))}</span></div>
                  {t.body?.trim() && <Markdown text={t.body} />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
