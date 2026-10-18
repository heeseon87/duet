import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Bot, Check, ChevronRight, CircleAlert, FilePlus2, FileText, FolderSearch, Globe, ListChecks, Loader2, MessageCircleQuestion,
  NotebookPen, PencilLine, Search, Shapes, ShieldQuestion, SquareTerminal, Wrench, ClipboardList, X,
} from 'lucide-react'
import type { PermissionDecision } from '../../../shared/protocol.ts'
import { partialInput, type Block, type PermissionState, type ToolBlock } from './transcript.ts'
import { answersOf, type Answer, type Question } from './askModel.ts'
import { CodeBlock, CodeText, Line, useTokens, type WordSeg } from '../lib/Code.tsx'
import { withWords } from '../review/diffModel.ts'
import type { DiffLine } from '../../../shared/protocol.ts'
import { Markdown } from '../lib/Markdown.tsx'
import { duration, relPath, useNow } from '../lib/ui.tsx'
import { useApp } from '../state.ts'
import { Blocks } from './Blocks.tsx'
import { modeLabel } from './Composer.tsx'

type Ctx = { root?: string; sessionId?: string; onOpenPath?: (path: string, line?: number) => void; onOpenCanvas?: (name: string) => void }

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v))

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
}

type Patch = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

function countPatch(patch: Patch[] | undefined): { add: number; del: number } {
  let add = 0, del = 0
  for (const h of patch ?? []) for (const l of h.lines) {
    if (l.startsWith('+')) add++
    else if (l.startsWith('-')) del++
  }
  return { add, del }
}

/**
 * A compact diff for an edit, like Claude Code prints it: line numbers, the changed words marked,
 * long lines wrapped. From the tool's structured patch, or its old/new strings while it streams.
 */
function EditDiff({ patch, oldStr, newStr, path }: { patch?: Patch[]; oldStr?: string; newStr?: string; path: string }) {
  const rows = useMemo(() => {
    const out: ({ type: 'add' | 'del' | 'ctx'; text: string; no?: number; words?: WordSeg[] } | { type: 'gap' })[] = []
    const marked = (lines: DiffLine[]) => withWords(lines).map(l => ({ type: l.type, text: l.text, no: l.type === 'del' ? l.oldNo : l.newNo, words: l.words }))
    if (patch?.length) {
      patch.forEach((h, hi) => {
        if (hi > 0) out.push({ type: 'gap' })
        let o = h.oldStart, n = h.newStart
        const lines: DiffLine[] = []
        for (const l of h.lines) {
          const c = l[0], text = l.slice(1)
          if (c === '+') lines.push({ type: 'add', text, newNo: n++ })
          else if (c === '-') lines.push({ type: 'del', text, oldNo: o++ })
          else if (c !== '\\') { lines.push({ type: 'ctx', text, oldNo: o++, newNo: n++ }) }
        }
        out.push(...marked(lines))
      })
    } else {
      const lines: DiffLine[] = []
      if (oldStr) for (const text of oldStr.split('\n')) lines.push({ type: 'del', text })
      if (newStr !== undefined) for (const text of newStr.split('\n')) lines.push({ type: 'add', text })
      out.push(...marked(lines))
    }
    return out
  }, [patch, oldStr, newStr])
  const code = rows.map(r => (r.type === 'gap' ? '' : r.text)).join('\n')
  const tokens = useTokens(code, path)
  return (
    <div className="mini-diff hl">
      {rows.map((r, i) => r.type === 'gap'
        ? <div key={i} className="md-gap">⋯</div>
        : (
          <div key={i} className={`md-row ${r.type}`}>
            <span className="no">{r.no ?? ''}</span>
            <span className="sign">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span>
            <span className="text"><CodeText tokens={tokens[i]} text={r.text} words={r.words} kind={r.type === 'ctx' ? undefined : r.type} /></span>
          </div>
        ))}
    </div>
  )
}

const many = (n: number, one: string, other = `${one}s`) => `${n} ${n === 1 ? one : other}`

/** "Added 11 lines, removed 2 lines": what an edit did, above its diff, as Claude Code says it. */
function EditSummary({ add, del }: { add: number; del: number }) {
  const said = [add && `added ${many(add, 'line')}`, del && `removed ${many(del, 'line')}`].filter(Boolean).join(', ')
  return <div className="edit-summary">{said ? said[0].toUpperCase() + said.slice(1) : 'No changes'}</div>
}

function Output({ text, error }: { text: string; error?: boolean }) {
  const [all, setAll] = useState(false)
  const lines = text.split('\n')
  const limit = 24
  const shown = all ? lines : lines.slice(0, limit)
  return (
    <div className={`tool-output ${error ? 'error' : ''}`}>
      <pre>{shown.join('\n')}</pre>
      {lines.length > limit && <button className="more" onClick={() => setAll(a => !a)}>{all ? '접기' : `${lines.length - limit}줄 더 보기`}</button>}
    </div>
  )
}

/** Read's result carries `N\t` line numbers; show the code with its own numbers. */
function ReadResult({ text, path }: { text: string; path: string }) {
  const { code, first } = useMemo(() => {
    const lines = text.split('\n')
    const m = /^\s*(\d+)[\t→]/.exec(lines[0] ?? '')
    const body = lines.map(l => l.replace(/^\s*\d+[\t→]/, ''))
    return { code: body.join('\n'), first: m ? Number(m[1]) : 1 }
  }, [text])
  const tokens = useTokens(code, path)
  const [all, setAll] = useState(false)
  const limit = 30
  const shown = all ? tokens : tokens.slice(0, limit)
  return (
    <div className="read-result hl">
      {shown.map((t, i) => (
        <div key={i} className="md-row ctx"><span className="no">{first + i}</span><span className="text"><Line tokens={t} /></span></div>
      ))}
      {tokens.length > limit && <button className="more" onClick={() => setAll(a => !a)}>{all ? '접기' : `${tokens.length - limit}줄 더 보기`}</button>}
    </div>
  )
}

function ruleText(s: Record<string, unknown>): string {
  if (s.type === 'setMode') return `이 대화를 ${modeLabel(String(s.mode))} 모드로`
  if (s.type === 'addRules' && Array.isArray(s.rules)) {
    return (s.rules as { toolName: string; ruleContent?: string }[]).map(r => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)).join(', ')
  }
  if (s.type === 'addDirectories' && Array.isArray(s.directories)) return `폴더 접근: ${(s.directories as string[]).join(', ')}`
  return String(s.type)
}

const DEST: Record<string, string> = { session: '이 대화', localSettings: '.claude/settings.local.json', projectSettings: '.claude/settings.json', userSettings: '~/.claude/settings.json' }

export function PermissionCard({ p, tool, children }: { p: PermissionState; tool?: ToolBlock; children?: ReactNode }) {
  const decide = useApp(s => s.decide)
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const suggestion = p.request.suggestions?.[0] as Record<string, unknown> | undefined
  const act = async (d: PermissionDecision) => {
    setBusy(true)
    try { await decide(p.request.id, d) } finally { setBusy(false) }
  }
  useEffect(() => {
    if (p.state !== 'pending') return
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // With several requests open, the keys answer the first one on screen.
      if (document.querySelector('.perm-card')?.getAttribute('data-waiting') !== p.request.id) return
      if (e.key === '1') { e.preventDefault(); void act({ behavior: 'allow' }) }
      else if (e.key === '2' && suggestion) { e.preventDefault(); void act({ behavior: 'allow', always: true }) }
      else if (e.key === '3') { e.preventDefault(); setDenying(true) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  if (p.state !== 'pending') {
    const label = p.state === 'allow' ? (p.always ? 'Always allowed' : 'Allowed') : p.state === 'deny' ? `Denied${p.message ? ` · “${p.message}”` : ''}` : 'Cancelled'
    return <div className={`perm-done ${p.state}`}>{p.state === 'allow' ? <Check size={12} /> : <X size={12} />}{label}</div>
  }
  return (
    <div className="perm-card fade-in" data-waiting={p.request.id}>
      <div className="perm-head">
        <ShieldQuestion size={15} />
        <span className="grow">{tool ? '이 작업을 허용할까?' : `${p.request.toolName} 실행을 허용할까?`}</span>
        {p.request.blockedPath && <span className="chip warn" title={p.request.blockedPath}>작업 폴더 밖</span>}
      </div>
      {p.request.reason && <div className="perm-reason">{p.request.reason}</div>}
      {children}
      {denying ? (
        <div className="perm-actions">
          <input
            autoFocus
            className="input grow"
            placeholder="이유나 다른 방법 (선택)"
            value={reason}
            onChange={e => setReason(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void act({ behavior: 'deny', message: reason })
              if (e.key === 'Escape') { e.stopPropagation(); setDenying(false) }
            }}
          />
          <button className="btn sm danger" disabled={busy} onClick={() => void act({ behavior: 'deny', message: reason })}>Deny</button>
          <button className="btn sm ghost" onClick={() => setDenying(false)}>취소</button>
        </div>
      ) : (
        <div className="perm-actions">
          <button className="btn sm primary" disabled={busy} onClick={() => void act({ behavior: 'allow' })}>Allow <kbd>1</kbd></button>
          {suggestion && (
            <button className="btn sm" disabled={busy} title={`${DEST[String(suggestion.destination)] ?? ''}에 저장`} onClick={() => void act({ behavior: 'allow', always: true })}>
              <span className="ellipsis" style={{ maxWidth: 260 }}>Always allow · {ruleText(suggestion)}</span> <kbd>2</kbd>
            </button>
          )}
          <button className="btn sm ghost" disabled={busy} onClick={() => setDenying(true)}>Deny <kbd>3</kbd></button>
        </div>
      )}
    </div>
  )
}

/**
 * How a question was answered: the pick up front, the options passed over folded away (like a
 * decision on the canvas), or words typed instead, or that it was skipped.
 */
function Answered({ answers }: { answers: Answer[] }) {
  return (
    <div className="ask-card">
      {answers.map(({ q, picked, own }) => {
        const others = q.options.filter(o => !picked.includes(o.label))
        return (
          <div key={q.question} className="ask-q">
            <div className="ask-title">{q.header && <span className="chip accent">{q.header}</span>}<span>{q.question}</span></div>
            <div className={`ask-said ${picked.length || own ? '' : 'skip'}`}>
              {picked.length || own ? <><Check size={12} />{picked.length ? '이걸로 답함' : '직접 답함'}</> : '건너뜀'}
            </div>
            {q.options.filter(o => picked.includes(o.label)).map(o => <div key={o.label} className="ask-opt on"><b>{o.label}</b>{o.description && <span>{o.description}</span>}</div>)}
            {own && <div className="ask-opt on"><b>{own}</b></div>}
            {others.length > 0 && (
              <details className="ask-more">
                <summary>{picked.length ? '고르지 않은 선택지' : '선택지'} {others.length}개</summary>
                <div className="ask-options">{others.map(o => <div key={o.label} className="ask-opt lost"><b>{o.label}</b>{o.description && <span>{o.description}</span>}</div>)}</div>
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** AskUserQuestion: the agent asks; the person answers right here. */
function QuestionCard({ tool, p }: { tool: ToolBlock; p?: PermissionState }) {
  const decide = useApp(s => s.decide)
  const input = partialInput(tool)
  const questions = (input.questions as Question[] | undefined) ?? []
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const pending = p?.state === 'pending'
  const done = pending ? undefined : answersOf(tool)
  if (done) return <Answered answers={done} />
  const submit = () => {
    if (!p) return
    const out: Record<string, string> = {}
    for (const q of questions) {
      const picked = [...(answers[q.question] ?? [])]
      if (other[q.question]?.trim()) picked.push(other[q.question].trim())
      out[q.question] = picked.join(', ')
    }
    void decide(p.request.id, { behavior: 'allow', updatedInput: { ...input, answers: out } })
  }
  return (
    <div className="ask-card">
      {questions.map(q => (
        <div key={q.question} className="ask-q">
          <div className="ask-title">{q.header && <span className="chip accent">{q.header}</span>}<span>{q.question}</span></div>
          <div className="ask-options">
            {q.options.map(o => {
              const on = answers[q.question]?.includes(o.label)
              return (
                <button
                  key={o.label}
                  disabled={!pending}
                  className={`ask-opt${on ? ' on' : ''}`}
                  onClick={() => setAnswers(a => {
                    const cur = a[q.question] ?? []
                    const next = q.multiSelect ? (on ? cur.filter(x => x !== o.label) : [...cur, o.label]) : [o.label]
                    return { ...a, [q.question]: next }
                  })}
                >
                  <b>{o.label}</b>
                  {o.description && <span>{o.description}</span>}
                </button>
              )
            })}
          </div>
          {pending && <input className="input" placeholder="직접 답하기" value={other[q.question] ?? ''} onChange={e => setOther(o => ({ ...o, [q.question]: e.target.value }))} />}
        </div>
      ))}
      {pending && (
        <div className="perm-actions">
          <button className="btn sm primary" onClick={submit}>답 보내기</button>
          <button className="btn sm ghost" onClick={() => p && void decide(p.request.id, { behavior: 'deny', message: '답하지 않고 넘어갈게.' })}>건너뛰기</button>
        </div>
      )}
    </div>
  )
}

function PlanCard({ tool, p }: { tool: ToolBlock; p?: PermissionState }) {
  const decide = useApp(s => s.decide)
  const configure = useApp(s => s.configure)
  const plan = str(partialInput(tool).plan)
  const [note, setNote] = useState('')
  const pending = p?.state === 'pending'
  return (
    <div className="plan-card">
      <div className="plan-head"><ClipboardList size={14} /> 계획</div>
      <Markdown text={plan} streaming={tool.state === 'input'} />
      {pending && p && (
        <div className="perm-actions">
          <button className="btn sm primary" onClick={() => { void decide(p.request.id, { behavior: 'allow' }); void configure({ permissionMode: 'auto' }) }}>Approve · {modeLabel('auto')}</button>
          <button className="btn sm" onClick={() => { void decide(p.request.id, { behavior: 'allow' }); void configure({ permissionMode: 'acceptEdits' }) }}>Approve · {modeLabel('acceptEdits')}</button>
          <button className="btn sm" onClick={() => { void decide(p.request.id, { behavior: 'allow' }); void configure({ permissionMode: 'default' }) }}>Approve · {modeLabel('default')}</button>
          <input className="input grow" placeholder="더 다듬을 점" value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && note.trim()) void decide(p.request.id, { behavior: 'deny', message: note }) }} />
        </div>
      )}
    </div>
  )
}

type Head = { icon: ReactNode; title: ReactNode; sub?: ReactNode; meta?: ReactNode; open?: boolean; body?: ReactNode }

/** A tool call's icon, title, target and result, as its card's head shows them. */
export function toolHead(t: ToolBlock, ctx: Ctx): Head {
  if (t.name === 'Task' || t.name === 'Agent') {
    const input = partialInput(t)
    return { icon: <Bot size={14} />, title: str(input.description) || 'Subagent', sub: input.subagent_type ? <span className="muted">{str(input.subagent_type)}</span> : undefined }
  }
  return describe(t, ctx)
}

function describe(t: ToolBlock, ctx: Ctx): Head {
  const input = partialInput(t)
  const meta = t.resultMeta as Record<string, unknown> | undefined
  const path = relPath(str(input.file_path ?? input.notebook_path ?? input.path), ctx.root)
  const pathLink = (p: string, line?: number) => (
    <code className="path" onClick={e => { e.stopPropagation(); ctx.onOpenPath?.(p, line) }}>{p}</code>
  )
  switch (t.name) {
    case 'Bash': {
      const cmd = str(input.command)
      const out = meta && typeof meta === 'object' && 'stdout' in meta ? [str(meta.stdout), str(meta.stderr)].filter(Boolean).join('\n') : t.result ?? ''
      return {
        icon: <SquareTerminal size={14} />,
        title: str(input.description) || 'Bash',
        sub: <code className="cmd">$ {cmd.split('\n')[0]}</code>,
        body: (
          <>
            {cmd.includes('\n') && <CodeBlock code={cmd} lang="bash" />}
            {(out || t.state === 'done' || t.state === 'error') && <Output text={stripAnsi(out) || '(No content)'} error={t.state === 'error'} />}
          </>
        ),
      }
    }
    case 'Read': {
      const file = (meta?.file ?? {}) as { numLines?: number; startLine?: number; totalLines?: number }
      const range = input.offset ? ` ${input.offset}~${Number(input.offset) + Number(input.limit ?? 0)}` : ''
      return {
        icon: <FileText size={14} />,
        title: 'Read',
        sub: <>{pathLink(path, Number(input.offset) || undefined)}{range && <span className="muted">{range}</span>}</>,
        meta: file.numLines ? many(file.numLines, 'line') : undefined,
        body: t.result && t.state === 'done' ? <ReadResult text={t.result} path={path} /> : t.result ? <Output text={t.result} error /> : undefined,
      }
    }
    case 'Edit':
    case 'MultiEdit': {
      const patch = (meta?.structuredPatch as Patch[] | undefined)
      const c = countPatch(patch)
      const edits = (input.edits as { old_string: string; new_string: string }[] | undefined)
      return {
        icon: <PencilLine size={14} />,
        title: 'Update',
        sub: pathLink(path),
        meta: patch ? <span className="delta"><b className="add">+{c.add}</b> <b className="del">−{c.del}</b></span> : undefined,
        open: true,
        body: t.state === 'error' && t.result
          ? <Output text={t.result} error />
          : patch ? <><EditSummary add={c.add} del={c.del} /><EditDiff patch={patch} path={path} /></>
          : edits ? <EditDiff oldStr={edits.map(e => e.old_string).join('\n')} newStr={edits.map(e => e.new_string).join('\n')} path={path} />
          : <EditDiff oldStr={str(input.old_string)} newStr={str(input.new_string)} path={path} />,
      }
    }
    case 'Write': {
      const content = str(input.content)
      const lines = content.replace(/\n$/, '').split('\n').length
      const over = (meta as { type?: string } | undefined)?.type === 'update'
      const patch = over ? (meta?.structuredPatch as Patch[] | undefined) : undefined
      const c = countPatch(patch)
      // The start of a new file is in view, like Claude Code's "Wrote 48 lines"; an overwrite shows its diff.
      return {
        icon: <FilePlus2 size={14} />,
        title: 'Write',
        sub: pathLink(path),
        meta: content ? many(lines, 'line') : undefined,
        open: true,
        body: t.state === 'error' && t.result
          ? <Output text={t.result} error />
          : patch?.length ? <><EditSummary add={c.add} del={c.del} /><EditDiff patch={patch} path={path} /></>
          : <><div className="edit-summary">Wrote {many(lines, 'line')}</div><CodeBlock code={content} lang={path} maxLines={10} className="write-preview" /></>,
      }
    }
    case 'NotebookEdit':
      return { icon: <NotebookPen size={14} />, title: 'Edit Notebook', sub: pathLink(path), body: t.result ? <Output text={t.result} /> : undefined }
    case 'Grep': {
      const m = meta as { numFiles?: number; numLines?: number; numMatches?: number } | undefined
      return {
        icon: <Search size={14} />,
        title: 'Search',
        sub: <><code>{str(input.pattern)}</code>{input.path || input.glob ? <span className="muted"> · {relPath(str(input.path || input.glob), ctx.root)}</span> : null}</>,
        meta: m ? (m.numMatches ?? m.numLines ? many(m.numMatches ?? m.numLines ?? 0, 'match', 'matches') : many(m.numFiles ?? 0, 'file')) : undefined,
        body: t.result ? <Output text={t.result} /> : undefined,
      }
    }
    case 'Glob': {
      const m = meta as { numFiles?: number } | undefined
      return { icon: <FolderSearch size={14} />, title: 'Search', sub: <code>{str(input.pattern)}</code>, meta: m?.numFiles !== undefined ? many(m.numFiles, 'file') : undefined, body: t.result ? <Output text={t.result} /> : undefined }
    }
    case 'WebFetch':
      return { icon: <Globe size={14} />, title: 'Fetch', sub: <a href={str(input.url)} target="_blank" rel="noreferrer">{str(input.url)}</a>, body: t.result ? <Markdown text={t.result} /> : undefined }
    case 'WebSearch':
      return { icon: <Globe size={14} />, title: 'Web Search', sub: <span>{str(input.query)}</span>, body: t.result ? <Markdown text={t.result} /> : undefined }
    case 'TodoWrite': {
      const todos = (input.todos as { content: string; status: string }[] | undefined) ?? []
      const done = todos.filter(x => x.status === 'completed').length
      return {
        icon: <ListChecks size={14} />,
        title: 'Update todos',
        meta: todos.length ? `${done}/${todos.length}` : undefined,
        body: (
          <ul className="todo-list">
            {todos.map((x, i) => <li key={i} className={x.status}><span className="box">{x.status === 'completed' ? <Check size={11} /> : null}</span>{x.content}</li>)}
          </ul>
        ),
      }
    }
    default: {
      if (t.name.startsWith('mcp__duet__canvas_')) {
        const action = t.name.replace('mcp__duet__canvas_', '')
        const name = str(input.name)
        const verbs: Record<string, string> = { update: 'Update map', create: 'Create map', read: 'Read map', list: 'List maps', reply: 'Reply' }
        return {
          icon: <Shapes size={14} />,
          title: verbs[action] ?? action,
          sub: name ? <code className="path" onClick={e => { e.stopPropagation(); ctx.onOpenCanvas?.(name) }}>{name}</code> : undefined,
          meta: action === 'update' && input.note ? <span className="ellipsis" style={{ maxWidth: 220 }}>{str(input.note)}</span> : undefined,
          open: action === 'update' && t.state === 'done',
          body: t.result ? <pre className="canvas-result">{t.result.replace(/```[\s\S]*?```/g, '…')}</pre> : undefined,
        }
      }
      const pretty = (() => { try { return JSON.stringify(input, null, 2) } catch { return t.inputText } })()
      const [server, tool] = t.name.startsWith('mcp__') ? t.name.slice(5).split('__') : [undefined, t.name]
      return {
        icon: <Wrench size={14} />,
        title: tool,
        sub: server ? <span className="muted">{server}</span> : undefined,
        body: <>{pretty && pretty !== '{}' && <CodeBlock code={pretty} lang="json" maxLines={16} />}{t.result && <Output text={t.result} error={t.state === 'error'} />}</>,
      }
    }
  }
}

export function Status({ t }: { t: ToolBlock }) {
  const live = t.state === 'running' || t.state === 'input'
  const now = useNow(live)
  if (t.permission?.state === 'pending') return <span className="tool-status wait"><ShieldQuestion size={13} /></span>
  if (live) {
    const secs = t.elapsed ?? Math.max(0, Math.round((now - t.started) / 1000))
    return <span className="tool-status live"><Loader2 size={13} className="spin" />{secs >= 2 ? <span>{secs}s</span> : null}</span>
  }
  if (t.state === 'error') return <span className="tool-status err"><CircleAlert size={13} /></span>
  const ms = t.ended && t.started ? t.ended - t.started : 0
  return <span className="tool-status ok">{ms > 1500 ? <span>{duration(ms)}</span> : null}<Check size={13} /></span>
}

/** A subagent keeps working after its launch returns (background agents): its children say so. */
function busy(blocks: Block[]): boolean {
  return blocks.some(b => (b.kind === 'tool' && (b.state === 'running' || b.state === 'input' || b.permission?.state === 'pending' || busy(b.children))) || ((b.kind === 'text' || b.kind === 'thinking') && b.streaming))
}

function SubAgent({ t, ctx }: { t: ToolBlock; ctx: Ctx }) {
  const input = partialInput(t)
  const [open, setOpen] = useState(true)
  const live = t.state === 'running' || t.state === 'input' || busy(t.children)
  const steps = t.children.filter(c => c.kind === 'tool').length
  return (
    <div className={`subagent ${live ? 'live' : ''}`}>
      <button className="tool-head" onClick={() => setOpen(o => !o)}>
        <ChevronRight size={13} className={`chev ${open ? 'open' : ''}`} />
        <span className="tool-icon agent"><Bot size={14} /></span>
        <span className="tool-title">{str(input.description) || 'Subagent'}</span>
        {input.subagent_type ? <span className="chip">{str(input.subagent_type)}</span> : null}
        <span className="grow" />
        <span className="muted">{steps ? many(steps, 'tool use') : ''}</span>
        {live && t.state === 'done' ? <span className="tool-status live"><Loader2 size={13} className="spin" /><span>background</span></span> : <Status t={t} />}
      </button>
      {open && (
        <div className="subagent-body">
          <Blocks blocks={t.children} ctx={ctx} nested />
          {t.result && !live && (
            <details className="subagent-result">
              <summary>Result</summary>
              <Markdown text={t.result} onOpenPath={ctx.onOpenPath} />
            </details>
          )}
        </div>
      )}
    </div>
  )
}

export const ToolCall = memo(function ToolCall({ t, ctx }: { t: ToolBlock; ctx: Ctx; rev: number }) {
  if (t.name === 'Task' || t.name === 'Agent') return <SubAgent t={t} ctx={ctx} />
  const waiting = t.permission?.state === 'pending' ? t.permission.request.id : undefined
  if (t.name === 'AskUserQuestion') {
    return (
      <div className={`tool ask ${waiting ? 'asking' : ''}`} data-waiting={waiting}>
        <div className="tool-head static"><span className="tool-icon"><MessageCircleQuestion size={14} /></span><span className="tool-title">질문</span></div>
        <QuestionCard tool={t} p={t.permission} />
      </div>
    )
  }
  if (t.name === 'ExitPlanMode') return <div className={`tool plan ${waiting ? 'asking' : ''}`} data-waiting={waiting}><PlanCard tool={t} p={t.permission} /></div>
  return <GenericTool t={t} ctx={ctx} />
}, (a, b) => a.rev === b.rev && a.t === b.t)

function GenericTool({ t, ctx }: { t: ToolBlock; ctx: Ctx }) {
  const head = describe(t, ctx)
  const pending = t.permission?.state === 'pending'
  const [open, setOpen] = useState<boolean | undefined>(undefined)
  const isOpen = open ?? (pending || Boolean(head.open))
  return (
    <div className={`tool ${t.state} ${pending ? 'asking' : ''}`}>
      <button className="tool-head" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
        <ChevronRight size={13} className={`chev ${isOpen ? 'open' : ''}`} />
        <span className="tool-icon">{head.icon}</span>
        <span className="tool-title">{head.title}</span>
        {head.sub && <span className="tool-sub">{head.sub}</span>}
        <span className="grow" />
        {head.meta && <span className="tool-meta">{head.meta}</span>}
        <Status t={t} />
      </button>
      {isOpen && head.body && <div className="tool-body">{head.body}</div>}
      {t.permission && <PermissionCard p={t.permission} tool={t} />}
    </div>
  )
}

export function OrphanPermission({ p }: { p: PermissionState }) {
  const input = p.request.input
  return (
    <PermissionCard p={p}>
      <CodeBlock code={JSON.stringify(input, null, 2)} lang="json" maxLines={14} />
    </PermissionCard>
  )
}

export type { Ctx as ToolCtx, Block }
