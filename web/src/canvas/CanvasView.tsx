import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ChevronsDownUp, ChevronsUpDown, Clock3, Copy, ListCollapse, ZoomIn, GitCompareArrows, Maximize2, MessageSquare, Plus, Shapes, Sparkles, Undo2, Workflow,
  Check, FileCode2, FileDiff, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, X, Bot, User, Trash2, Share, ImageDown, FolderGit2,
} from 'lucide-react'
import { arrowsOf, describeDiff, diffMaps, exportMermaid, filesUnder, labelOf, relationKey, type ArrowKind, type CanvasMap } from '../../../shared/canvas.ts'
import { codeMarks, refBase } from '../../../shared/mapFiles.ts'
import { api } from '../api.ts'
import { local, useApp } from '../state.ts'
import { Popover, isTypingTarget, relTime, shortcutKey } from '../lib/ui.tsx'
import { MermaidStage, partIds, type StageHandle } from './MermaidStage.tsx'
import { CodePane } from './CodePane.tsx'
import { FlowList } from './FlowList.tsx'
import { flowSteps, stepFrom } from './flow.ts'
import { ContextMenu, FloatAt, type MenuEntry, type Point } from './ContextMenu.tsx'
import { confirmDialog } from '../lib/confirm.tsx'
import { download, standaloneSvg } from './exportSvg.ts'
import { useCanvas } from './store.ts'
import { CHANGE_LABEL } from './words.ts'
import { useReview } from '../review/store.ts'
import { FloatComposer } from '../agent/FloatComposer.tsx'
import { Ask } from './DecisionParts.tsx'
import { DecisionMode } from './DecisionMode.tsx'
import { WorkChip, WorkspaceMenu } from '../WorkspaceMenu.tsx'

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

/** The head line with only the workspace in it: no map yet, or one still loading. */
function HeadLine() {
  return <div className="canvas-bar map-head"><div className="map-head-row"><span className="head-ws"><WorkspaceMenu /><WorkChip /></span></div></div>
}

const ARROW_LABEL: Record<ArrowKind, string> = {
  association: '연관', dependency: '의존', inheritance: '상속', realization: '실현', composition: '합성', aggregation: '집약',
  call: '호출', reply: '답', async: '비동기',
}

/** A short arrow drawn as the map draws its kind: solid or dashed, and its head (a diamond sits at the whole's end). */
function ArrowGlyph({ kind }: { kind: ArrowKind }) {
  const dashed = kind === 'dependency' || kind === 'realization' || kind === 'reply'
  const diamond = kind === 'composition' || kind === 'aggregation'
  const triangle = kind === 'inheritance' || kind === 'realization'
  const filled = kind === 'call' || kind === 'reply'
  return (
    <svg className="sw-arrow" width="28" height="10" viewBox="0 0 28 10" aria-hidden="true">
      <line x1={diamond ? 12 : 1} y1="5" x2={triangle ? 20 : 26} y2="5" strokeDasharray={dashed ? '3 2' : undefined} />
      {diamond && <polygon points="1,5 6.5,1.8 12,5 6.5,8.2" className={kind === 'composition' ? 'solid' : undefined} />}
      {triangle && <polygon points="20,1.2 26.8,5 20,8.8" />}
      {filled && <polygon points="21,1.8 27,5 21,8.2" className="solid" />}
      {!diamond && !triangle && !filled && <polyline points="21.5,1.5 26.5,5 21.5,8.5" />}
    </svg>
  )
}

/** What the map's colors and marks mean, over the map's top right corner: the states it uses, its kinds of arrow, open decisions, the agent's △. */
function Legend({ map, revised }: { map: CanvasMap; revised?: { revision: number; ids: string[] } }) {
  const used = new Set(map.elements.map(e => e.change ?? 'keep'))
  const items = (['add', 'modify', 'delete', 'result', 'keep'] as const).filter(c => used.has(c))
  const arrows = arrowsOf(map)
  const open = map.decisions?.some(d => !d.chosen)
  const rev = revised?.ids.length ? revised : undefined
  // The states as before: shown when there is more than one, or beside the decision and △ marks.
  const states = items.length > 1 || open || rev
  if (!states && !arrows.length) return null
  return (
    <div className="legend map-legend">
      {states && items.map(c => <span key={c} className="legend-item"><i className={`sw cv-sw-${c}`} />{CHANGE_LABEL[c]}</span>)}
      {arrows.map(k => <span key={k} className="legend-item" data-arrow={k}><ArrowGlyph kind={k} />{ARROW_LABEL[k]}</span>)}
      {open && <span className="legend-item"><i className="sw cv-sw-open" />결정 전</span>}
      {rev && (
        <span className="legend-item" title={`에이전트가 rev ${rev.revision}에서 더하거나 고친 상자 ${rev.ids.length}개. 그 뒤에 네가 고친 상자에서는 빠져.`}>
          <i className="sw-rev">{rev.revision}</i>에이전트가 rev {rev.revision}에서 고침
        </span>
      )}
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
  // The flow list's row under the pointer: its line is lit on the map.
  const [peek, setPeek] = useState<string>()
  const [asking, setAsking] = useState<{ target: string; at: Point }>()
  // The code pane beside the map; remembered.
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
    if (file) setCodeWant({ file, nonce: Date.now() })
  }

  useEffect(() => { if (workspace) void s.loadList() }, [workspace?.path]) // eslint-disable-line react-hooks/exhaustive-deps
  // Choices decision mode kept for Claude and could not tell (the tab closed first): told when their map opens again.
  useEffect(() => { if (s.mapName && !s.deciding) void s.flushDecisions(true) }, [s.mapName]) // eslint-disable-line react-hooks/exhaustive-deps
  // Another map, or an old revision shown: decision mode is about the map that was open.
  // Another map or an old revision closes decision mode; mounting does not (the rail's badge opens it from the review).
  const shownKey = `${s.mapName}:${Boolean(s.preview)}`
  const lastShown = useRef(shownKey)
  useEffect(() => {
    if (lastShown.current === shownKey) return
    lastShown.current = shownKey
    if (useCanvas.getState().deciding) s.setDeciding(false)
  }, [shownKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const shownMap = s.preview?.map ?? s.map
  // The same files the review lists, matched to the parts the same way: what is built, what is not yet.
  const bound = useReview(r => r.bound), editing = useReview(r => r.editing), diff = useReview(r => r.diff), root = useReview(r => r.root), home = useReview(r => r.home)
  const oneTurn = useReview(r => r.source.kind === 'turn'), viewed = useReview(r => r.viewed)
  const code = useMemo(
    () => (shownMap?.diagram === 'class' && bound && bound.map === s.mapName && !editing && diff && root && home ? codeMarks(shownMap, diff.files, root, refBase(home, s.code?.root), { pending: !oneTurn, viewed: new Set(Object.keys(viewed)) }) : undefined),
    [shownMap, bound, s.mapName, s.code, editing, diff, root, home, oneTurn, viewed],
  )
  const foldable = useMemo(() => {
    const parents = new Set((shownMap?.elements ?? []).map(e => e.parent).filter(Boolean))
    return (shownMap?.elements ?? []).filter(e => e.kind === 'group' && parents.has(e.id)).map(e => e.id)
  }, [shownMap])
  const hasGroups = shownMap?.diagram === 'class' && foldable.length > 0
  const allFolded = foldable.length > 0 && foldable.every(id => s.collapsed.has(id))
  const ghosts = useMemo(() => (s.compareMap && s.map && !s.preview ? diffMaps(s.compareMap, s.map) : undefined), [s.compareMap, s.map, s.preview])
  const changes = useMemo(() => (ghosts && s.map ? describeDiff(ghosts, s.map) : []), [ghosts, s.map])

  // The part the code pane shows: the last one picked on this map (an empty click or a decision keeps it). Until then,
  // or once the part is gone, the pane stays out of the way even while it is on.
  const isPart = (id: string | undefined) => Boolean(id && shownMap && (shownMap.elements.some(e => e.id === id) || shownMap.relations.some(r => relationKey(r) === id) || shownMap.messages?.some(m => m.id === id)))
  const mapKey = `${workspace?.path}:${s.mapName}`
  const [codePart, setCodePart] = useState<{ map: string; id: string }>()
  const codeTarget = codePart?.map === mapKey && isPart(codePart.id) ? codePart.id : undefined
  useEffect(() => {
    if (!isPart(s.selected)) return
    // Showing up on this pick, the pane slides in.
    if (!codeTarget && codeOpenRef.current) codeSlide.current = true
    setCodePart({ map: mapKey, id: s.selected! })
  }, [s.selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // A step of the flow (from its list or its keys) is picked like a click on its line, and brought to the middle at the
  // zoom the map is at.
  const pickStep = (key: string) => {
    s.select(key)
    const m = useCanvas.getState().preview?.map ?? useCanvas.getState().map
    if (m) requestAnimationFrame(() => stage.current?.center(partIds(m, key)))
  }
  const pickStepRef = useRef(pickStep)
  pickStepRef.current = pickStep

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (useApp.getState().tab !== 'canvas' || useCanvas.getState().deciding) return
      // A checkbox (the code pane's Viewed) keeps the keys.
      if (isTypingTarget(e.target)) return
      const k = shortcutKey(e)
      if (k === 'Escape') s.select(undefined)
      else if (k === 'f' && !e.metaKey) stage.current?.fit()
      else if ((k === '=' || k === '+') && !e.metaKey) stage.current?.zoom(1.2)
      else if (k === '-' && !e.metaKey) stage.current?.zoom(1 / 1.2)
      else if (k === 'c' && !e.metaKey && !e.ctrlKey) showCode(!codeOpenRef.current)
      else if ((k === 'n' || k === 'p') && !e.metaKey && !e.ctrlKey) {
        const st = useCanvas.getState()
        const m = st.preview?.map ?? st.map
        const to = m && stepFrom(flowSteps(m), st.selected, k === 'n' ? 1 : -1)
        if (!to) return
        pickStepRef.current(to)
      }
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
        <HeadLine />
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
  if (!shownMap) return <div className="canvas"><HeadLine /></div>

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
    const zoomTo = (ids: string[]): MenuEntry => ({ kind: 'item', key: 'zoom', icon: <ZoomIn size={14} />, label: 'Zoom to selection', run: () => frameSoon(ids) })
    if (el || rel || msg) {
      const t = target!
      const out: MenuEntry[] = [{ kind: 'head', label: labelOf(map, t), sub: el ? kindLabel(el.kind) : rel ? '관계선' : '메시지' }, ...ask(t)]
      // The code of this part (a package: everything in it), reviewed on its own.
      if (el && filesUnder(map, t).length) out.push({ kind: 'item', key: 'changes', icon: <FileDiff size={14} />, label: '이 부분의 변경 보기', run: () => { setTab('review'); void useReview.getState().showPart(map, t) } })
      // The review's Viewed, for all the changed files of this part at once.
      const mark = el ? code?.marks.get(t) : undefined
      if (mark?.paths.length && diff) {
        const all = mark.viewed === mark.paths.length, paths = new Set(mark.paths)
        out.push({
          kind: 'item', key: 'viewed', icon: <Check size={14} />, label: all ? 'Viewed 해제' : 'Viewed로 표시',
          sub: mark.viewed && !all ? `${mark.viewed}/${mark.paths.length}` : `파일 ${mark.paths.length}개`,
          run: () => useReview.getState().setViewed(diff.files.filter(f => paths.has(f.path)), !all),
        })
      }
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
      return out
    }
    return [
      { kind: 'head', label: map.title },
      { kind: 'item', key: 'fit', icon: <Maximize2 size={14} />, label: 'Zoom to fit', hint: 'f', run: () => stage.current?.fit() },
      ...(hasGroups ? [
        { kind: 'item', key: 'fold-all', icon: <ChevronsDownUp size={14} />, label: 'Collapse all', disabled: allFolded, run: () => s.setAllCollapsed(true) },
        { kind: 'item', key: 'unfold-all', icon: <ChevronsUpDown size={14} />, label: 'Expand all', disabled: !s.collapsed.size, run: () => s.setAllCollapsed(false) },
      ] satisfies MenuEntry[] : []),
      ...(canCompare ? [{ kind: 'item', key: 'compare', icon: <GitCompareArrows size={14} />, label: s.compareFrom ? '비교 끄기' : 'Compare with previous', run: () => void s.setCompare(s.compareFrom ? undefined : s.revision - 1) }] satisfies MenuEntry[] : []),
      ...ask(''),
      { kind: 'sep' },
      { kind: 'item', key: 'mermaid', icon: <Copy size={14} />, label: 'Mermaid로 복사', run: () => { void navigator.clipboard.writeText('```mermaid\n' + exportMermaid(map) + '\n```'); toast('Mermaid 코드를 복사했어') } },
    ]
  }
  return (
    <div className="canvas">
      <div className="canvas-bar map-head">
        <div className="map-head-row">
          <span className="head-ws"><WorkspaceMenu /><WorkChip /></span>
          <span className="head-sep" />
          <MapPicker />
          <div className="map-head-meta">
            <Timeline />
            {decisions.length > 0 && (
              <button className={`chip dec-chip ${made < decisions.length ? 'accent' : 'quiet'}`} disabled={Boolean(s.preview)} onClick={() => s.setDeciding(true)}
                title={s.preview ? `rev ${s.preview.revision}에서는 결정을 볼 수만 있어` : made < decisions.length ? `결정할 것 ${decisions.length - made}개 · 정한 결정 ${made}개 · 눌러서 하나씩 정하기` : '결정을 모두 정했어 · 눌러서 다시 보기'}>
                결정 {made}/{decisions.length}{made < decisions.length && <span className="dec-wait"> · 너를 기다림</span>}
              </button>
            )}
            <CodeChip marks={code} />
          </div>
          <span className="grow" />
          <div className="map-head-tools">
            {s.compareFrom && !s.preview && (
              <span className="compare-chip">
                <GitCompareArrows size={13} /> rev {s.compareFrom} → {s.revision} 비교 중 · {changes.length}곳
                <button className="iconbtn" onClick={() => void s.setCompare(undefined)}><X size={12} /></button>
              </span>
            )}
            {!s.compareFrom && s.revision > 1 && !s.preview && (
              <button className="iconbtn" onClick={() => void s.setCompare(s.revision - 1)} title="Compare with previous"><GitCompareArrows size={14} /></button>
            )}
            {hasGroups && (
              <div className="seg">
                <button onClick={() => s.setAllCollapsed(true)} title="Collapse all packages" disabled={allFolded}><ChevronsDownUp size={13} /></button>
                <button onClick={() => s.setAllCollapsed(false)} title="Expand all packages" disabled={!s.collapsed.size}><ChevronsUpDown size={13} /></button>
              </div>
            )}
            <ExportMenu map={shownMap} stage={stage} name={s.name ?? 'map'} />
            {s.name && <button className="iconbtn" title="지도 지우기" onClick={async () => { if (await confirmDialog({ title: '이 지도를 지울까?', body: '지도와 기록, 코멘트가 ~/.duet/trash로 옮겨져.', ok: '지우기', danger: true })) void s.remove(s.name!) }}><Trash2 size={14} /></button>}
          </div>
        </div>
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
          peek={peek}
          threads={s.threads}
          code={code?.marks}
          revised={s.preview ? undefined : s.revised}
          onSelect={t => s.select(t)}
          onToggleGroup={s.toggleCollapse}
          onContext={(t, at) => {
            // A known part is picked (lit) so the menu clearly speaks about it.
            const known = isPart(t)
            if (known) s.select(t)
            setMenu({ target: known ? t : undefined, at })
          }}
          controls={<>
            <span className="zoom-sep" />
            <button onClick={() => stage.current?.fit()} title="Zoom to fit (f)">맞춤 <kbd>f</kbd></button>
            <button aria-pressed={codeOpen} onClick={() => showCode(!codeOpen)} title={codeOpen ? '코드 칸 닫기 (c)' : '코드 칸: 누른 상자의 코드를 옆에서 보기 (c)'}>코드 <kbd>c</kbd></button>
          </>}
        />
        <FlowList map={shownMap} selected={s.selected} onPeek={setPeek} onPick={pickStep} />
        <Legend map={shownMap} revised={s.preview ? undefined : s.revised} />
        <FloatComposer />
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
        {codeOpen && codeTarget && <CodePane key={stageKey} map={shownMap} target={codeTarget} want={codeWant} slide={codeSlide.current} onClose={() => showCode(false)} />}
      </div>
      {s.deciding && s.map && !s.preview && <DecisionMode key={stageKey} map={s.map} stageKey={stageKey} onClose={() => s.setDeciding(false)} />}
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
