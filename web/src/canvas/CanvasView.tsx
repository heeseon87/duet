import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ChevronUp, ChevronsDownUp, ChevronsLeft, ChevronsRight, ChevronsUpDown, Clock3, Compass, Copy, Eye, ListCollapse, ZoomIn, GitCompareArrows, Maximize2, MessageSquare, Minus, Plus, Shapes, Sparkles, Undo2, Workflow,
  Check, CircleDot, FileCode2, FileDiff, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, X, Bot, User, Trash2, Send, Pencil, Share, ImageDown, FolderGit2,
} from 'lucide-react'
import { deliveryLabel, describeDiff, diffMaps, exportMermaid, filesUnder, labelOf, relationKey, shapedBy, stepMark, type CanvasDecision, type CanvasElement, type CanvasMap, type CanvasRelation } from '../../../shared/canvas.ts'
import { codeMarks } from '../../../shared/mapFiles.ts'
import type { CanvasThread } from '../../../shared/protocol.ts'
import { api } from '../api.ts'
import { local, useApp } from '../state.ts'
import { Popover, relTime, shortcutKey } from '../lib/ui.tsx'
import { Markdown } from '../lib/Markdown.tsx'
import { MermaidStage, partIds, type StageHandle } from './MermaidStage.tsx'
import { CodePane } from './CodePane.tsx'
import { ContextMenu, FloatAt, type MenuEntry, type Point } from './ContextMenu.tsx'
import { confirmDialog } from '../lib/confirm.tsx'
import { download, standaloneSvg } from './exportSvg.ts'
import { useCanvas } from './store.ts'
import { useReview } from '../review/store.ts'

const CHANGE_LABEL: Record<string, string> = { add: 'New', modify: 'Modified', delete: 'Deleted', result: 'Result', keep: 'Unchanged' }
const kindLabel = (kind = 'class') => (kind === 'group' ? 'package' : kind)

function MapPicker() {
  const { list, name, open, create } = useCanvas()
  const ref = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const [making, setMaking] = useState(false)
  const cur = list.find(m => m.name === name)
  return (
    <>
      <button ref={ref} className="map-pick" onClick={() => setMenu(m => !m)}>
        {cur?.diagram === 'sequence' ? <Workflow size={14} /> : <Shapes size={14} />}
        <b className="ellipsis">{cur?.title ?? '지도 고르기'}</b>
        <ChevronDown size={12} />
      </button>
      {menu && (
        <Popover anchor={ref.current} onClose={() => { setMenu(false); setMaking(false) }} width={380}>
          {list.map(m => (
            <button key={m.name} className="menu-item" aria-checked={m.name === name} onClick={() => { void open(m.name); setMenu(false) }}>
              {m.diagram === 'sequence' ? <Workflow size={14} /> : <Shapes size={14} />}
              <span className="grow ellipsis">
                <span className="ellipsis">{m.title}</span>
                <span className="meta">{m.name} · rev {m.revision} · {relTime(m.updated)}{m.openDecisions ? ` · 결정 ${m.openDecisions}개 남음` : ''}{m.openThreads ? ` · 코멘트 ${m.openThreads}` : ''}</span>
              </span>
            </button>
          ))}
          {list.length > 0 && <div className="menu-sep" />}
          {making ? <NewMapForm onDone={async (n, d, t) => { await create(n, d, t); setMenu(false); setMaking(false) }} /> : (
            <button className="menu-item" onClick={() => setMaking(true)}><Plus size={14} /> 빈 지도 만들기</button>
          )}
        </Popover>
      )}
    </>
  )
}

function NewMapForm({ onDone }: { onDone: (name: string, diagram: 'class' | 'sequence', title: string) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [diagram, setDiagram] = useState<'class' | 'sequence'>('class')
  const name = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `map-${Date.now().toString(36)}`
  return (
    <div className="new-map">
      <input autoFocus className="input" placeholder="지도 제목" value={title} onChange={e => setTitle(e.target.value)} />
      <div className="seg">
        <button aria-pressed={diagram === 'class'} onClick={() => setDiagram('class')}><Shapes size={13} /> 클래스</button>
        <button aria-pressed={diagram === 'sequence'} onClick={() => setDiagram('sequence')}><Workflow size={13} /> 시퀀스</button>
      </div>
      <button className="btn sm primary" disabled={!title.trim()} onClick={() => void onDone(name, diagram, title.trim())}>만들기</button>
    </div>
  )
}

function Timeline() {
  const { history, revision, preview, setPreview, compareFrom, setCompare, restore } = useCanvas()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const last = history[history.length - 1]
  return (
    <>
      <button ref={ref} className="rev-chip" onClick={() => setOpen(o => !o)} title="Version history">
        <Clock3 size={13} />
        rev {preview?.revision ?? revision}
        {last && !preview && <span className="muted">· {last.by === 'agent' ? '에이전트' : '나'} · {relTime(last.ts)}</span>}
        <ChevronDown size={11} />
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} width={400}>
          <div className="menu-label">Version history</div>
          <div className="timeline">
            {[...history].reverse().map(h => (
              <div key={h.revision} className={`tl-item ${h.revision === (preview?.revision ?? revision) ? 'on' : ''}`}>
                <span className={`tl-dot ${h.by}`}>{h.by === 'agent' ? <Bot size={10} /> : <User size={10} />}</span>
                <button className="tl-main" onClick={() => { void setPreview(h.revision === revision ? undefined : h.revision); setOpen(false) }}>
                  <b>rev {h.revision}</b> <span className="ellipsis">{h.note ?? ''}</span>
                  <span className="meta">{relTime(h.ts)}</span>
                </button>
                {h.revision < revision && (
                  <button className={`iconbtn ${compareFrom === h.revision ? 'on' : ''}`} title="Compare with current" aria-pressed={compareFrom === h.revision} onClick={() => { void setCompare(compareFrom === h.revision ? undefined : h.revision); setOpen(false) }}>
                    <GitCompareArrows size={13} />
                  </button>
                )}
                {h.revision < revision && (
                  <button className="iconbtn" title="Restore this version" onClick={async () => { if (await confirmDialog({ title: `rev ${h.revision} 복원할까?`, body: '지금 버전도 기록에 남아.', ok: '복원' })) void restore(h.revision) }}>
                    <Undo2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}

function ThreadView({ t }: { t: CanvasThread }) {
  const { comment, setThread, deliveries } = useCanvas()
  const [reply, setReply] = useState('')
  return (
    <div className={`thread ${t.state}`}>
      {t.items.map(i => (
        <div key={i.id} className={`thread-item ${i.who}`}>
          <span className="who">{i.who === 'agent' ? <Bot size={12} /> : <User size={12} />}</span>
          <div className="grow">
            <Markdown text={i.text} /><span className="meta">{relTime(i.ts)}{i.terminal ? ' · 터미널' : ''}</span>
            {deliveries[i.id] && <div className="delivery">{deliveryLabel(deliveries[i.id])}</div>}
          </div>
        </div>
      ))}
      <div className="thread-actions">
        <input className="input grow" placeholder="답글" value={reply} onChange={e => setReply(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && reply.trim()) void comment(t.target, reply, t.id).then(ok => { if (ok) setReply('') }) }} />
        {t.state === 'open'
          ? <button className="iconbtn" title="Resolve" onClick={() => void setThread(t.id, 'resolved')}><Check size={13} /></button>
          : <button className="iconbtn" title="Reopen" onClick={() => void setThread(t.id, 'open')}><Undo2 size={13} /></button>}
      </div>
    </div>
  )
}

function Ask({ target, placeholder, autoFocus, onSent }: { target: string; placeholder: string; autoFocus?: boolean; onSent?: () => void }) {
  const comment = useCanvas(s => s.comment)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!text.trim()) return
    setBusy(true)
    try { if (await comment(target, text)) { setText(''); onSent?.() } } finally { setBusy(false) }
  }
  return (
    <div className="cv-ask">
      <textarea className="input" rows={3} autoFocus={autoFocus} placeholder={placeholder} value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void go() } }} />
      <div className="row">
        <span className="grow" />
        <button className="btn sm agent" disabled={!text.trim() || busy} onClick={() => void go()}><Send size={12} /> 에이전트에게 <kbd>⌘⏎</kbd></button>
      </div>
    </div>
  )
}

function MapAsk() {
  const [open, setOpen] = useState(false)
  if (!open) return <button className="btn sm ghost ask-open" onClick={() => setOpen(true)}><MessageSquare size={13} /> 지도 전체에 대해 묻기</button>
  return <div className="insp-section"><h4>지도 전체에 대해</h4><Ask target="" placeholder="묻거나 고칠 점 적기" /></div>
}

function RelationEditor({ rel }: { rel: CanvasRelation }) {
  const patch = useCanvas(s => s.patch)
  const select = useCanvas(s => s.select)
  const base = { from: rel.from, to: rel.to, kind: rel.kind }
  return (
    <>
      <InlineEdit className="insp-note-edit mono" value={rel.label ?? ''} placeholder="무엇이 오가는지 적기" onSave={v => void patch({ relations: [{ ...base, label: v || null }] }, `${rel.from}→${rel.to} 라벨`)} />
      <div className="row">
        <span className="muted small">단계</span>
        <input className="input step-input" type="number" min={0} defaultValue={rel.step ?? ''} onBlur={e => { const n = Number(e.target.value); if ((n || undefined) !== rel.step) void patch({ relations: [{ ...base, step: n > 0 ? n : null }] }, `${rel.from}→${rel.to} 단계`) }} />
        <span className="grow" />
        <button className="btn sm ghost danger" onClick={async () => {
          if (!(await confirmDialog({ title: '이 관계선을 지울까?', body: `${rel.from} → ${rel.to}`, ok: '지우기', danger: true }))) return
          await patch({ relations: [{ ...base, remove: true }] }, `${rel.from}→${rel.to} 지움`)
          select(undefined)
        }}><Trash2 size={12} /> 지우기</button>
      </div>
    </>
  )
}

const letterOf = (d: CanvasDecision, optionId: string) => optionId.replace(`${d.id}-`, '')

/** Select a decision and bring these parts of the map into view. */
type Show = (decision: string, ids: string[]) => void

/** How many parts a decision (or one option) shaped, and what to frame to show them: a merged line is found by its ends. */
function partsOf(map: CanvasMap, d: string, option?: string) {
  const s = shapedBy(map, d, option)
  return { n: s.elements.length + s.relations.length + s.messages.length, ids: [...s.elements.map(e => e.id), ...s.relations.flatMap(r => [r.from, r.to]), ...s.messages.map(m => m.id)] }
}

function OptionBody({ d, o }: { d: CanvasDecision; o: CanvasDecision['options'][number] }) {
  return (
    <>
      <div className="option-text"><span className="opt-letter">{letterOf(d, o.id)}</span>{o.text}</div>
      {o.impact && <div className="option-impact">{o.impact}</div>}
    </>
  )
}

/** Where the latest thing sent about this target stands with the agent. */
function DeliveryLine({ target }: { target: string }) {
  const threads = useCanvas(s => s.threads)
  const deliveries = useCanvas(s => s.deliveries)
  const last = threads.filter(t => t.target === target).flatMap(t => t.items).filter(i => deliveries[i.id]).sort((a, b) => a.ts - b.ts).pop()
  return last ? <div className="delivery">{deliveryLabel(deliveries[last.id])}</div> : null
}

/**
 * One decision in full. Open: the question, then each option, to pick from. Made: the question,
 * the pick and why, and the options that lost with why they lost. The id and the part counts
 * select the decision and frame what it shaped on the map.
 */
function DecisionCard({ d, map, readOnly, show, onFold }: { d: CanvasDecision; map: CanvasMap; readOnly: boolean; show: Show; onFold?: () => void }) {
  const choose = useCanvas(s => s.choose)
  const select = useCanvas(s => s.select)
  const [pick, setPick] = useState<string | undefined>()
  const [why, setWhy] = useState('')
  const [notify, setNotify] = useState(true)
  const all = partsOf(map, d.id)
  const idClass = `decision-id ${d.chosen ? 'done' : ''}`
  const id = all.n
    ? <button className={idClass} title="지도에서 보기" onClick={() => show(d.id, all.ids)}>{d.id}</button>
    : <span className={idClass}>{d.id}</span>
  const count = (oid: string) => {
    const p = partsOf(map, d.id, oid)
    return p.n > 0 && <button className="link-btn option-count" onClick={e => { e.stopPropagation(); show(d.id, p.ids) }}>{p.n}곳 보기</button>
  }
  const chosen = d.options.find(o => o.id === d.chosen)
  if (chosen) {
    const others = d.options.filter(o => o.id !== chosen.id)
    return (
      <div className="decision closed">
        <div className="decision-top">
          {id}
          <span className="decision-state done"><Check size={12} /> {letterOf(d, chosen.id)}로 정함</span>
          <span className="grow" />
          {onFold && <button className="iconbtn" title="한 줄로 접기" onClick={onFold}><ChevronUp size={13} /></button>}
        </div>
        <div className="decision-q">{d.question}</div>
        <div className="decision-answer"><OptionBody d={d} o={chosen} />{count(chosen.id)}</div>
        {d.rationale && <div className="decision-why"><b>이유</b> {d.rationale}</div>}
        {others.length > 0 && (
          <div className="options">
            {others.map(o => (
              <div key={o.id} className="option lost">
                <OptionBody d={d} o={o} />
                {o.rejected && <div className="option-rejected"><b>버린 이유</b> {o.rejected}</div>}
              </div>
            ))}
          </div>
        )}
        {!readOnly && <button className="link-btn reopen" onClick={() => void choose(d.id, null)}>이 결정 다시 열기</button>}
      </div>
    )
  }
  const toggle = (oid: string) => setPick(p => (p === oid ? undefined : oid))
  return (
    <div className="decision open">
      <div className="decision-top">
        {id}
        <span className="decision-state todo">결정 전</span>
      </div>
      <div className="decision-q">{d.question}</div>
      <div className="options">
        {d.options.map(o => readOnly ? (
          <div key={o.id} className="option"><OptionBody d={d} o={o} />{count(o.id)}</div>
        ) : (
          <div key={o.id} role="button" tabIndex={0} className={`option pickable ${pick === o.id ? 'picked' : ''}`} aria-pressed={pick === o.id}
            onClick={() => toggle(o.id)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(o.id) } }}>
            <OptionBody d={d} o={o} />
            {count(o.id)}
          </div>
        ))}
      </div>
      {pick && !readOnly && (
        <div className="decide-form">
          <input className="input" placeholder="고른 이유 (선택)" value={why} onChange={e => setWhy(e.target.value)} />
          <label className="toggle"><input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} /> 에이전트에게 보내기</label>
          <div className="row">
            <span className="muted small">다른 선택지 쪽은 지도에서 정리돼</span>
            <span className="grow" />
            <button className="btn sm ghost" onClick={() => setPick(undefined)}>취소</button>
            <button className="btn sm primary" onClick={() => { void choose(d.id, pick, why || undefined, notify); select(undefined) }}>{letterOf(d, pick)}로 결정</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** A made decision in one line, "D3 ✓ a 질문 … → 고른 답"; a click opens it in full with its thread. */
function MadeDecision({ d, map, readOnly, show }: { d: CanvasDecision; map: CanvasMap; readOnly: boolean; show: Show }) {
  const [open, setOpen] = useState(false)
  const threads = useCanvas(s => s.threads)
  const chosen = d.options.find(o => o.id === d.chosen)
  if (!chosen) return null
  if (open) {
    return (
      <div className="made open" data-decision={d.id}>
        <DecisionCard d={d} map={map} readOnly={readOnly} show={show} onFold={() => setOpen(false)} />
        {threads.filter(t => t.target === d.id).map(t => <ThreadView key={t.id} t={t} />)}
      </div>
    )
  }
  return (
    <div className="made" data-decision={d.id}>
      <button className="made-row" onClick={() => setOpen(true)} title={`${d.question} → ${chosen.text}`}>
        <span className="decision-id done">{d.id}</span>
        <Check size={12} className="made-check" />
        <span className="opt-letter">{letterOf(d, chosen.id)}</span>
        <span className="made-text">{d.question}<span className="made-arrow"> → </span>{chosen.text}</span>
      </button>
      <DeliveryLine target={d.id} />
    </div>
  )
}

function Inspector({ map, readOnly, onHide, wide, onToggleWide, onFrame, onCode }: { map: CanvasMap; readOnly: boolean; onHide: () => void; wide: boolean; onToggleWide: () => void; onFrame: (ids: string[]) => void; onCode: (file: string) => void }) {
  const { selected, select, threads, toggleCollapse, collapsed } = useCanvas()
  const show: Show = (d, ids) => { select(d); onFrame(ids) }
  const el = map.elements.find(e => e.id === selected)
  const rel = map.relations.find(r => relationKey(r) === selected)
  const msg = map.messages?.find(m => m.id === selected)
  const dec = map.decisions?.find(d => d.id === selected)
  const mine = threads.filter(t => t.target === (selected ?? ''))
  const openThreads = threads.filter(t => t.state === 'open')
  const openDecisions = (map.decisions ?? []).filter(d => !d.chosen)
  const closedDecisions = (map.decisions ?? []).filter(d => d.chosen)
  const widen = <button className="iconbtn" onClick={onToggleWide} title={wide ? '좁게 보기' : '넓게 보기'}>{wide ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}</button>

  if (!selected) {
    return (
      <div className={`inspector compact ${wide ? 'wide' : ''}`}>
        <div className="insp-head"><span className="grow" />{widen}<button className="iconbtn" onClick={onHide} title="닫기 (i)"><X size={14} /></button></div>
        <div className="insp-title">{map.title}</div>
        {map.context && <div className="insp-context"><Markdown text={map.context} /></div>}
        <Legend map={map} />
        {openDecisions.length > 0 && <div className="insp-section" data-decisions><h4>결정할 것 {openDecisions.length}</h4>{openDecisions.map(d => <DecisionCard key={d.id} d={d} map={map} readOnly={readOnly} show={show} />)}</div>}
        {openThreads.length > 0 && (
          <div className="insp-section">
            <h4>열린 코멘트 {openThreads.length}</h4>
            {openThreads.map(t => (
              <button key={t.id} className="thread-link" onClick={() => select(t.target || undefined)}>
                <MessageSquare size={12} /><span className="ellipsis grow">{t.targetLabel}</span><span className="muted">{t.items.length}</span>
              </button>
            ))}
          </div>
        )}
        {!readOnly && <MapAsk />}
        {mine.length > 0 && <div className="insp-section">{mine.map(t => <ThreadView key={t.id} t={t} />)}</div>}
        {closedDecisions.length > 0 && (
          <div className="insp-section made-list" data-decisions><h4>정한 결정 {closedDecisions.length}</h4>{closedDecisions.map(d => <MadeDecision key={d.id} d={d} map={map} readOnly={readOnly} show={show} />)}</div>
        )}
      </div>
    )
  }

  const incoming = el ? map.relations.filter(r => r.to === el.id) : []
  const outgoing = el ? map.relations.filter(r => r.from === el.id) : []
  const children = el ? map.elements.filter(e => e.parent === el.id) : []
  return (
    <div className={`inspector ${wide ? 'wide' : ''}`}>
      <div className="insp-head">
        <button className="iconbtn" onClick={() => select(undefined)} title="선택 해제 (esc)"><ArrowLeft size={14} /></button>
        <span className="grow" />
        {widen}
        <button className="iconbtn" onClick={onHide} title="닫기 (i)"><X size={14} /></button>
      </div>
      {el && (
        <>
          {readOnly ? <div className="insp-title">{el.label ?? el.id}</div> : <ElementEditor el={el} />}
          <div className="row wrap">
            <span className="chip">{kindLabel(el.kind)}</span>
            {readOnly && el.change && el.change !== 'keep' && <span className={`chip cv-chip-${el.change}`}>{CHANGE_LABEL[el.change]}</span>}
            {el.decision && <DecisionChip map={map} decision={el.decision} option={el.option} />}
            <code className="muted">{el.id}</code>
          </div>
          {el.kind === 'group' && (
            <button className="btn sm" onClick={() => toggleCollapse(el.id)}>{collapsed.has(el.id) ? 'Expand' : 'Collapse'}</button>
          )}
          {readOnly && el.note && <div className="insp-note"><Markdown text={el.note} /></div>}
          {el.members && el.members.length > 0 && (
            <div className="insp-section">
              <h4>멤버</h4>
              <ul className="members">
                {el.members.map((m, i) => <li key={i} className={m.change ?? ''}><span className="mark">{m.change === 'add' ? '+' : m.change === 'delete' ? '−' : m.change === 'modify' ? '~' : ''}</span><code>{m.text}</code></li>)}
              </ul>
            </div>
          )}
          {el.files && el.files.length > 0 && (
            <div className="insp-section">
              <h4>코드</h4>
              {el.files.map(f => (
                <button key={f} className="file-link" onClick={() => onCode(f)}>
                  <FileCode2 size={12} /><span className="ellipsis">{f}</span>
                </button>
              ))}
            </div>
          )}
          {children.length > 0 && (
            <div className="insp-section"><h4>안에 있는 것 {children.length}</h4>
              {children.map(c => <button key={c.id} className="rel-link" onClick={() => select(c.id)}><CircleDot size={11} /> {c.label ?? c.id}</button>)}
            </div>
          )}
          {(incoming.length > 0 || outgoing.length > 0) && (
            <div className="insp-section">
              <h4>관계</h4>
              {outgoing.map(r => <RelLink key={relationKey(r)} r={r} map={map} dir="out" />)}
              {incoming.map(r => <RelLink key={relationKey(r)} r={r} map={map} dir="in" />)}
            </div>
          )}
        </>
      )}
      {rel && (
        <>
          <div className="insp-title rel-title">
            <button className="link-btn" onClick={() => select(rel.from)}>{labelOf(map, rel.from)}</button>
            <ArrowRight size={14} />
            <button className="link-btn" onClick={() => select(rel.to)}>{labelOf(map, rel.to)}</button>
          </div>
          <div className="row wrap">
            <span className="chip">{rel.kind ?? 'association'}</span>
            {rel.step && <span className="chip accent">{stepMark(rel.step)} 단계</span>}
            {rel.change && <span className={`chip cv-chip-${rel.change}`}>{CHANGE_LABEL[rel.change]}</span>}
            {rel.decision && <DecisionChip map={map} decision={rel.decision} option={rel.option} />}
          </div>
          {readOnly
            ? rel.label && <div className="insp-note"><code>{rel.label}</code></div>
            : <RelationEditor rel={rel} />}
        </>
      )}
      {msg && (
        <>
          <div className="insp-title">{msg.label || msg.id}</div>
          <div className="row wrap">
            <button className="link-btn" onClick={() => select(msg.from)}>{labelOf(map, msg.from)}</button>
            {msg.to && <><ArrowRight size={13} /><button className="link-btn" onClick={() => select(msg.to)}>{labelOf(map, msg.to)}</button></>}
            <span className="chip">{msg.kind ?? 'call'}</span>
          </div>
        </>
      )}
      {dec && <DecisionCard key={dec.id} d={dec} map={map} readOnly={readOnly} show={show} />}
      {!el && !rel && !msg && !dec && <div className="insp-note muted">지금 지도에서는 지워졌어.</div>}
      <div className="insp-section">
        {mine.map(t => <ThreadView key={t.id} t={t} />)}
        {!readOnly && <Ask target={selected} placeholder="묻거나 고칠 점 적기" />}
      </div>
    </div>
  )
}

/** The decision that shaped a part, with its option: a click selects the decision. */
function DecisionChip({ map, decision, option }: { map: CanvasMap; decision: string; option?: string }) {
  const select = useCanvas(s => s.select)
  const made = map.decisions?.some(d => d.id === decision && d.chosen)
  return <button className={`chip ${made ? 'add' : 'accent'}`} onClick={() => select(decision)}>{decision}{option ? ` · ${option.replace(`${decision}-`, '')}` : ''}</button>
}

/** Click to edit in place; Enter saves, Escape cancels. */
function InlineEdit({ value, onSave, className, placeholder, multiline }: { value: string; onSave: (v: string) => void; className?: string; placeholder?: string; multiline?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  if (!editing) {
    return (
      <button className={`inline-edit ${className ?? ''} ${value ? '' : 'empty-val'}`} title="고치기" onClick={() => setEditing(true)}>
        {value || placeholder}<Pencil size={11} className="pen" />
      </button>
    )
  }
  const save = () => { setEditing(false); if (draft.trim() !== value.trim()) onSave(draft.trim()) }
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <Tag
      autoFocus
      className={`input inline-input ${className ?? ''}`}
      value={draft}
      rows={multiline ? 3 : undefined}
      onChange={e => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); setDraft(value) }
        if (e.key === 'Enter' && (!multiline || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); save() }
      }}
    />
  )
}

const CHANGES: CanvasElement['change'][] = ['add', 'modify', 'delete', 'result', 'keep']

function ElementEditor({ el }: { el: CanvasElement }) {
  const patch = useCanvas(s => s.patch)
  const select = useCanvas(s => s.select)
  const toast = useApp(s => s.toast)
  const apply = async (p: Parameters<typeof patch>[0], note: string) => {
    const errors = await patch(p, note)
    if (errors?.length) toast(errors[0], 'error')
  }
  return (
    <>
      <InlineEdit className="insp-title" value={el.label ?? el.id} onSave={v => void apply({ elements: [{ id: el.id, label: v || null }] }, `${el.id} 이름 바꿈`)} />
      {el.kind !== 'group' && (
        <div className="change-pick">
          {CHANGES.map(c => (
            <button key={c} className={`chip cv-chip-${c} ${(el.change ?? 'keep') === c ? 'on' : ''}`} onClick={() => void apply({ elements: [{ id: el.id, change: c === 'keep' ? null : c }] }, `${el.id} → ${CHANGE_LABEL[c!]}`)}>{CHANGE_LABEL[c!]}</button>
          ))}
        </div>
      )}
      <InlineEdit multiline className="insp-note-edit" value={el.note ?? ''} placeholder="메모 달기" onSave={v => void apply({ elements: [{ id: el.id, note: v || null }] }, `${el.id} 메모`)} />
      <button className="btn sm ghost danger del-el" onClick={async () => {
        if (!(await confirmDialog({ title: `'${el.label ?? el.id}' 지울까?`, body: '이어진 관계선도 함께 지워져. 기록에서 되돌릴 수 있어.', ok: '지우기', danger: true }))) return
        await apply({ remove: { elements: [el.id] } }, `${el.id} 지움`)
        select(undefined)
      }}><Trash2 size={12} /> 지도에서 지우기</button>
    </>
  )
}

function RelLink({ r, map, dir }: { r: CanvasMap['relations'][number]; map: CanvasMap; dir: 'in' | 'out' }) {
  const select = useCanvas(s => s.select)
  const other = dir === 'out' ? r.to : r.from
  return (
    <button className="rel-link" onClick={() => select(relationKey(r))}>
      <span className={`rel-dir ${dir}`}>{dir === 'out' ? '→' : '←'}</span>
      <span className="ellipsis grow"><b>{labelOf(map, other)}</b>{r.label ? <span className="muted"> · {r.step ? stepMark(r.step) + ' ' : ''}{r.label}</span> : null}</span>
    </button>
  )
}

function Legend({ map }: { map: CanvasMap }) {
  const used = new Set(map.elements.map(e => e.change ?? 'keep'))
  const items = (['add', 'modify', 'delete', 'result', 'keep'] as const).filter(c => used.has(c))
  if (items.length <= 1 && !map.decisions?.some(d => !d.chosen)) return null
  return (
    <div className="legend">
      {items.map(c => <span key={c} className="legend-item"><i className={`sw cv-sw-${c}`} />{CHANGE_LABEL[c]}</span>)}
      {map.decisions?.some(d => !d.chosen) && <span className="legend-item"><i className="sw cv-sw-open" />결정 전</span>}
    </div>
  )
}

export function CanvasView() {
  const workspace = useApp(s => s.workspace)
  const setDraft = useApp(s => s.setDraft)
  const toast = useApp(s => s.toast)
  const setTab = useApp(s => s.setTab)
  const s = useCanvas()
  const stage = useRef<StageHandle>(null)
  const [menu, setMenu] = useState<{ target?: string; at: Point }>()
  const [asking, setAsking] = useState<{ target: string; at: Point }>()
  // Explore mode starts (and stays) with the card away: clicking only highlights. So does the code pane, which stands in for the card.
  const [inspector, setInspector] = useState(() => !useCanvas.getState().explore && local.get('canvas.code') === '0')
  useEffect(() => { if (s.explore) setInspector(false) }, [s.explore])
  // A wider info card for long decisions and notes; remembered.
  const [wideInsp, setWideInsp] = useState(() => local.get('canvas.wideInspector') === '1')
  const toggleWide = () => setWideInsp(w => { local.set('canvas.wideInspector', w ? '0' : '1'); return !w })
  // The code pane beside the map; remembered. It stands in for the info card: opening it puts the card away, and while
  // it is open a pick does not bring the card back (`i` still does).
  const [codeOpen, setCodeOpen] = useState(() => local.get('canvas.code') !== '0')
  const codeOpenRef = useRef(codeOpen)
  codeOpenRef.current = codeOpen
  const [codeWant, setCodeWant] = useState<{ file: string; nonce: number }>()
  // Opened by the person this render: the pane slides in (a reload or a map switch just shows it).
  const codeSlide = useRef(false)
  useEffect(() => { codeSlide.current = false })
  const showCode = (open: boolean, file?: string) => {
    if (open && !codeOpenRef.current) codeSlide.current = true
    setCodeOpen(open)
    local.set('canvas.code', open ? '1' : '0')
    if (open) setInspector(false)
    if (file) setCodeWant({ file, nonce: Date.now() })
  }

  useEffect(() => { if (workspace) void s.loadList() }, [workspace?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  const shownMap = s.preview?.map ?? s.map
  // The same files the review lists, matched to the parts the same way: what is built, what is not yet.
  const bound = useReview(r => r.bound), editing = useReview(r => r.editing), diff = useReview(r => r.diff), root = useReview(r => r.root), home = useReview(r => r.home)
  const oneTurn = useReview(r => r.source.kind === 'turn'), viewed = useReview(r => r.viewed)
  const code = useMemo(
    () => (shownMap?.diagram === 'class' && bound && bound.map === s.mapName && !editing && diff && root && home ? codeMarks(shownMap, diff.files, root, home, { pending: !oneTurn, viewed: new Set(Object.keys(viewed)) }) : undefined),
    [shownMap, bound, s.mapName, editing, diff, root, home, oneTurn, viewed],
  )
  const foldable = useMemo(() => {
    const parents = new Set((shownMap?.elements ?? []).map(e => e.parent).filter(Boolean))
    return (shownMap?.elements ?? []).filter(e => e.kind === 'group' && parents.has(e.id)).map(e => e.id)
  }, [shownMap])
  const hasGroups = shownMap?.diagram === 'class' && foldable.length > 0
  const allFolded = foldable.length > 0 && foldable.every(id => s.collapsed.has(id))
  const ghosts = useMemo(() => (s.compareMap && s.map && !s.preview ? diffMaps(s.compareMap, s.map) : undefined), [s.compareMap, s.map, s.preview])
  const changes = useMemo(() => (ghosts && s.map ? describeDiff(ghosts, s.map) : []), [ghosts, s.map])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (useApp.getState().tab !== 'canvas') return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      const k = shortcutKey(e)
      // Letting go of the selection also puts the info card away; `i` brings back the map's overview.
      if (k === 'Escape') { s.select(undefined); setInspector(false) }
      else if (k === 'f' && !e.metaKey) stage.current?.fit()
      else if ((k === '=' || k === '+') && !e.metaKey) stage.current?.zoom(1.2)
      else if (k === '-' && !e.metaKey) stage.current?.zoom(1 / 1.2)
      else if (k === 'i' && !e.metaKey) setInspector(v => !v)
      else if (k === 'e' && !e.metaKey) s.setExplore(!useCanvas.getState().explore)
      else if (k === 'c' && !e.metaKey && !e.ctrlKey) showCode(!codeOpenRef.current)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [s])

  if (!workspace) return null
  if (!s.list.length && !s.loading) {
    return (
      <div className="canvas empty-canvas">
        <div className="empty">
          <div className="hero-mark"><Shapes size={22} /></div>
          <h3>아직 지도가 없어</h3>
          <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn agent" onClick={() => setDraft('이 저장소에서 지금 작업 중인 부분의 구조를 캔버스에 클래스 지도로 그려 줘. 패키지는 group으로 묶고, 관계선에는 무엇이 오가는지 라벨을 달아 줘.')}>
              <Sparkles size={14} /> 에이전트에게 맡기기
            </button>
            <NewMapInline />
          </div>
        </div>
      </div>
    )
  }
  if (!shownMap) return <div className="canvas" />

  // Another map gets a stage of its own: it opens fitted, and no fold, morph or pending frame of the last one carries over.
  // Keyed by the map loaded, not `name`, which changes first while the old map is still drawn.
  const stageKey = `${workspace.path}:${s.mapName}`
  const unseen = s.seenRevision !== undefined && s.revision > s.seenRevision && !s.preview
  const readOnly = Boolean(s.preview)
  const canCompare = !s.preview && (Boolean(s.compareFrom) || s.revision > 1)

  // After the selection has settled (its own slide into view), so the camera move wins.
  const frameSoon = (ids: string[]) => requestAnimationFrame(() => stage.current?.frame(ids))
  const decisions = shownMap.decisions ?? []
  const made = decisions.filter(d => d.chosen).length
  const showDecisions = () => {
    s.select(undefined)
    setInspector(true)
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector('.inspector [data-decisions]')?.scrollIntoView({ block: 'start', behavior: 'smooth' })))
  }
  /**
   * The package drawn right beside a top-level package, toward `side` along a row (a column when
   * the map runs LR), and where it goes in the map's order to cross it. Read off the drawing, so it
   * works whichever way the layout lays the order out.
   */
  const besideOf = (map: CanvasMap, id: string, side: -1 | 1): { id: string; place: 'before' | 'after' } | undefined => {
    const svg = stage.current?.svg()
    const el = map.elements.find(e => e.id === id)
    if (!svg || !el) return undefined
    const rect = (x: string) => svg.querySelector(`[data-target="${CSS.escape(x)}"]:is(.cv-node, .cv-cluster)`)?.getBoundingClientRect()
    const me = rect(id)
    if (!me) return undefined
    const across = map.direction === 'LR' || map.direction === 'RL'
    const lo = (r: DOMRect) => (across ? r.left : r.top), hi = (r: DOMRect) => (across ? r.right : r.bottom)
    const mid = (r: DOMRect) => (across ? r.top + r.height / 2 : r.left + r.width / 2)
    let best: { id: string; d: number } | undefined
    for (const sib of map.elements) {
      if (sib.id === id || (sib.parent ?? '') !== (el.parent ?? '')) continue
      const r = rect(sib.id)
      if (!r) continue
      // In the same row: they overlap across the row by a good part of the smaller one.
      if (Math.min(hi(r), hi(me)) - Math.max(lo(r), lo(me)) < 0.3 * Math.min(hi(r) - lo(r), hi(me) - lo(me))) continue
      const d = (mid(r) - mid(me)) * side
      if (d > 0 && (!best || d < best.d)) best = { id: sib.id, d }
    }
    if (!best) return undefined
    const index = (x: string) => map.elements.findIndex(e => e.id === x)
    return { id: best.id, place: index(best.id) < index(id) ? 'before' : 'after' }
  }
  const menuEntries = (target: string | undefined, at: Point): MenuEntry[] => {
    const map = shownMap
    const el = target ? map.elements.find(e => e.id === target) : undefined
    const rel = target && !el ? map.relations.find(r => relationKey(r) === target) : undefined
    const msg = target && !el && !rel ? map.messages?.find(m => m.id === target) : undefined
    const ask = (t: string): MenuEntry[] => readOnly ? [] : [{ kind: 'item', key: 'ask', icon: <MessageSquare size={14} />, label: t ? '에이전트에게 묻기' : '지도 전체에 대해 묻기', run: () => setAsking({ target: t, at }) }]
    const info = (t: string): MenuEntry => ({ kind: 'item', key: 'info', icon: <Eye size={14} />, label: '정보 카드에서 보기', hint: 'i', run: () => { s.select(t); setInspector(true) } })
    const zoomTo = (ids: string[]): MenuEntry => ({ kind: 'item', key: 'zoom', icon: <ZoomIn size={14} />, label: 'Zoom to selection', run: () => frameSoon(ids) })
    if (el || rel || msg) {
      const t = target!
      const out: MenuEntry[] = [{ kind: 'head', label: labelOf(map, t), sub: el ? kindLabel(el.kind) : rel ? '관계선' : '메시지' }, ...ask(t)]
      // The code of this part (a package: everything in it), reviewed on its own.
      if (el && filesUnder(map, t).length) out.push({ kind: 'item', key: 'changes', icon: <FileDiff size={14} />, label: '이 부분의 변경 보기', run: () => { setTab('review'); void useReview.getState().showPart(map, t) } })
      const files = el?.files ?? []
      // In the code pane beside the map; the pane links on to the review.
      const open = (f: string) => () => showCode(true, f)
      if (files.length === 1) out.push({ kind: 'item', key: 'file', icon: <FileCode2 size={14} />, label: '코드 열기', sub: files[0].split('/').pop(), run: open(files[0]) })
      else if (files.length > 1) {
        out.push({ kind: 'sep' }, { kind: 'head', label: '코드 열기' })
        for (const f of files.slice(0, 6)) out.push({ kind: 'item', key: `file:${f}`, icon: <FileCode2 size={14} />, label: f.split('/').pop() ?? f, run: open(f) })
        out.push({ kind: 'sep' })
      }
      const foldable = el?.kind === 'group' && map.diagram === 'class' && map.elements.some(e => e.parent === el.id)
      if (foldable) {
        const folded = s.collapsed.has(el.id)
        out.push({ kind: 'item', key: 'fold', icon: folded ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />, label: folded ? 'Expand' : 'Collapse', run: () => s.toggleCollapse(el.id) })
        out.push({ kind: 'item', key: 'solo', icon: <ListCollapse size={14} />, label: '이것만 펼치기', run: () => { const changed = s.soloExpand(el.id); stage.current?.frame([el.id], changed) } })
      }
      out.push(zoomTo(partIds(map, t)))
      // Only top-level packages: the layout keeps their order; a box tied by lines (or a package
      // inside another) goes where the lines put it, whatever the order says.
      if (el?.kind === 'group' && !el.parent && map.diagram === 'class' && !readOnly) {
        const across = map.direction === 'LR' || map.direction === 'RL'
        const move = (side: -1 | 1, label: string, icon: React.ReactNode): MenuEntry => {
          const nb = besideOf(map, t, side)
          return { kind: 'item', key: `move${side}`, icon, label, disabled: !nb, run: () => { if (nb) void s.patch({ elements: [{ id: t, [nb.place]: nb.id }] }, `${labelOf(map, t)} ${label.replace(' 옮기기', '')}`) } }
        }
        out.push({ kind: 'sep' },
          move(-1, across ? '위로 옮기기' : '왼쪽으로 옮기기', across ? <ArrowUp size={14} /> : <ArrowLeft size={14} />),
          move(1, across ? '아래로 옮기기' : '오른쪽으로 옮기기', across ? <ArrowDown size={14} /> : <ArrowRight size={14} />))
      }
      out.push({ kind: 'sep' }, info(t))
      return out
    }
    return [
      { kind: 'head', label: map.title },
      { kind: 'item', key: 'fit', icon: <Maximize2 size={14} />, label: 'Zoom to fit', hint: 'f', run: () => stage.current?.fit() },
      ...(hasGroups ? [
        { kind: 'item', key: 'fold-all', icon: <ChevronsDownUp size={14} />, label: 'Collapse all', disabled: allFolded, run: () => s.setAllCollapsed(true) },
        { kind: 'item', key: 'unfold-all', icon: <ChevronsUpDown size={14} />, label: 'Expand all', disabled: !s.collapsed.size, run: () => s.setAllCollapsed(false) },
      ] satisfies MenuEntry[] : []),
      { kind: 'item', key: 'explore', icon: <Compass size={14} />, label: s.explore ? '탐색 모드 끄기' : '탐색 모드 켜기', hint: 'e', run: () => s.setExplore(!s.explore) },
      { kind: 'item', key: 'card', icon: <Eye size={14} />, label: inspector ? '정보 카드 닫기' : '정보 카드 열기', hint: 'i', run: () => setInspector(v => !v) },
      ...(canCompare ? [{ kind: 'item', key: 'compare', icon: <GitCompareArrows size={14} />, label: s.compareFrom ? '비교 끄기' : 'Compare with previous', run: () => void s.setCompare(s.compareFrom ? undefined : s.revision - 1) }] satisfies MenuEntry[] : []),
      ...ask(''),
      { kind: 'sep' },
      { kind: 'item', key: 'mermaid', icon: <Copy size={14} />, label: 'Mermaid로 복사', run: () => { void navigator.clipboard.writeText('```mermaid\n' + exportMermaid(map) + '\n```'); toast('Mermaid 코드를 복사했어') } },
    ]
  }
  return (
    <div className="canvas">
      <div className="canvas-bar">
        <MapPicker />
        <Timeline />
        {decisions.length > 0 && (
          <button className={`chip dec-chip ${made < decisions.length ? 'accent' : 'quiet'}`} onClick={showDecisions}
            title={made < decisions.length ? `결정할 것 ${decisions.length - made}개 · 정한 결정 ${made}개` : '결정을 모두 정했어'}>
            결정 {made}/{decisions.length}
          </button>
        )}
        <CodeChip marks={code} />
        <span className="grow" />
        {s.compareFrom && !s.preview && (
          <span className="compare-chip">
            <GitCompareArrows size={13} /> rev {s.compareFrom} → {s.revision} 비교 중 · {changes.length}곳
            <button className="iconbtn" onClick={() => void s.setCompare(undefined)}><X size={12} /></button>
          </span>
        )}
        {!s.compareFrom && s.revision > 1 && !s.preview && (
          <button className="btn sm ghost" onClick={() => void s.setCompare(s.revision - 1)} title="Compare with previous"><GitCompareArrows size={13} /><span className="bar-label"> Compare with previous</span></button>
        )}
        {hasGroups && (
          <div className="seg">
            <button onClick={() => s.setAllCollapsed(true)} title="Collapse all packages" disabled={allFolded}><ChevronsDownUp size={13} /><span className="bar-label"> Collapse all</span></button>
            <button onClick={() => s.setAllCollapsed(false)} title="Expand all packages" disabled={!s.collapsed.size}><ChevronsUpDown size={13} /><span className="bar-label"> Expand all</span></button>
          </div>
        )}
        <div className="seg">
          <button aria-pressed={s.explore} onClick={() => s.setExplore(!s.explore)} title={s.explore ? '탐색 모드 끄기 (e)' : '탐색 모드 (e)'}><Compass size={13} /><span className="bar-label"> 탐색</span></button>
          <button aria-pressed={codeOpen} onClick={() => showCode(!codeOpen)} title={codeOpen ? '코드 칸 닫기 (c)' : '코드 칸: 누른 상자의 코드를 옆에서 보기 (c)'}><FileCode2 size={13} /><span className="bar-label"> 코드</span></button>
        </div>
        <div className="seg">
          <button onClick={() => stage.current?.zoom(1 / 1.2)} title="Zoom out (-)"><Minus size={13} /></button>
          <button onClick={() => stage.current?.fit()} title="Zoom to fit (f)"><Maximize2 size={13} /></button>
          <button onClick={() => stage.current?.zoom(1.2)} title="Zoom in (+)"><Plus size={13} /></button>
        </div>
        <ExportMenu map={shownMap} stage={stage} name={s.name ?? 'map'} />
        {s.name && <button className="iconbtn" title="지도 지우기" onClick={async () => { if (await confirmDialog({ title: '이 지도를 지울까?', body: '지도와 기록, 코멘트가 ~/.duet/trash로 옮겨져.', ok: '지우기', danger: true })) void s.remove(s.name!) }}><Trash2 size={14} /></button>}
      </div>
      {unseen && (
        <div className="unseen-banner fade-in">
          <Bot size={14} />
          <span>에이전트가 지도를 바꿨어 <b>rev {s.seenRevision} → {s.revision}</b>{changes.length ? ` · ${changes.length}곳` : ''}</span>
          {changes.length > 0 && <span className="changes ellipsis">{changes.slice(0, 6).join('  ')}</span>}
          <span className="grow" />
          <button className="btn sm" onClick={() => s.acknowledge()}><Check size={13} /> 확인</button>
        </div>
      )}
      {s.elsewhere && !unseen && (
        <div className="unseen-banner fade-in">
          <Bot size={14} />
          <span>에이전트가 다른 지도를 바꿨어: <b>{s.elsewhere.title}</b> · rev {s.elsewhere.revision}</span>
          <span className="grow" />
          <button className="btn sm" onClick={() => void s.open(s.elsewhere!.name)}>열기</button>
          <button className="iconbtn" onClick={() => useCanvas.setState({ elsewhere: undefined })}><X size={13} /></button>
        </div>
      )}
      <CodePrompt />
      {s.preview && (
        <div className="preview-banner">
          <Clock3 size={14} /> rev {s.preview.revision} · 읽기 전용
          <span className="grow" />
          <button className="btn sm" onClick={() => void s.setPreview(undefined)}>최신으로</button>
          <button className="btn sm" onClick={async () => { if (await confirmDialog({ title: `rev ${s.preview!.revision} 복원할까?`, body: '지금 버전도 기록에 남아.', ok: '복원' })) void s.restore(s.preview!.revision) }}><Undo2 size={13} /> Restore this version</button>
        </div>
      )}
      <div className="canvas-body">
        <div className="canvas-main">
        <MermaidStage
          key={stageKey}
          ref={stage}
          viewKey={stageKey}
          map={shownMap}
          collapsed={s.collapsed}
          ghostsFrom={ghosts}
          glow={s.glow}
          selected={s.selected}
          threads={s.threads}
          code={code?.marks}
          onSelect={t => { s.select(t); if (!useCanvas.getState().explore && !codeOpen) setInspector(Boolean(t)) }}
          onToggleGroup={s.toggleCollapse}
          onContext={(t, at) => {
            // A known part is picked (lit) so the menu clearly speaks about it; the info card stays as it is.
            const known = t && (shownMap.elements.some(e => e.id === t) || shownMap.relations.some(r => relationKey(r) === t) || shownMap.messages?.some(m => m.id === t))
            if (known) s.select(t)
            setMenu({ target: known ? t : undefined, at })
          }}
          rightInset={inspector ? (wideInsp ? 584 : 364) : 0}
        />
        {inspector
          ? <Inspector map={shownMap} readOnly={Boolean(s.preview)} onHide={() => setInspector(false)} wide={wideInsp} onToggleWide={toggleWide} onFrame={frameSoon} onCode={f => showCode(true, f)} />
          : <button className="btn sm insp-open" onClick={() => setInspector(true)}><Eye size={13} /> 정보 <kbd>i</kbd></button>}
        {s.explore && <div className="stage-hint muted">탐색 모드 · e로 끄기</div>}
        {menu && <ContextMenu at={menu.at} entries={menuEntries(menu.target, menu.at)} onClose={() => setMenu(undefined)} />}
        {asking && (
          <FloatAt at={asking.at} onClose={() => setAsking(undefined)} width={340} sticky className="ctx-ask">
            <div className="ctx-ask-head">
              <MessageSquare size={13} />
              <span className="grow ellipsis">{asking.target ? `${labelOf(shownMap, asking.target)}에 대해 묻기` : '지도 전체에 대해 묻기'}</span>
              <button className="iconbtn" title="닫기 (esc)" onClick={() => setAsking(undefined)}><X size={13} /></button>
            </div>
            <Ask target={asking.target} autoFocus placeholder="묻거나 고칠 점 적기" onSent={() => { setAsking(undefined); toast('보냈어') }} />
          </FloatAt>
        )}
        </div>
        {codeOpen && <CodePane key={stageKey} map={shownMap} want={codeWant} slide={codeSlide.current} onClose={() => showCode(false)} />}
      </div>
    </div>
  )
}

function ExportMenu({ map, stage, name }: { map: CanvasMap; stage: React.RefObject<StageHandle | null>; name: string }) {
  const toast = useApp(s => s.toast)
  const select = useCanvas(s => s.select)
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={ref} className="iconbtn" title="내보내기" onClick={() => setOpen(o => !o)}><Share size={14} /></button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} align="end" width={260}>
          <button className="menu-item" onClick={() => { void navigator.clipboard.writeText('```mermaid\n' + exportMermaid(map) + '\n```'); toast('Mermaid 코드를 복사했어'); setOpen(false) }}>
            <Copy size={14} /><span className="grow">Mermaid로 복사</span>
          </button>
          <button className="menu-item" onClick={async () => {
            // Export the clean drawing: no selection focus, no badges.
            select(undefined)
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
            const svg = stage.current?.svg()
            if (!svg) return
            download(`${name}.svg`, standaloneSvg(svg, map.title))
            toast(`${name}.svg로 저장했어`)
            setOpen(false)
          }}>
            <ImageDown size={14} /><span className="grow">SVG로 저장</span>
          </button>
        </Popover>
      )}
    </>
  )
}

function NewMapInline() {
  const create = useCanvas(s => s.create)
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={ref} className="btn" onClick={() => setOpen(o => !o)}><Plus size={14} /> 빈 지도</button>
      {open && <Popover anchor={ref.current} onClose={() => setOpen(false)} width={300}><NewMapForm onDone={async (n, d, t) => { await create(n, d, t); setOpen(false) }} /></Popover>}
    </>
  )
}


/** What the map's code holds against the map, one click from the review that lists it. */
function CodeChip({ marks }: { marks?: ReturnType<typeof codeMarks> }) {
  const bound = useReview(r => r.bound), diff = useReview(r => r.diff), loading = useReview(r => r.loading), oneTurn = useReview(r => r.source.kind === 'turn')
  const mapName = useCanvas(c => c.mapName), hasCode = useCanvas(c => Boolean(c.code)), preview = useCanvas(c => Boolean(c.preview))
  if (mapName && !hasCode && !preview) {
    return <button className="chip code-chip" title="리뷰가 이 지도의 코드를 보여 주게 연결해" onClick={() => void bindMapCode(false)}><FolderGit2 size={13} /> 코드 연결</button>
  }
  if (!bound || bound.map !== mapName) return null
  const all = [...(marks?.marks.values() ?? [])]
  const pending = all.filter(m => m.state === 'pending').length
  const unplanned = all.filter(m => m.state === 'unplanned').length
  const parts = !diff ? [loading ? '불러오는 중' : '코드 없음'] : [
    ...(oneTurn ? ['한 턴만'] : []),
    `바뀐 파일 ${diff.files.length}`,
    pending ? `구현 전 ${pending}` : '',
    unplanned ? `계획 밖 ${unplanned}` : '',
    marks?.outside ? `지도 밖 ${marks.outside}` : '',
  ].filter(Boolean)
  return (
    <button className="chip code-chip" title={`${bound.code.root}\n이 지도의 코드: 리뷰에서 같은 파일을 볼 수 있어`} onClick={() => useApp.getState().setTab('review')}>
      <FolderGit2 size={13} /> {parts.join(' · ')}
    </button>
  )
}

/** Binds the open map to the code it points at (the repo holding most of its files, from when it was made); `pick` then lets the person choose other code in the review. */
async function bindMapCode(pick: boolean) {
  const workspace = useApp.getState().workspace?.path
  const { mapName, map } = useCanvas.getState()
  if (!workspace || !mapName || !map) return
  try {
    await api.post(`/api/canvas/${mapName}/code`, { ws: workspace, guess: true })
    await useCanvas.getState().reload()
    const c = useCanvas.getState()
    if (c.code) await useReview.getState().bind({ map: mapName, title: map.title, code: c.code })
    if (pick) { useApp.getState().setTab('review'); useReview.getState().editCode() }
  } catch (e) { useApp.getState().toast((e as Error).message, 'error') }
}

/** A map from before maps knew their code: asked once which code it is about. */
function CodePrompt() {
  const workspace = useApp(a => a.workspace?.path)
  const { mapName, code, map, preview } = useCanvas()
  const key = workspace && mapName ? `canvas.codeAsked:${workspace}:${mapName}` : undefined
  const [asked, setAsked] = useState<string | null>(null)
  useEffect(() => { setAsked(key ? local.get(key) : null) }, [key])
  if (!workspace || !mapName || !map || code || preview || asked) return null
  const later = () => { if (key) { local.set(key, '1'); setAsked('1') } }
  const bind = (pick: boolean) => void bindMapCode(pick)
  return (
    <div className="unseen-banner code-prompt fade-in">
      <FolderGit2 size={14} />
      <span>이 지도는 아직 코드와 연결돼 있지 않아. 연결하면 리뷰가 이 지도의 코드를 보여 주고, 상자마다 구현됐는지 보여.</span>
      <span className="grow" />
      <button className="btn sm primary" title="지도의 파일이 가장 많은 저장소를, 지도를 만든 때의 커밋부터 지금까지" onClick={() => bind(false)}>지도가 가리키는 코드에 연결</button>
      <button className="btn sm" onClick={() => bind(true)}>PR·브랜치·커밋 고르기</button>
      <button className="btn sm ghost" onClick={later}>나중에</button>
    </div>
  )
}
