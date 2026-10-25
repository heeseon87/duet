import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileDiff, ListTree, Loader2, Minus, Plus, X } from 'lucide-react'
import { fileOfRef, filesUnder, labelOf, relationKey, type CanvasMap } from '../../../shared/canvas.ts'
import { absoluteRef } from '../../../shared/mapFiles.ts'
import type { DiffResult } from '../../../shared/protocol.ts'
import { api, q } from '../api.ts'
import { Line, useTokens } from '../lib/Code.tsx'
import { local, useApp } from '../state.ts'
import { useReview } from '../review/store.ts'
import { PathLabel } from '../review/DiffView.tsx'
import { escapeRe, matchRanges, registry } from '../review/FindBar.tsx'
import { widestCols } from '../review/diffModel.ts'
import { useCanvas } from './store.ts'
import { activeAt, outlineOf, type OutlineItem, type SymbolKind } from './outline.ts'

const MIN_WIDTH = 320
/** What the canvas keeps beside the pane, however wide the pane was dragged. */
const STAGE_MIN = 360
const MIN_SCALE = 0.7
const MAX_SCALE = 2
/** Below this width the structure floats over the code instead of standing beside it. */
const OUTLINE_BESIDE = 480
const WORD_CHAR = /[\p{L}\p{N}_$]/u
const isWord = (s: string) => /^[\p{L}\p{N}_$]+$/u.test(s)

/** The file references a part stands for: a box's own (with their lines), a package's everything inside, a line's or a message's two ends'. */
export function codeRefsOf(map: CanvasMap, target: string): string[] {
  const own = (id: string) => map.elements.find(e => e.id === id)?.files ?? []
  const el = map.elements.find(e => e.id === target)
  if (el) return el.kind === 'group' ? filesUnder(map, target) : own(target)
  const ends = map.relations.find(r => relationKey(r) === target) ?? map.messages?.find(m => m.id === target)
  return ends ? [...new Set([...own(ends.from ?? ''), ...own(ends.to ?? '')])] : []
}

/** `path:12` or `path:12-30`: the lines a reference points at. */
function linesOf(ref: string): [number, number] | undefined {
  const m = /:(\d+)(?:-(\d+))?$/.exec(ref)
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : undefined
}

/** The line declaring the part (`class Store`, `interface Store`, `CREATE TABLE store`…), by its id or a label that is a name. */
function declarationOf(lines: string[], names: string[]): number | undefined {
  const ok = names.filter(n => /^[A-Za-z_$][\w$]*$/.test(n))
  if (!ok.length) return undefined
  const re = new RegExp(`\\b(?:class|interface|protocol|actor|enum|object|record|struct|trait|type|table)\\s+[\`"']?(?:${ok.join('|')})\\b`, 'i')
  const i = lines.findIndex(l => re.test(l))
  return i >= 0 ? i + 1 : undefined
}

type Source = { root: string; path: string; ref: string; marks: boolean }

/**
 * Where to read a file: in the code the review shows for this map (at that version, its changed lines marked) when the
 * map is bound and the file is in it, else as it is on disk in the review's tree or the workspace.
 */
function sourceOf(abs: string, workspace: string, mapName: string | undefined, review: { root?: string; diff?: DiffResult; bound?: { map: string }; editing: boolean }): Source | undefined {
  const { root, diff, bound, editing } = review
  const mine = Boolean(bound && bound.map === mapName && !editing && diff && root)
  for (const r of [root, workspace]) {
    if (!r || !abs.startsWith(r + '/')) continue
    const path = abs.slice(r.length + 1)
    return mine && r === root ? { root: r, path, ref: diff!.newRef, marks: true } : { root: r, path, ref: 'WORKTREE', marks: false }
  }
  return undefined
}

/**
 * The code of the part picked on the canvas, beside the map. It follows the picks (a decision or the empty canvas keeps
 * what it shows), opens on the part's declaration or its referenced lines, and marks the lines the map's code changed.
 */
/** `slide`: opened just now by the person (not a reload or a map switch), so it slides in beside the gliding map. */
export function CodePane({ map, want, slide, onClose }: { map: CanvasMap; want?: { file: string; nonce: number }; slide?: boolean; onClose: () => void }) {
  const workspace = useApp(s => s.workspace?.path ?? '')
  const setTab = useApp(s => s.setTab)
  const [slideIn] = useState(slide)
  const selected = useCanvas(s => s.selected)
  const mapName = useCanvas(s => s.mapName)
  const diff = useReview(s => s.diff), root = useReview(s => s.root), bound = useReview(s => s.bound), editing = useReview(s => s.editing)
  const openFile = useReview(s => s.openFile)
  const isPart = (id: string | undefined) => Boolean(id && (map.elements.some(e => e.id === id) || map.relations.some(r => relationKey(r) === id) || map.messages?.some(m => m.id === id)))
  const [picked, setPicked] = useState<string>()
  const [pick, setPick] = useState<string>()
  // Only a new pick moves the pane: an edit of the map keeps the file tab the person chose.
  useEffect(() => {
    if (isPart(selected)) { setPicked(selected); setPick(undefined) }
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (want) setPick(want.file) }, [want])
  // A part the agent has since removed is no longer shown.
  const target = isPart(picked) ? picked : undefined

  const refs = useMemo(() => (target ? codeRefsOf(map, target) : []), [map, target])
  const ref = refs.find(r => r === pick) ?? refs.find(r => fileOfRef(r) === fileOfRef(pick ?? '')) ?? refs[0]
  const source = ref ? sourceOf(absoluteRef(workspace, ref), workspace, mapName, { root, diff, bound, editing }) : undefined
  const key = source ? `${source.root}\0${source.ref}\0${source.path}` : ''

  // A quick run of picks: only the answer for the file shown now is kept.
  const [file, setFile] = useState<{ key: string; text?: string; missing?: boolean }>()
  useEffect(() => {
    if (!source) return
    let live = true
    setFile({ key })
    api.get<{ exists: boolean; text: string }>(`/api/git/file${q({ ws: source.root, ref: source.ref, path: source.path })}`)
      .then(r => { if (live) setFile({ key, text: r.text, missing: !r.exists }) })
      .catch(() => { if (live) setFile({ key, missing: true }) })
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const text = file?.key === key ? file.text : undefined
  const lines = useMemo(() => (text ?? '').replace(/\n$/, '').split('\n'), [text])
  const tokens = useTokens(text ?? '', source?.path)

  const el = target ? map.elements.find(e => e.id === target) : undefined
  const span = ref ? linesOf(ref) : undefined
  const decl = useMemo(() => (text === undefined || span || !el ? undefined : declarationOf(lines, [el.id, el.label ?? ''])), [text, lines, span, el])
  const [from, to] = span ?? (decl ? [decl, decl] : [0, -1])
  const changed = useMemo(() => {
    const f = source?.marks && diff ? diff.files.find(x => x.path === source.path) : undefined
    return new Set(f && !f.binary && !f.large ? f.hunks.flatMap(h => h.lines.filter(l => l.type === 'add' && l.newNo).map(l => l.newNo!)) : [])
  }, [source?.marks, source?.path, diff])

  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (text === undefined) return
    requestAnimationFrame(() => {
      const row = body.current?.querySelector(`[data-line="${from}"]`)
      if (row) row.scrollIntoView({ block: 'center' })
      else body.current?.scrollTo({ top: 0 })
    })
  }, [text, from])

  const marks = useWordMarks(body, key, tokens)
  const [outlineOpen, setOutlineOpen] = useState(() => local.get('canvas.codeOutline') === '1')
  const toggleOutline = () => setOutlineOpen(o => { local.set('canvas.codeOutline', o ? '0' : '1'); return !o })
  const outline = useMemo(() => (outlineOpen && text !== undefined && source ? outlineOf(lines, source.path) : undefined), [outlineOpen, text, lines, source?.path]) // eslint-disable-line react-hooks/exhaustive-deps
  const active = outline && marks.caret !== undefined ? activeAt(outline, marks.caret) : undefined

  const width = useWidth()
  const zoom = useZoom(width.pane, body)
  const floating = width.value < OUTLINE_BESIDE
  // A pick in the structure goes to its line and marks its name, as a click on the name would.
  const goTo = (it: OutlineItem) => {
    body.current?.querySelector(`[data-line="${it.line}"]`)?.scrollIntoView({ block: 'center' })
    marks.setCaret(it.line)
    marks.setWord(isWord(it.name) ? { text: it.name, whole: true } : undefined)
    if (floating) setOutlineOpen(false)
  }
  const head = target ? labelOf(map, target) : undefined
  return (
    <aside className={`code-pane ${slideIn ? 'slide' : ''}`} ref={width.pane} style={{ width: width.value, '--code-scale': zoom.scale } as React.CSSProperties}>
      <div className="code-split" onPointerDown={width.drag} title="끌어서 폭 조절" />
      <div className="code-pane-head">
        <b className="grow ellipsis">{head ?? '코드'}</b>
        <button className="iconbtn" aria-pressed={outlineOpen} title={outlineOpen ? '구조 닫기' : '구조: 이 파일의 클래스·함수 목록'} onClick={toggleOutline}><ListTree size={14} /></button>
        <div className="seg code-zoom">
          <button onClick={() => zoom.step(-1)} disabled={zoom.scale <= MIN_SCALE} title="코드 축소 (⌘ + 휠)"><Minus size={12} /></button>
          <button onClick={() => zoom.set(1)} title="100%로">{Math.round(zoom.scale * 100)}%</button>
          <button onClick={() => zoom.step(1)} disabled={zoom.scale >= MAX_SCALE} title="코드 확대 (⌘ + 휠)"><Plus size={12} /></button>
        </div>
        {source && (
          <button className="iconbtn" title="리뷰에서 보기" onClick={() => { setTab('review'); void openFile(fileOfRef(ref!), from > 0 ? from : undefined) }}><FileDiff size={14} /></button>
        )}
        <button className="iconbtn" title="닫기 (c)" onClick={onClose}><X size={14} /></button>
      </div>
      {refs.length > 1 && (
        <div className="code-tabs">
          {refs.map(r => (
            <button key={r} aria-selected={r === ref} title={r} onClick={() => setPick(r)}>{fileOfRef(r).split('/').pop()}</button>
          ))}
        </div>
      )}
      {!target ? <div className="code-pane-empty muted">지도에서 상자를 누르면 그 코드가 여기 보여.</div>
        : !ref ? <div className="code-pane-empty muted">«{head}»에는 연결된 파일이 없어.</div>
        : !source ? <div className="code-pane-empty muted">{fileOfRef(ref)}은 작업 공간 밖에 있어서 여기서 열 수 없어.</div>
        : (
          <>
            <div className="code-pane-path">
              <PathLabel path={source.path} />
              <span className="muted">{source.ref === 'WORKTREE' ? 'Working tree' : source.ref.slice(0, 7)}{text !== undefined && ` · ${lines.length}줄`}{changed.size > 0 && ` · 바뀐 줄 ${changed.size}`}
                {marks.word && marks.hits > 0 && <> · <code>{marks.word.text.length > 24 ? `${marks.word.text.slice(0, 23)}…` : marks.word.text}</code> {marks.hits > 2000 ? '2000+' : marks.hits}곳</>}
              </span>
            </div>
            <div className="code-pane-view">
            {outlineOpen && text !== undefined && <Outline items={outline} active={active} floating={floating} onPick={goTo} />}
            <div className="code-pane-body" ref={body}>
              {file?.key !== key || (text === undefined && !file.missing) ? <div className="code-pane-empty"><Loader2 className="spin" size={16} /></div>
                : file.missing ? <div className="code-pane-empty muted">{source.ref === 'WORKTREE' ? '작업 트리' : source.ref.slice(0, 7)}에 이 파일이 없어. 아직 구현 전일 수 있어.</div>
                : (
                  <table className="diff unified hl" style={{ width: `max(100%, calc(${widestCols(lines)}ch + 90px))` }}>
                    <colgroup><col className="c-no" /><col /></colgroup>
                    <tbody>
                      {lines.map((l, i) => {
                        const no = i + 1
                        return (
                          <tr key={no} data-line={no} className={`line ctx${no >= from && no <= to ? ' target' : ''}${changed.has(no) ? ' changed' : ''}${marks.caret === no ? ' cursor-line' : ''}`}>
                            <td className="no">{no}</td>
                            <td className="code"><Line tokens={tokens[i]} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
            </div>
            </div>
          </>
        )}
    </aside>
  )
}

/** Each kind's badge, its color group and what the tooltip calls it. */
const BADGE: Record<SymbolKind, [string, string, string]> = {
  namespace: ['N', 'type', '네임스페이스'], class: ['C', 'type', '클래스'], struct: ['S', 'type', '구조체'], interface: ['I', 'type', '인터페이스'],
  enum: ['E', 'type', 'enum'], object: ['O', 'type', 'object'], extension: ['X', 'type', '확장'],
  type: ['T', 'type', '타입'], table: ['T', 'type', '표'], view: ['V', 'type', '뷰'],
  function: ['f', 'fn', '함수'], method: ['m', 'fn', '메서드'], constructor: ['m', 'fn', '생성자'],
  property: ['p', 'val', '필드'], param: ['c', 'ctor', '생성자 필드'], variable: ['v', 'val', '변수'], column: ['c', 'val', '열'], heading: ['#', 'doc', '제목'],
}

/** The file's declarations, nested; the one holding the caret line is marked and kept in view, and a pick leads to it. */
function Outline({ items, active, floating, onPick }: { items?: OutlineItem[]; active?: OutlineItem; floating: boolean; onPick: (it: OutlineItem) => void }) {
  const nav = useRef<HTMLElement>(null)
  useEffect(() => { nav.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active])
  return (
    <nav className={`code-outline${floating ? ' floating' : ''}`} ref={nav} aria-label="구조">
      {!items ? <div className="code-outline-empty muted">이 언어의 구조는 아직 못 읽어. Kotlin, Java, Swift, C#, C·C++, TS·JS, Python, SQL, 마크다운을 읽어.</div>
        : !items.length ? <div className="code-outline-empty muted">구조로 보여 줄 선언이 없어.</div>
        : items.map(it => {
          const [badge, group, label] = BADGE[it.kind]
          return (
            <button key={`${it.line}:${it.name}`} aria-current={it === active} style={{ paddingLeft: 8 + it.depth * 12 }} title={`${it.name} · ${label} · ${it.line}줄`} onClick={() => onPick(it)}>
              <i className={`ol-kind k-${group}`}>{badge}</i><span className="ellipsis">{it.name}</span>
            </button>
          )
        })}
    </nav>
  )
}

/**
 * The word under the click (or the text selected on one line) marked wherever it stands in the file, as an editor does;
 * the clicked line is the caret line. Painted with the CSS highlight API, so the rows are left as they are.
 */
function useWordMarks(body: React.RefObject<HTMLDivElement | null>, key: string, tokens: unknown) {
  const [word, setWord] = useState<{ text: string; whole: boolean }>()
  const [caret, setCaret] = useState<number>()
  const [hits, setHits] = useState(0)
  useEffect(() => { setWord(undefined); setCaret(undefined) }, [key])
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const read = () => {
      const sel = document.getSelection(), at = sel?.anchorNode
      if (!sel || !at || !body.current?.contains(at)) return
      const row = (at instanceof Element ? at : at.parentElement)?.closest<HTMLElement>('tr[data-line]')
      if (row) setCaret(Number(row.dataset.line))
      const next = sel.isCollapsed ? wordAt(at, sel.anchorOffset) : picked(sel.toString())
      setWord(w => (w?.text === next?.text && w?.whole === next?.whole ? w : next))
    }
    const change = () => { clearTimeout(t); t = setTimeout(read, 60) }
    document.addEventListener('selectionchange', change)
    return () => { document.removeEventListener('selectionchange', change); clearTimeout(t) }
  }, [body])
  // Colors arriving replace the rows' text nodes, so the marks are found again with them.
  useEffect(() => {
    const reg = registry(), b = body.current
    if (!reg) return
    if (!word || !b) { reg.highlights.delete('duet-word'); setHits(0); return }
    const esc = escapeRe(word.text)
    const ranges = matchRanges(b, new RegExp(word.whole ? `(?<![\\p{L}\\p{N}_$])${esc}(?![\\p{L}\\p{N}_$])` : esc, 'gu'))
    reg.highlights.set('duet-word', new reg.Highlight(...ranges))
    setHits(ranges.length)
  }, [word, tokens, body])
  useEffect(() => () => registry()?.highlights.delete('duet-word'), [])
  return { word, setWord, hits, caret, setCaret }
}

/** The word around a caret in a code cell. */
function wordAt(node: Node, offset: number): { text: string; whole: boolean } | undefined {
  const cell = node.parentElement?.closest('td.code')
  if (!cell || node.nodeType !== Node.TEXT_NODE) return undefined
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  let at = offset
  for (let n = walker.nextNode(); n && n !== node; n = walker.nextNode()) at += (n as Text).data.length
  const text = cell.textContent ?? ''
  let s = at, e = at
  while (s > 0 && WORD_CHAR.test(text[s - 1])) s--
  while (e < text.length && WORD_CHAR.test(text[e])) e++
  return e > s ? { text: text.slice(s, e), whole: true } : undefined
}

/** Text selected on one line: a word is matched whole, anything else as it is. */
function picked(s: string): { text: string; whole: boolean } | undefined {
  const text = s.trim()
  if (!text || text.length > 200 || text.includes('\n')) return undefined
  return { text, whole: isWord(text) }
}

/**
 * The code's own zoom, apart from the map's: the buttons step by 10%, ⌘ or ctrl + wheel over the pane (a trackpad
 * pinch) follows the hand; remembered. The line at the top of the view stays there as the text grows or shrinks.
 */
function useZoom(pane: React.RefObject<HTMLElement | null>, body: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = useState(() => Number(local.get('canvas.codeZoom')) || 1)
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const anchor = useRef<{ line: number; offset: number }>(undefined)
  const set = (next: number) => {
    const s = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)) * 100) / 100
    const b = body.current?.getBoundingClientRect()
    const row = b && document.elementFromPoint(b.left + 8, b.top + 1)?.closest<HTMLElement>('tr[data-line]')
    if (b && row) anchor.current = { line: Number(row.dataset.line), offset: row.getBoundingClientRect().top - b.top }
    setScale(s)
    local.set('canvas.codeZoom', String(s))
  }
  useLayoutEffect(() => {
    const a = anchor.current, b = body.current
    anchor.current = undefined
    const row = a && b?.querySelector(`tr[data-line="${a.line}"]`)
    if (a && b && row) b.scrollTop += row.getBoundingClientRect().top - b.getBoundingClientRect().top - a.offset
  }, [scale])
  useEffect(() => {
    const el = pane.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // A mouse notch is about one 10% step; a pinch sends many small ones.
      set(scaleRef.current * Math.exp(-Math.max(-10, Math.min(10, e.deltaY)) * 0.01))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return { scale, set, step: (d: 1 | -1) => set(Math.round(scale * 10) / 10 + d * 0.1) }
}

/**
 * The pane's width: dragged by its left edge and remembered. When the layout narrows (the agent panel opening, a smaller
 * window) the pane gives up room before the canvas does, and takes it back when the room returns.
 */
function useWidth() {
  const pane = useRef<HTMLElement>(null)
  const [wanted, setWanted] = useState(() => Number(local.get('canvas.codeWidth')) || 520)
  const [room, setRoom] = useState(Infinity)
  useLayoutEffect(() => {
    const host = pane.current?.parentElement
    if (!host) return
    const measure = () => setRoom(host.getBoundingClientRect().width)
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(host)
    return () => obs.disconnect()
  }, [])
  const fit = (w: number) => Math.round(Math.max(MIN_WIDTH, Math.min(w, room - STAGE_MIN)))
  const drag = (e: React.PointerEvent) => {
    const host = pane.current?.parentElement?.getBoundingClientRect()
    if (!host) return
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    let last = wanted
    const move = (m: PointerEvent) => { last = fit(host.right - m.clientX); setWanted(last) }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      local.set('canvas.codeWidth', String(last))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }
  return { pane, value: fit(wanted), drag }
}
