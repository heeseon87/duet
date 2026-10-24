import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileDiff, Loader2, Minus, Plus, X } from 'lucide-react'
import { fileOfRef, filesUnder, labelOf, relationKey, type CanvasMap } from '../../../shared/canvas.ts'
import { absoluteRef } from '../../../shared/mapFiles.ts'
import type { DiffResult } from '../../../shared/protocol.ts'
import { api, q } from '../api.ts'
import { Line, useTokens } from '../lib/Code.tsx'
import { local, useApp } from '../state.ts'
import { useReview } from '../review/store.ts'
import { PathLabel } from '../review/DiffView.tsx'
import { widestCols } from '../review/diffModel.ts'
import { useCanvas } from './store.ts'

const MIN_WIDTH = 320
/** What the canvas keeps beside the pane, however wide the pane was dragged. */
const STAGE_MIN = 360
const MIN_SCALE = 0.7
const MAX_SCALE = 2

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
  const re = new RegExp(`\\b(?:class|interface|enum|object|record|struct|trait|type|table)\\s+[\`"']?(?:${ok.join('|')})\\b`, 'i')
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
export function CodePane({ map, want, onClose }: { map: CanvasMap; want?: { file: string; nonce: number }; onClose: () => void }) {
  const workspace = useApp(s => s.workspace?.path ?? '')
  const setTab = useApp(s => s.setTab)
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

  const width = useWidth()
  const zoom = useZoom(width.pane, body)
  const head = target ? labelOf(map, target) : undefined
  return (
    <aside className="code-pane" ref={width.pane} style={{ width: width.value, '--code-scale': zoom.scale } as React.CSSProperties}>
      <div className="code-split" onPointerDown={width.drag} title="끌어서 폭 조절" />
      <div className="code-pane-head">
        <b className="grow ellipsis">{head ?? '코드'}</b>
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
              <span className="muted">{source.ref === 'WORKTREE' ? 'Working tree' : source.ref.slice(0, 7)}{text !== undefined && ` · ${lines.length}줄`}{changed.size > 0 && ` · 바뀐 줄 ${changed.size}`}</span>
            </div>
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
                          <tr key={no} data-line={no} className={`line ctx${no >= from && no <= to ? ' target' : ''}${changed.has(no) ? ' changed' : ''}`}>
                            <td className="no">{no}</td>
                            <td className="code"><Line tokens={tokens[i]} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
            </div>
          </>
        )}
    </aside>
  )
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
