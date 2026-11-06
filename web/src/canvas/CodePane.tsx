import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Columns2, Copy, Ellipsis, FileCode2, FileDiff, ListTree, Loader2, Minus, Palette, Pin as PinIcon, Plus, X } from 'lucide-react'
import { fileOfRef, labelOf, relationKey, type CanvasMap } from '../../../shared/canvas.ts'
import type { DiffFile } from '../../../shared/protocol.ts'
import { absoluteRef, refBase } from '../../../shared/mapFiles.ts'
import { api, q } from '../api.ts'
import { Line, useTokens } from '../lib/Code.tsx'
import { local, useApp } from '../state.ts'
import { repoFiles } from '../lib/files.ts'
import { Popover, useAnchor } from '../lib/ui.tsx'
import { useReview } from '../review/store.ts'
import { PathLabel } from '../review/DiffView.tsx'
import { escapeRe, matchRanges } from '../review/FindBar.tsx'
import { widestCols } from '../review/diffModel.ts'
import { setLivePosition, useCanvas } from './store.ts'
import { lastSeek, linesOf, linkAt, partsOfFile, pinSource, refsFor, resolveLink, sourceOf, targetOf, withNamedFiles, type PartLink, type ReviewSide, type Seek, type Source } from './codeLinks.ts'
import { MIN_WIDTH, isPart, layoutColumns, linkView, nextBlock, shown, type Doc, type Entry, type Pin } from './codeNav.ts'
import { ContextMenu, type MenuEntry, type Point } from './ContextMenu.tsx'
import { painter, type Painter } from './paint.ts'
import { activeAt, outlineOf, type OutlineItem, type SymbolKind } from './outline.ts'
import { VAR_COLORS, varLangOf, type Span, type VarMark } from './variables.ts'
import { variableMarks } from './variablesLoader.ts'

const MIN_SCALE = 0.7
const MAX_SCALE = 2
/** Below this width the structure floats over the code instead of standing beside it. */
const OUTLINE_BESIDE = 480
/** The structure's narrowest, and the room the code keeps beside it. */
const OUTLINE_MIN = 120
const CODE_MIN = 200
/** Its edge dragged left of this, the structure closes on release. */
const OUTLINE_HIDE = 60
const WORD_CHAR = /[\p{L}\p{N}_$]/u
const isWord = (s: string) => /^[\p{L}\p{N}_$]+$/u.test(s)

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
/** ⌘ on a Mac (ctrl-click is its right click there), ctrl elsewhere: held, a name in the code is a link. */
export const linkKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (MAC ? e.metaKey : e.ctrlKey)
export const LINK_KEY = MAC ? '⌘' : 'ctrl'
/** Back and forward in the live code column: ⌘[ ⌘] on a Mac, Alt+← Alt+→ elsewhere, as browsers and editors have them. */
export function navStep(e: KeyboardEvent, key: string): -1 | 1 | undefined {
  if (MAC ? !e.metaKey || e.altKey || e.ctrlKey : !e.altKey || e.metaKey || e.ctrlKey) return undefined
  if (key === (MAC ? '[' : 'ArrowLeft')) return -1
  if (key === (MAC ? ']' : 'ArrowRight')) return 1
  return undefined
}
export const NAV_KEYS = MAC ? ['⌘[', '⌘]'] : ['Alt+←', 'Alt+→']
/** Held with a click that moves the live column (on the map, or a link), it first pins what the column showed. */
export const PIN_KEY = MAC ? '⌥' : 'Alt'

/** `[` and `]`: the live column's top file goes to its previous or next block of changed lines. False when it shows none. */
let liveStep: ((dir: -1 | 1) => boolean) | undefined
export const stepChanged = (dir: -1 | 1) => liveStep?.(dir) ?? false

/** The word lit in every column: a click on a word, a selection on one line, or the name a move went to. */
type Word = { text: string; whole: boolean }
type SetWord = React.Dispatch<React.SetStateAction<Word | undefined>>

/** What every code column shares: the code's zoom, and whether the structure and the variable colors are on. Remembered. */
type Settings = {
  scale: number
  /** Each column keeps its top line in place across a zoom: it notes where it is when one starts. */
  anchors: Set<() => void>
  zoom: (next: number) => void
  outline: boolean
  toggleOutline: () => void
  closeOutline: () => void
  vars: boolean
  toggleVars: () => void
  /** A relation's or message's two ends side by side rather than one above the other. */
  side: boolean
  toggleSide: () => void
}
function useSettings(): Settings {
  const [scale, setScale] = useState(() => Number(local.get('canvas.codeZoom')) || 1)
  const [outline, setOutline] = useState(() => local.get('canvas.codeOutline') === '1')
  const [vars, setVars] = useState(() => local.get('canvas.codeVars') === '1')
  const [side, setSide] = useState(() => local.get('canvas.codePair') === 'side')
  const [anchors] = useState(() => new Set<() => void>())
  return {
    scale, anchors,
    zoom: next => {
      const s = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)) * 100) / 100
      for (const a of anchors) a()
      setScale(s)
      local.set('canvas.codeZoom', String(s))
    },
    outline,
    toggleOutline: () => setOutline(o => { local.set('canvas.codeOutline', o ? '0' : '1'); return !o }),
    closeOutline: () => { setOutline(false); local.set('canvas.codeOutline', '0') },
    vars,
    toggleVars: () => setVars(o => { local.set('canvas.codeVars', o ? '0' : '1'); return !o }),
    side,
    toggleSide: () => setSide(o => { local.set('canvas.codePair', o ? 'stack' : 'side'); return !o }),
  }
}

/** Several parts a name may stand for: the person picks one, then `go` follows it as a sure link would be. */
type Choice = { at: Point; name: string; links: PartLink[]; go: (link: PartLink) => void }

/**
 * The code beside the map. The live column shows the code of what the map has selected and follows every pick; a name
 * drawn on the map is a link in it (⌘-click goes to its declaration and its part), and back and forward retrace the way.
 * Pinned files stand to its left and never move; when the room runs out the oldest hide. A word clicked in any column
 * is lit in all of them. `slide`: opened just now by the person, so the column slides in beside the gliding map.
 */
export function CodeColumns({ map: drawn, slide, onPeek, onClose }: { map: CanvasMap; slide: boolean; onPeek: (target?: string) => void; onClose: () => void }) {
  const map = useNamedFiles(drawn)
  const entry = useCanvas(s => shown(s.trail))
  const pins = useCanvas(s => s.pins), resizePin = useCanvas(s => s.resizePin)
  const toast = useApp(s => s.toast)
  const live = entry && isPart(map, entry.view.target) ? entry : undefined
  const host = useRef<HTMLDivElement>(null)
  const room = useRoom(host)
  const settings = useSettings()
  // The live column's width as last left, kept apart for two ends side by side, which first take twice the room.
  const [wanted, setWanted] = useState(() => ({ stack: Number(local.get('canvas.codeWidth')) || 520, side: Number(local.get('canvas.codeWidthSide')) || 0 }))
  const mode = live?.view.docs.length === 2 && settings.side ? 'side' : 'stack'
  const want = live ? wanted[mode] || wanted.stack * 2 : undefined
  // A pin's width while its edge is dragged; the store gets it on release.
  const [draft, setDraft] = useState<{ id: string; width: number }>()
  const widths = (id?: string, w?: number) => pins.map(p => (p.id === id ? w! : p.id === draft?.id ? draft.width : p.width))
  const layout = layoutColumns(room, want, widths())
  const [word, setWord] = useState<Word>()
  const [choice, setChoice] = useState<Choice>()
  // Shown up on a pick after the columns were already there, the live column slides in.
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true }, [])
  const hiddenBefore = useRef(0)
  useEffect(() => {
    if (layout.hidden > hiddenBefore.current) toast('창이 좁아서 오래된 고정 칸을 숨겼어')
    hiddenBefore.current = layout.hidden
  }, [layout.hidden, toast])
  useBackButtons()
  const shownPins = pins.flatMap((pin, i) => (layout.pins[i] === undefined ? [] : [{ pin, i, width: layout.pins[i]! }]))
  return (
    <div className="code-columns" ref={host}>
      {shownPins.map(({ pin, i, width }, n) => (
        <PinColumn key={pin.id} map={map} pin={pin} width={width} settings={settings} word={word} onWord={setWord}
          hidden={!live && n === shownPins.length - 1 ? layout.hidden : 0} onPeek={onPeek} onChoose={setChoice}
          onWidth={(w, done) => {
            const asked = Math.max(MIN_WIDTH, Math.round(w))
            if (!done) return setDraft({ id: pin.id, width: asked })
            setDraft(undefined)
            resizePin(pin.id, layoutColumns(room, live ? want : undefined, widths(pin.id, asked)).pins[i] ?? asked)
          }} />
      ))}
      {live && layout.live !== undefined && (
        <LiveColumn map={map} entry={live} width={layout.live} settings={settings} word={word} onWord={setWord} hidden={layout.hidden} slide={slide || mounted.current}
          onWidth={(w, done) => {
            const fit = layoutColumns(room, w, []).live!
            setWanted(o => ({ ...o, [mode]: fit }))
            if (done) local.set(mode === 'side' ? 'canvas.codeWidthSide' : 'canvas.codeWidth', String(fit))
          }}
          onPeek={onPeek} onChoose={setChoice} onClose={onClose} />
      )}
      {choice && <ContextMenu at={choice.at} entries={chooserEntries(map, choice)} onClose={() => setChoice(undefined)} />}
    </div>
  )
}

/** The map as the code columns read it: a type box drawn without files opens the files named after it. */
function useNamedFiles(map: CanvasMap): CanvasMap {
  const codeRoot = useCanvas(s => s.code?.root), workspace = useApp(s => s.workspace?.path)
  const root = codeRoot ?? workspace
  const [list, setList] = useState<{ root: string; files: string[] }>()
  useEffect(() => {
    if (!root) return
    let live = true
    repoFiles(root).then(files => { if (live) setList({ root, files }) }, () => undefined)
    return () => { live = false }
  }, [root])
  return useMemo(() => (root && list?.root === root ? withNamedFiles(map, root, list.files) : map), [map, root, list])
}

/** The canvas body's width, which the columns and the map share. */
function useRoom(host: React.RefObject<HTMLElement | null>) {
  const [room, setRoom] = useState(Infinity)
  useLayoutEffect(() => {
    const body = host.current?.parentElement
    if (!body) return
    const measure = () => setRoom(body.getBoundingClientRect().width)
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(body)
    return () => obs.disconnect()
  }, [host])
  return room
}

/** The mouse's back and forward buttons over the code step the live column, and keep the browser from leaving Duet. */
function useBackButtons() {
  useEffect(() => {
    const on = (e: MouseEvent) => {
      if ((e.button !== 3 && e.button !== 4) || !(e.target as Element | null)?.closest?.('.code-pane')) return
      e.preventDefault()
      if (e.type !== 'mouseup') return
      if (e.button === 3) useCanvas.getState().back()
      else useCanvas.getState().forward()
    }
    for (const t of ['mousedown', 'mouseup', 'auxclick'] as const) window.addEventListener(t, on)
    return () => { for (const t of ['mousedown', 'mouseup', 'auxclick'] as const) window.removeEventListener(t, on) }
  }, [])
}

/** How a link reads to the person: a box's name, a member as `Box.name`, a message as its label. */
function linkLabel(map: CanvasMap, l: PartLink): string {
  if (l.target !== l.owner) return labelOf(map, l.target)
  return l.kind === 'type' ? labelOf(map, l.owner) : `${labelOf(map, l.owner)}.${l.name}${l.kind === 'function' ? '()' : ''}`
}

function chooserEntries(map: CanvasMap, c: Choice): MenuEntry[] {
  return [
    { kind: 'head', label: `어느 «${c.name}»?` },
    ...c.links.slice(0, 8).map((l, i): MenuEntry => ({
      kind: 'item', key: `${i}`, icon: <FileCode2 size={14} />, label: linkLabel(map, l), sub: refsFor(map, l.owner)[0]?.split('/').pop()?.replace(/:\d+(-\d+)?$/, ''), run: () => c.go(l),
    })),
  ]
}

/** Where a doc's file is read: the map's workspace, its own code, and what the review shows. */
type ReadContext = { workspace: string; mapName?: string; codeRoot?: string; base: string; review: ReviewSide }
function useReadContext(): ReadContext {
  const workspace = useApp(s => s.workspace?.path ?? '')
  const mapName = useCanvas(s => s.mapName), codeRoot = useCanvas(s => s.code?.root)
  const root = useReview(s => s.root), diff = useReview(s => s.diff), bound = useReview(s => s.bound), editing = useReview(s => s.editing)
  return { workspace, mapName, codeRoot, base: refBase(workspace, codeRoot), review: { root, diff, bound, editing } }
}

/** A doc's files, the one shown (the one picked, else the first), and where that one is read. */
type DocFile = { refs: string[]; ref?: string; source?: Source }
function resolveDoc(map: CanvasMap, doc: Doc, c: ReadContext): DocFile {
  const refs = refsFor(map, doc.part, doc.seek)
  const ref = refs.find(r => r === doc.ref) ?? refs.find(r => fileOfRef(r) === fileOfRef(doc.ref ?? '')) ?? refs[0]
  return { refs, ref, source: ref ? sourceOf(absoluteRef(c.base, ref), c.workspace, c.mapName, c.review, c.codeRoot) : undefined }
}

/** The file as the map's code changed it: its new lines are marked, and it is marked viewed as in the review. */
function useChanged(source?: Source): { changedFile?: DiffFile; changed: Set<number> } {
  const diff = useReview(s => s.diff)
  const changedFile = useMemo(() => (source?.marks && diff ? diff.files.find(x => x.path === source.path) : undefined), [source?.marks, source?.path, diff])
  const changed = useMemo(() => {
    const f = changedFile
    return new Set(f && !f.binary && !f.large ? f.hunks.flatMap(h => h.lines.filter(l => l.type === 'add' && l.newNo).map(l => l.newNo!)) : [])
  }, [changedFile])
  return { changedFile, changed }
}

/** `+n` and Viewed for a file the map's code changed. `+n` steps through its blocks of changed lines (⇧: back). */
function ChangedMarks({ changedFile, changed, onStep }: ReturnType<typeof useChanged> & { onStep?: (dir: -1 | 1) => void }) {
  const viewed = useReview(s => Boolean(changedFile && s.viewed[changedFile.path])), toggleViewed = useReview(s => s.toggleViewed)
  return <>
    {changed.size > 0 && (
      <button className="code-added" title={`더해지거나 바뀐 줄 ${changed.size}개 · 누르면 다음 묶음으로 (]), ⇧ 누르고 누르면 이전 ([)`} onClick={e => onStep?.(e.shiftKey ? -1 : 1)}>+{changed.size}</button>
    )}
    {changedFile && <label className="toggle" title="리뷰의 Viewed"><input type="checkbox" checked={viewed} onChange={() => toggleViewed(changedFile)} /> Viewed</label>}
  </>
}

/** What the live column knows of each doc it shows, for the store (where the reader is, to go back or pin) and its own menu. */
type DocSpot = { top?: () => number | undefined; target?: number; file?: { root: string; path: string }; step?: (dir: -1 | 1) => boolean }

/** Dragging a column's left edge sets its width: as it moves, then `done` on release. */
function edgeDrag(pane: React.RefObject<HTMLElement | null>, width: number, onWidth: (w: number, done: boolean) => void) {
  return (e: React.PointerEvent) => {
    const right = pane.current?.getBoundingClientRect().right
    if (right === undefined) return
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    let last = width
    const move = (m: PointerEvent) => { last = right - m.clientX; onWidth(last, false) }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      onWidth(last, true)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }
}

/** Pins that did not fit: the person learns why a column went. */
const HiddenPins = ({ n }: { n: number }) => <span className="code-hidden" title="창을 넓히거나 코드 칸을 좁히면 다시 보여">고정 {n}개 숨김</span>

/** A file kept beside the live column. It never follows; its links do move the live column, as any link does. */
function PinColumn({ map, pin, width, settings, word, onWord, hidden, onWidth, onPeek, onChoose }: {
  map: CanvasMap; pin: Pin; width: number; settings: Settings; word?: Word; onWord: SetWord; hidden: number
  onWidth: (w: number, done: boolean) => void; onPeek: (target?: string) => void; onChoose: (c: Choice) => void
}) {
  const unpin = useCanvas(s => s.unpin)
  const { mapName, review } = useReadContext()
  const source = pinSource(pin, mapName, review)
  const changed = useChanged(source)
  const pane = useRef<HTMLElement>(null)
  const spot = useRef<DocSpot>({})
  useWheelZoom(pane, settings)
  return (
    <aside className="code-pane pinned" ref={pane} style={{ width, '--code-scale': settings.scale } as React.CSSProperties}>
      <div className="code-split" onPointerDown={edgeDrag(pane, width, onWidth)} title="끌어서 폭 조절" />
      <div className="code-pane-head">
        <PinIcon size={13} className="code-pin-mark" aria-hidden />
        <b className="ellipsis" title={pin.path}>{pin.label}</b>
        <ChangedMarks {...changed} onStep={d => spot.current.step?.(d)} />
        <span className="grow" />
        {hidden > 0 && <HiddenPins n={hidden} />}
        <button className="iconbtn" aria-label="고정 풀기" title="고정 풀기" onClick={() => unpin(pin.id)}><X size={14} /></button>
      </div>
      <CodeDoc map={map} file={{ refs: [], ref: pin.path, source }} label={pin.label} nonce={0} at={pin.line} lead={false} width={width}
        settings={settings} word={word} onWord={onWord} spot={spot.current} onPeek={onPeek} onChoose={onChoose} />
    </aside>
  )
}

function LiveColumn({ map, entry, width, settings, word, onWord, hidden, slide, onWidth, onPeek, onChoose, onClose }: {
  map: CanvasMap; entry: Entry; width: number; settings: Settings; word?: Word; onWord: SetWord; hidden: number; slide: boolean
  onWidth: (w: number, done: boolean) => void; onPeek: (target?: string) => void; onChoose: (c: Choice) => void; onClose: () => void
}) {
  const setTab = useApp(s => s.setTab), toast = useApp(s => s.toast), openFile = useReview(s => s.openFile)
  const back = useCanvas(s => s.back), forward = useCanvas(s => s.forward), pin = useCanvas(s => s.pin)
  const canBack = useCanvas(s => s.trail.entries.slice(0, s.trail.index).some(e => isPart(map, e.view.target)))
  const canForward = useCanvas(s => s.trail.entries.slice(s.trail.index + 1).some(e => isPart(map, e.view.target)))
  const more = useAnchor()
  const [slideIn] = useState(slide)
  const pane = useRef<HTMLElement>(null)
  useWheelZoom(pane, settings)
  const read = useReadContext()
  const docs = entry.view.docs
  const files = docs.map(d => resolveDoc(map, d, read))
  const spots = useRef<DocSpot[]>([{}, {}])
  const count = useRef(docs.length)
  count.current = docs.length
  useEffect(() => {
    setLivePosition(() => spots.current.slice(0, count.current).map(s => ({ line: s.top?.() ?? 1, file: s.file })))
    liveStep = dir => spots.current[0].step?.(dir) ?? false
    return () => { setLivePosition(() => undefined); liveStep = undefined }
  }, [])
  const solo = docs.length === 1
  const side = !solo && settings.side
  const soloChanged = useChanged(solo ? files[0].source : undefined)
  // A relation's two ends: the code its via names is the evidence for the line.
  const via = map.relations.find(r => relationKey(r) === entry.view.target)?.via
  const head = labelOf(map, entry.view.target)
  const pinTitle = `고정: 이 파일을 옆 칸에 남기기 (${PIN_KEY} + 클릭으로 옮기면서도)`
  return (
    <aside className={`code-pane live${slideIn ? ' slide' : ''}`} ref={pane} style={{ width, '--code-scale': settings.scale } as React.CSSProperties}>
      <div className="code-split" onPointerDown={edgeDrag(pane, width, onWidth)} title="끌어서 폭 조절" />
      <div className="code-pane-head">
        <button className="iconbtn code-nav" disabled={!canBack} aria-label="뒤로" title={`뒤로 (${NAV_KEYS[0]})`} onClick={back}><ChevronLeft size={14} /></button>
        <button className="iconbtn code-nav" disabled={!canForward} aria-label="앞으로" title={`앞으로 (${NAV_KEYS[1]})`} onClick={forward}><ChevronRight size={14} /></button>
        <b className="ellipsis">{head}</b>
        {solo && <ChangedMarks {...soloChanged} onStep={d => spots.current[0].step?.(d)} />}
        <span className="grow" />
        {hidden > 0 && <HiddenPins n={hidden} />}
        {solo && files[0].source && <button className="iconbtn" aria-label="고정" title={pinTitle} onClick={() => pin()}><PinIcon size={14} /></button>}
        {!solo && <button className="iconbtn" aria-pressed={side} aria-label="나란히 보기" title={side ? '위아래로 보기' : '나란히 보기: 두 끝을 옆으로 나눠서'} onClick={settings.toggleSide}><Columns2 size={14} /></button>}
        <button className="iconbtn" aria-pressed={settings.outline} title={settings.outline ? '구조 닫기' : '구조: 이 파일의 클래스·함수 목록'} onClick={settings.toggleOutline}><ListTree size={14} /></button>
        {files.some(f => varLangOf(f.source?.path)) && (
          <button className="iconbtn" aria-pressed={settings.vars} title={settings.vars ? '변수 색 끄기' : '변수 색: 변수마다 선언부터 쓰는 곳까지 한 색으로, 스코프별로'} onClick={settings.toggleVars}><Palette size={14} /></button>
        )}
        <button ref={more.ref} className="iconbtn" aria-pressed={more.open} aria-label="더 보기: 글자 크기, 경로 복사, 리뷰에서 보기" title="더 보기: 글자 크기, 경로 복사, 리뷰에서 보기" onClick={more.toggle}><Ellipsis size={14} /></button>
        <button className="iconbtn" title="닫기 (c)" onClick={onClose}><X size={14} /></button>
      </div>
      {more.open && (
        <Popover anchor={more.ref.current} onClose={more.close} align="end" width={230} className="code-more">
          <div className="code-more-row">
            <span className="grow">글자 크기</span>
            <div className="seg code-zoom">
              <button onClick={() => settings.zoom(Math.round(settings.scale * 10) / 10 - 0.1)} disabled={settings.scale <= MIN_SCALE} title="코드 축소 (⌘ + 휠)"><Minus size={12} /></button>
              <button onClick={() => settings.zoom(1)} title="100%로">{Math.round(settings.scale * 100)}%</button>
              <button onClick={() => settings.zoom(Math.round(settings.scale * 10) / 10 + 0.1)} disabled={settings.scale >= MAX_SCALE} title="코드 확대 (⌘ + 휠)"><Plus size={12} /></button>
            </div>
          </div>
          {files.map(({ ref, source }, i) => source && ref && (
            <div key={i}>
              <div className="menu-sep" />
              {!solo && <div className="menu-label">{source.path.split('/').pop()}</div>}
              <button className="menu-item" onClick={() => { void navigator.clipboard.writeText(source.path); toast('경로를 복사했어'); more.close() }}><Copy size={14} /> 경로 복사</button>
              <button className="menu-item" title="리뷰에서 보기" onClick={() => { more.close(); setTab('review'); void openFile(fileOfRef(ref), spots.current[i].target) }}><FileDiff size={14} /> 리뷰에서 보기</button>
            </div>
          ))}
        </Popover>
      )}
      <div className={`code-docs${side ? ' side' : ''}`}>
        {docs.map((doc, i) => (
          <CodeDoc key={i} map={map} file={files[i]} seek={doc.seek} label={labelOf(map, doc.part)} nonce={entry.nonce} at={entry.at?.[i]} lead={i === 0} width={side ? width / 2 : width}
            settings={settings} word={word} onWord={onWord} spot={spots.current[i]} onTab={r => useCanvas.getState().showFile(i, r)} onPeek={onPeek} onChoose={onChoose}
            head={solo ? undefined : <DocHead label={labelOf(map, doc.part)} source={files[i].source} via={i === 0 ? via : undefined} onPin={files[i].source && (() => pin(i))} pinTitle={pinTitle} onStep={d => spots.current[i].step?.(d)} />} />
        ))}
      </div>
    </aside>
  )
}

/** One end of a pair: its part, how its file stands in the review, and for the `from` end the relation's evidence. */
function DocHead({ label, source, via, onPin, pinTitle, onStep }: {
  label: string; source?: Source; via?: string; onPin?: () => void; pinTitle: string; onStep: (dir: -1 | 1) => void
}) {
  const changed = useChanged(source)
  return (
    <div className="code-doc-head">
      <b>{label}</b>
      <ChangedMarks {...changed} onStep={onStep} />
      {via && <span className="code-via" title="이 선을 그린 근거(via): 그 코드가 표시된 줄">근거: {via}</span>}
      {onPin && <button className="iconbtn" aria-label="고정" title={pinTitle} onClick={onPin}><PinIcon size={13} /></button>}
    </div>
  )
}

/** ⌘ or ctrl + wheel over a column (a trackpad pinch) zooms the code, following the hand. */
function useWheelZoom(pane: React.RefObject<HTMLElement | null>, settings: Settings) {
  const latest = useRef(settings)
  latest.current = settings
  useEffect(() => {
    const el = pane.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // A mouse notch is about one 10% step; a pinch sends many small ones.
      latest.current.zoom(latest.current.scale * Math.exp(-Math.max(-10, Math.min(10, e.deltaY)) * 0.01))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [pane])
}

/** A file's text, fetched for its source; a quick run of picks keeps only the answer for the file shown now. */
function useFileText(source?: Source) {
  const key = source ? `${source.root}\0${source.ref}\0${source.path}` : ''
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
  const mine = file?.key === key
  return { key, text: mine ? file.text : undefined, missing: Boolean(mine && file.missing), loading: !mine || (file.text === undefined && !file.missing) }
}

/** The first row in view and how far its top sits above the view's top. */
function readTop(b: HTMLElement): { line: number; offset: number } | undefined {
  const first = b.querySelector<HTMLElement>('tr[data-line]')
  const h = first?.getBoundingClientRect().height
  if (!first || !h) return undefined
  const top = first.getBoundingClientRect().top - b.getBoundingClientRect().top
  const i = Math.max(0, Math.floor(-top / h))
  return { line: i + 1, offset: top + i * h }
}

/**
 * One file of a column: it opens where its view says (a declaration, a reference's lines, or where the reader left it),
 * marks the lines the map's code changed, reads like an editor, and makes the names the map draws links.
 */
function CodeDoc({ map, file: { refs, ref, source }, seek, label, nonce, at, lead, width, settings, word, onWord, spot, head, onTab, onPeek, onChoose }: {
  map: CanvasMap; file: DocFile; seek?: Seek; label: string; nonce: number; at?: number; lead: boolean; width: number; settings: Settings
  word?: Word; onWord: SetWord; spot?: DocSpot; head?: React.ReactNode; onTab?: (ref: string) => void; onPeek: (target?: string) => void; onChoose: (c: Choice) => void
}) {
  const { base } = useReadContext()
  const { key, text, missing, loading } = useFileText(source)
  const lines = useMemo(() => (text ?? '').replace(/\n$/, '').split('\n'), [text])
  const tokens = useTokens(text ?? '', source?.path)
  const seekKey = JSON.stringify(seek)
  const target = useMemo(() => (text === undefined || !ref || !source ? undefined : targetOf(lines, source.path, ref, seek)), [text, lines, ref, source?.path, seekKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [from, to] = target?.rows ?? (ref ? linesOf(ref) : undefined) ?? [0, -1]
  const { changed } = useChanged(source)

  const root = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [paint] = useState(painter)
  useEffect(() => () => paint.clear(), [paint])
  const marks = useWordMarks(body, key, tokens, paint, word, onWord)
  if (spot) {
    spot.top = () => (body.current ? readTop(body.current)?.line : undefined)
    spot.target = from > 0 ? from : undefined
    spot.file = source && { root: source.root, path: source.path }
    // From the line clicked, else from the top in view; the block's first line becomes the line clicked.
    spot.step = dir => {
      const b = body.current
      const to = nextBlock([...changed], marks.caret ?? (b ? (readTop(b)?.line ?? 1) - 1 : 0), dir)
      if (!to) return false
      marks.setCaret(to)
      b?.querySelector(`tr[data-line="${to}"]`)?.scrollIntoView({ block: 'center' })
      return true
    }
  }

  // Arrived (a pick, a link, back or forward): to where the reader left it, else the target in the middle, else the top.
  useEffect(() => {
    if (text === undefined) return
    requestAnimationFrame(() => {
      const b = body.current, row = (n?: number) => (n ? b?.querySelector<HTMLElement>(`tr[data-line="${n}"]`) : null)
      const left = row(at), aim = row(from)
      if (b && left) b.scrollTop += left.getBoundingClientRect().top - b.getBoundingClientRect().top
      else if (aim) aim.scrollIntoView({ block: 'center' })
      else b?.scrollTo({ top: 0 })
    })
  }, [text, from, nonce, at])
  // The name it went to is lit; the lead doc clears what the last place lit when it lights nothing.
  useEffect(() => {
    if (text === undefined) return
    if (target?.lit) onWord({ text: target.lit, whole: true })
    else if (lead) onWord(undefined)
  }, [text, nonce, seekKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Zooming keeps the line at the top where it is.
  const anchor = useRef<{ line: number; offset: number }>(undefined)
  useEffect(() => {
    const note = () => { anchor.current = body.current ? readTop(body.current) : undefined }
    settings.anchors.add(note)
    return () => { settings.anchors.delete(note) }
  }, [settings.anchors])
  useLayoutEffect(() => {
    const a = anchor.current, b = body.current
    anchor.current = undefined
    const row = a && b?.querySelector(`tr[data-line="${a.line}"]`)
    if (a && b && row) b.scrollTop += row.getBoundingClientRect().top - b.getBoundingClientRect().top - a.offset
  }, [settings.scale])

  const varsPainted = useVariableColors(body, text, source?.path, tokens, settings.vars, paint)
  const outline = useMemo(() => (settings.outline && text !== undefined && source ? outlineOf(lines, source.path) : undefined), [settings.outline, text, lines, source?.path]) // eslint-disable-line react-hooks/exhaustive-deps
  const active = outline && marks.caret !== undefined ? activeAt(outline, marks.caret) : undefined
  const floating = width < OUTLINE_BESIDE
  const outlineWidth = useOutlineWidth(width, floating, settings.closeOutline)
  // A pick in the structure goes to its line and marks its name, as a click on the name would.
  const pickOutline = (it: OutlineItem) => {
    body.current?.querySelector(`[data-line="${it.line}"]`)?.scrollIntoView({ block: 'center' })
    marks.setCaret(it.line)
    onWord(isWord(it.name) ? { text: it.name, whole: true } : undefined)
    if (floating) settings.closeOutline()
  }

  /**
   * Follows a link from this file. Its declaration in this very file is gone to here (on it already: the map only
   * shows its part); a message goes to its call's two ends.
   */
  const follow = (link: PartLink, row: number, keep: boolean) => {
    const goTo = useCanvas.getState().goTo
    if (link.target === link.owner && source && text !== undefined) {
      const seek = linkView(map, link).docs[0].seek
      const here = refsFor(map, link.owner, seek).find(r => absoluteRef(base, r) === `${source.root}/${source.path}`)
      const found = here ? targetOf(lines, source.path, here, seek) : undefined
      if (here && found?.rows && !found.missed) return goTo(link, found.rows[0] === row ? { stay: true } : { ref: here, keep })
    }
    goTo(link, { keep })
  }
  const here = useMemo(() => (source ? partsOfFile(map, source, base) : []), [map, source?.root, source?.path, base]) // eslint-disable-line react-hooks/exhaustive-deps
  const hint = useLinks(root, body, {
    map, here, paint, onPeek,
    onFollow: (found, name, row, p, keep) => (found.sure ? follow(found.links[0], row, keep) : onChoose({ at: p, name, links: found.links, go: l => follow(l, row, keep) })),
  })

  return (
    <div className="code-doc" ref={root}>
      {head}
      {refs.length > 1 && (
        <div className="code-tabs">
          {refs.map(r => (
            <button key={r} aria-selected={r === ref} title={r} onClick={() => onTab?.(r)}>{fileOfRef(r).split('/').pop()}</button>
          ))}
        </div>
      )}
      {!ref ? <div className="code-pane-empty muted">«{label}»에는 연결된 파일이 없어.</div>
        : !source ? <div className="code-pane-empty muted">{fileOfRef(ref)}은 작업 공간 밖에 있어서 여기서 열 수 없어.</div>
        : (
          <>
            <div className="code-pane-path">
              <PathLabel path={source.path} />
              <span className="muted">{source.ref === 'WORKTREE' ? 'Working tree' : source.ref.slice(0, 7)}{text !== undefined && ` · ${lines.length}줄`}
                {word && marks.hits > 0 && <> · <code>{word.text.length > 24 ? `${word.text.slice(0, 23)}…` : word.text}</code> {marks.hits > 2000 ? '2000+' : marks.hits}곳</>}
              </span>
              {target?.missed && <span className="code-missed">«{target.missed}» {seek && 'mention' in lastSeek(seek) ? '쓰는 곳을' : '선언을'} 이 파일에서 못 찾았어{refs.length > 1 ? ' · 탭의 다른 파일도 봐' : ''}</span>}
              <span className="code-link-hint" ref={hint} />
            </div>
            <div className="code-pane-view">
            {settings.outline && text !== undefined && !outlineWidth.hiding && <Outline items={outline} active={active} floating={floating} width={outlineWidth.value} onPick={pickOutline} />}
            {settings.outline && text !== undefined && (
              <div className="code-outline-split" style={{ left: outlineWidth.hiding ? 0 : outlineWidth.value }} onPointerDown={outlineWidth.drag} title="끌어서 구조 폭 조절, 왼쪽 끝까지 끌면 닫기" />
            )}
            <div className={`code-pane-body${varsPainted ? ' vars-on' : ''}`} ref={body}>
              {loading ? <div className="code-pane-empty"><Loader2 className="spin" size={16} /></div>
                : missing ? <div className="code-pane-empty muted">{source.ref === 'WORKTREE' ? '작업 트리' : source.ref.slice(0, 7)}에 이 파일이 없어. 아직 구현 전일 수 있어.</div>
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
    </div>
  )
}

type Found = ReturnType<typeof resolveLink>
type Hit = { name: string; receiver?: string; range: Range; row: number }

/**
 * Names drawn on the map, as links. Under the pointer a name gets a dotted underline and the path line says where it
 * leads; with ⌘ (ctrl) held it is a solid link, its part lights on the map, and a click follows it. Nothing is
 * decorated ahead and no row re-renders: one range is painted per pointer frame. Returns the hint's element ref.
 */
function useLinks(root: React.RefObject<HTMLElement | null>, body: React.RefObject<HTMLElement | null>, o: {
  map: CanvasMap; here: string[]; paint: Painter; onPeek: (target?: string) => void; onFollow: (found: Found, name: string, row: number, at: Point, keep: boolean) => void
}) {
  const hint = useRef<HTMLSpanElement>(null)
  const latest = useRef(o)
  latest.current = o
  useEffect(() => {
    const el = root.current
    if (!el) return
    const { paint } = latest.current
    let frame = 0, point: Point | undefined, held = false, peeked: string | undefined
    const linkUnder = (x: number, y: number): (Hit & { found: Found }) | undefined => {
      const b = body.current, n = b ? nameAt(b, x, y) : undefined
      const found = n && resolveLink(latest.current.map, { name: n.name, receiver: n.receiver, here: latest.current.here })
      return n && found?.links.length ? { ...n, found } : undefined
    }
    const show = () => {
      frame = 0
      const hit = point && linkUnder(point.x, point.y)
      paint.set('duet-link', hit && held ? [hit.range] : [])
      paint.set('duet-link-hint', hit && !held ? [hit.range] : [])
      body.current?.classList.toggle('link-armed', Boolean(hit && held))
      const map = latest.current.map
      const text = !hit ? '' : hit.found.sure ? `${LINK_KEY} 클릭 → ${linkLabel(map, hit.found.links[0])}` : `${LINK_KEY} 클릭 → «${hit.name}» ${hit.found.links.length}곳 중 고르기`
      if (hint.current && hint.current.textContent !== text) hint.current.textContent = text
      const peek = hit && held && hit.found.sure ? hit.found.links[0].target : undefined
      if (peek !== peeked) { peeked = peek; latest.current.onPeek(peek) }
    }
    const soon = () => { frame ||= requestAnimationFrame(show) }
    const move = (e: PointerEvent) => { point = { x: e.clientX, y: e.clientY }; held = linkKey(e); soon() }
    const leave = () => { point = undefined; soon() }
    const key = (e: KeyboardEvent) => { if (linkKey(e) !== held) { held = linkKey(e); soon() } }
    const blur = () => { held = false; soon() }
    // Held, the press on a link neither moves the caret nor marks the word: the click goes on to the declaration.
    const down = (e: MouseEvent) => { if (e.button === 0 && linkKey(e) && linkUnder(e.clientX, e.clientY)) e.preventDefault() }
    const click = (e: MouseEvent) => {
      if (e.button !== 0 || !linkKey(e)) return
      const hit = linkUnder(e.clientX, e.clientY)
      if (!hit) return
      e.preventDefault()
      latest.current.onFollow(hit.found, hit.name, hit.row, { x: e.clientX, y: e.clientY }, e.altKey)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('mousedown', down)
    el.addEventListener('click', click)
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    window.addEventListener('blur', blur)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('mousedown', down)
      el.removeEventListener('click', click)
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
      window.removeEventListener('blur', blur)
      paint.set('duet-link', [])
      paint.set('duet-link-hint', [])
      if (peeked) latest.current.onPeek(undefined)
    }
  }, [root, body])
  return hint
}

/** A code cell's text nodes, each with the column it starts at. */
function textNodes(cell: Element): [Text, number][] {
  const out: [Text, number][] = []
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  let at = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { out.push([n as Text, at]); at += (n as Text).data.length }
  return out
}

function rangeOf(nodes: [Text, number][], s: number, e: number): Range | undefined {
  const start = nodes.find(([n, at]) => s >= at && s < at + n.data.length), end = nodes.find(([n, at]) => e > at && e <= at + n.data.length)
  if (!start || !end) return undefined
  const r = document.createRange()
  r.setStart(start[0], s - start[1])
  r.setEnd(end[0], e - end[1])
  return r
}

/** The name under a screen point in a code row, if the point is on its letters (not past the line's end). */
function nameAt(body: HTMLElement, x: number, y: number): Hit | undefined {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null }
  const pos = d.caretPositionFromPoint?.(x, y)
  const caret = pos ? { node: pos.offsetNode, offset: pos.offset } : (r => r && { node: r.startContainer, offset: r.startOffset })(d.caretRangeFromPoint?.(x, y) ?? null)
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE || !body.contains(caret.node)) return undefined
  const cell = caret.node.parentElement?.closest('td.code'), row = cell?.closest<HTMLElement>('tr[data-line]')
  if (!cell || !row) return undefined
  const nodes = textNodes(cell)
  const start = nodes.find(([n]) => n === caret.node)?.[1]
  if (start === undefined) return undefined
  const text = nodes.map(([n]) => n.data).join('')
  const on = (i: number) => {
    const b = i >= 0 && i < text.length ? rangeOf(nodes, i, i + 1)?.getBoundingClientRect() : undefined
    return Boolean(b && x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1)
  }
  const i = [start + caret.offset, start + caret.offset - 1].find(on)
  const found = i === undefined ? undefined : linkAt(text, i)
  if (!found || i === undefined) return undefined
  let s = i
  while (s > 0 && /[\w$]/.test(text[s - 1])) s--
  const range = rangeOf(nodes, s, s + found.name.length)
  return range ? { ...found, range, row: Number(row.dataset.line) } : undefined
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
function Outline({ items, active, floating, width, onPick }: { items?: OutlineItem[]; active?: OutlineItem; floating: boolean; width: number; onPick: (it: OutlineItem) => void }) {
  const nav = useRef<HTMLElement>(null)
  useEffect(() => { nav.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active])
  return (
    <nav className={`code-outline${floating ? ' floating' : ''}`} ref={nav} aria-label="구조" style={{ width }}>
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
 * the clicked line is the caret line. The word is every column's; the caret line is this file's. Painted with the CSS
 * highlight API, so the rows are left as they are.
 */
function useWordMarks(body: React.RefObject<HTMLDivElement | null>, key: string, tokens: unknown, paint: Painter, word: Word | undefined, setWord: SetWord) {
  const [caret, setCaret] = useState<number>()
  const [hits, setHits] = useState(0)
  useEffect(() => { setCaret(undefined) }, [key])
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
  }, [body, setWord])
  // Colors arriving replace the rows' text nodes, so the marks are found again with them.
  useEffect(() => {
    const b = body.current
    if (!word || !b) { paint.set('duet-word', []); setHits(0); return }
    const esc = escapeRe(word.text)
    const ranges = matchRanges(b, new RegExp(word.whole ? `(?<![\\p{L}\\p{N}_$])${esc}(?![\\p{L}\\p{N}_$])` : esc, 'gu'))
    paint.set('duet-word', ranges)
    setHits(ranges.length)
  }, [word, tokens, body, paint])
  return { hits, caret, setCaret }
}

/**
 * Variable colors: each variable keeps one color from its declaration to every use, scope by scope (variables.ts).
 * Painted with the CSS highlight API like the word marks, and found again when the colors replace the rows' text nodes.
 * True once painted: the rest of the code then goes gray (`vars-on`), so the variables' colors stand alone.
 */
function useVariableColors(body: React.RefObject<HTMLDivElement | null>, text: string | undefined, path: string | undefined, tokens: unknown, on: boolean, paint: Painter) {
  const [marks, setMarks] = useState<{ vars: VarMark[]; keywords: Span[] }>()
  useEffect(() => {
    setMarks(undefined)
    if (!on || text === undefined || !path || !varLangOf(path)) return
    let live = true
    variableMarks(text, path).then(m => { if (live) setMarks(m) }, () => {})
    return () => { live = false }
  }, [on, text, path])
  useEffect(() => {
    const b = body.current
    const ranges = marks?.vars.length && b ? varRanges(b, marks) : undefined
    for (const name of VAR_NAMES) paint.set(name, ranges?.get(name) ?? [])
  }, [marks, tokens, body, paint])
  return Boolean(on && marks?.vars.length)
}

/** Each mark as a range over its line's text nodes, by highlight name. */
function varRanges(b: HTMLElement, marks: { vars: VarMark[]; keywords: Span[] }): Map<string, Range[]> {
  // Keywords ride along as their own highlight.
  const all: (Span & { name: string })[] = [...marks.vars.map(m => ({ ...m, name: varHighlight(m.color, m.field) })), ...marks.keywords.map(k => ({ ...k, name: 'duet-kw' }))]
  const byLine = new Map<number, (Span & { name: string })[]>()
  for (const m of all) byLine.set(m.line, [...(byLine.get(m.line) ?? []), m])
  const ranges = new Map<string, Range[]>()
  for (const [line, ms] of byLine) {
    const cell = b.querySelector(`tr[data-line="${line + 1}"] > td.code`)
    if (!cell) continue
    // Each text node with the column it starts at; a column falls in the last node that starts at or before it.
    const nodes: [Text, number][] = []
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
    let at = 0
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push([n as Text, at]); at += (n as Text).data.length }
    const point = (col: number): [Text, number] | undefined => {
      for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i][1] <= col) return [nodes[i][0], Math.min(col - nodes[i][1], nodes[i][0].data.length)]
      return undefined
    }
    for (const m of ms) {
      const s = point(m.start), e = point(m.end)
      if (!s || !e) continue
      const r = document.createRange()
      r.setStart(...s)
      r.setEnd(...e)
      ranges.set(m.name, [...(ranges.get(m.name) ?? []), r])
    }
  }
  return ranges
}

/** A color's highlight; a class's property or field has its own, underlined, so it stands apart from a local of that color. */
const varHighlight = (color: number, field: boolean) => `duet-var-${color}${field ? '-f' : ''}`
const VAR_NAMES = [...Array.from({ length: VAR_COLORS }, (_, i) => [varHighlight(i, false), varHighlight(i, true)]).flat(), 'duet-kw']

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
 * The structure's width: dragged by its right edge and remembered, the code keeping room beside it (floating over the
 * code, it covers at most 80% of it). Dragged past its narrowest toward the left edge, it closes on release and opens
 * again at the width it had before that drag.
 */
function useOutlineWidth(pane: number, floating: boolean, close: () => void) {
  const [wanted, setWanted] = useState(() => Number(local.get('canvas.codeOutlineWidth')) || 0)
  const [hiding, setHiding] = useState(false)
  const fit = (w: number) => Math.round(Math.max(OUTLINE_MIN, Math.min(w, floating ? pane * 0.8 : pane - CODE_MIN)))
  // Never dragged: 30% of the pane within 150–260px, or 260px floating.
  const value = fit(wanted || (floating ? 260 : Math.min(260, Math.max(150, pane * 0.3))))
  const drag = (e: React.PointerEvent) => {
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    const x0 = e.clientX, from = value, before = wanted
    let last = from, gone = false
    const move = (m: PointerEvent) => {
      const raw = from + m.clientX - x0
      gone = raw < OUTLINE_HIDE
      setHiding(gone)
      if (!gone) { last = fit(raw); setWanted(last) }
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      setHiding(false)
      if (gone) { setWanted(before); close() } else local.set('canvas.codeOutlineWidth', String(last))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }
  return { value, hiding, drag }
}
