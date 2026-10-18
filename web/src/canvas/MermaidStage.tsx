import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, forwardRef } from 'react'
import { relationKey, shapedBy, toMermaid, type CanvasMap, type MapDiff } from '../../../shared/canvas.ts'
import type { CanvasThread } from '../../../shared/protocol.ts'
import { measure, morph, reducedMotion, type Morph } from './morph.ts'

type Mermaid = typeof import('mermaid').default
let mermaidP: Promise<Mermaid> | undefined
let renderSeq = 0

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

async function getMermaid(): Promise<Mermaid> {
  mermaidP ??= import('mermaid').then(m => m.default)
  return mermaidP
}

function themeVariables() {
  const dark = document.documentElement.dataset.theme === 'dark'
  return {
    darkMode: dark,
    fontFamily: cssVar('--font-ui'),
    fontSize: '13px',
    background: 'transparent',
    primaryColor: cssVar('--cv-keep-fill'),
    primaryBorderColor: cssVar('--cv-keep-line'),
    primaryTextColor: cssVar('--ink'),
    secondaryColor: cssVar('--panel-2'),
    tertiaryColor: cssVar('--panel'),
    lineColor: cssVar('--cv-edge'),
    textColor: cssVar('--ink-2'),
    mainBkg: cssVar('--cv-keep-fill'),
    nodeBorder: cssVar('--cv-keep-line'),
    clusterBkg: cssVar('--cv-group-fill'),
    clusterBorder: cssVar('--cv-group-line'),
    edgeLabelBackground: cssVar('--cv-label-bg'),
    // Sequence diagrams
    actorBkg: cssVar('--cv-keep-fill'),
    actorBorder: cssVar('--cv-keep-line'),
    actorTextColor: cssVar('--ink'),
    actorLineColor: cssVar('--line-strong'),
    signalColor: cssVar('--cv-edge'),
    signalTextColor: cssVar('--ink'),
    labelBoxBkgColor: cssVar('--panel'),
    labelBoxBorderColor: cssVar('--line-strong'),
    labelTextColor: cssVar('--ink-2'),
    loopTextColor: cssVar('--ink-2'),
    noteBkgColor: cssVar('--cv-note-fill'),
    noteBorderColor: cssVar('--cv-note-line'),
    noteTextColor: cssVar('--ink'),
  }
}

export type StageHandle = {
  fit: () => void
  zoom: (f: number) => void
  svg: () => SVGSVGElement | null
  /** Bring these parts (map ids or relation keys) to the middle of the screen; `afterRender` waits for the next drawing (a fold) to settle. */
  frame: (ids: string[], afterRender?: boolean) => void
}

type Props = {
  map: CanvasMap
  collapsed: Set<string>
  ghostsFrom?: MapDiff
  glow?: MapDiff
  selected?: string
  threads: CanvasThread[]
  onSelect: (target: string | undefined) => void
  onToggleGroup: (id: string) => void
  /** Right click on a part (or on empty canvas: undefined), at this screen point. */
  onContext?: (target: string | undefined, at: { x: number; y: number }) => void
  readOnly?: boolean
  /** Width covered on the right (the floating inspector): fitting centers in what is left. */
  rightInset?: number
}

type View = { x: number; y: number; k: number }
/** The camera on the map shown last: back from the review tab it is where it was; any other map opens fitted. */
let lastView: { key: string; view: View } | undefined

export const MermaidStage = forwardRef<StageHandle, Props & { viewKey: string }>(function MermaidStage(props, ref) {
  const { map, collapsed, ghostsFrom, glow, selected, threads, onSelect, onToggleGroup, onContext, viewKey } = props
  const inset = useRef(props.rightInset ?? 0)
  inset.current = props.rightInset ?? 0
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(() => (lastView?.key === viewKey ? lastView.view : { x: 40, y: 40, k: 1 }))
  const [error, setError] = useState<string | null>(null)
  const [themeTick, setThemeTick] = useState(0)
  const [gliding, setGliding] = useState(false)
  const glideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const glide = useCallback(() => {
    setGliding(true)
    clearTimeout(glideTimer.current)
    glideTimer.current = setTimeout(() => setGliding(false), 320)
  }, [])
  const fitted = useRef(lastView?.key === viewKey)
  const plan = useRef<ReturnType<typeof toMermaid> | null>(null)
  /** The latest selection/glow/threads, for decorating a drawing that finishes rendering later. */
  const latest = useRef({ selected, glow, threads, compare: ghostsFrom })
  latest.current = { selected, glow, threads, compare: ghostsFrom }
  const mapRef = useRef(map)
  mapRef.current = map
  /** Parts to frame once the drawing that is on its way has settled. */
  const pendingFrame = useRef<string[] | undefined>(undefined)

  useEffect(() => { lastView = { key: viewKey, view } }, [view, viewKey])
  const viewRef = useRef(view)
  viewRef.current = view
  /** What the last drawing showed, to tell a fold or unfold (animated) from any other redraw. */
  const shown = useRef<{ collapsed: Set<string>; shape: string; members: string } | undefined>(undefined)
  const running = useRef<Morph | undefined>(undefined)

  // Re-render when the theme flips: Mermaid bakes colors into the SVG.
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick(t => t + 1))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  /** Whole drawing on screen; `readable` keeps text legible and lets a tall drawing run off the bottom. */
  const fit = useCallback((readable = false) => {
    const svg = inner.current?.querySelector('svg')
    const full = outer.current?.getBoundingClientRect()
    if (!svg || !full) return
    const box = { width: Math.max(320, full.width - inset.current), height: full.height }
    const w = svg.viewBox.baseVal.width || svg.getBoundingClientRect().width
    const h = svg.viewBox.baseVal.height || svg.getBoundingClientRect().height
    let k = Math.min(1.25, Math.max(0.2, Math.min((box.width - 80) / w, (box.height - 80) / h)))
    // First look: legible text beats seeing everything; what runs over starts at the top left.
    if (readable) k = Math.max(k, 0.65)
    else glide()
    const x = w * k > box.width - 48 ? 24 : (box.width - w * k) / 2
    const y = h * k > box.height - 48 ? 24 : (box.height - h * k) / 2
    setView({ k, x, y })
  }, [])

  const zoom = useCallback((f: number, cx?: number, cy?: number) => {
    const box = outer.current?.getBoundingClientRect()
    if (!box) return
    // Buttons and keys zoom around the center and glide; the wheel follows the cursor at once.
    if (cx === undefined) glide()
    setView(v => {
      const k = Math.min(3, Math.max(0.15, v.k * f))
      const px = cx ?? box.width / 2, py = cy ?? box.height / 2
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k }
    })
  }, [glide])

  const frameNow = useCallback((ids: string[]) => {
    const host = outer.current
    const svg = inner.current?.querySelector<SVGSVGElement>(':scope > svg')
    if (!host || !svg) return
    // Measured against the drawing itself, so a glide still in progress does not throw it off.
    const s = svg.getBoundingClientRect()
    const ke = s.width / (Number(svg.getAttribute('width')) || s.width)
    const parentOf = new Map(mapRef.current.elements.map(e => [e.id, e.parent]))
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
    for (const id of ids) {
      // Inside a folded package: its box stands in.
      let els: SVGGraphicsElement[] = []
      for (let p: string | undefined = id; p && !els.length; p = parentOf.get(p)) els = [...svg.querySelectorAll<SVGGraphicsElement>(`[data-target="${CSS.escape(p)}"]:not(.cv-edge-hit)`)]
      // A sequence actor is drawn at the top and again at the bottom: take the one nearest the middle of the screen.
      if (els.length > 1 && els.every(e => e.classList.contains('cv-actor'))) {
        const h = host.getBoundingClientRect()
        const cy = h.top + h.height / 2
        const dist = (e: Element) => { const r = e.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - cy) }
        els = [els.reduce((a, b) => (dist(b) < dist(a) ? b : a))]
      }
      for (const el of els) {
        const rc = el.getBoundingClientRect()
        if (!rc.width && !rc.height) continue
        l = Math.min(l, (rc.left - s.left) / ke); t = Math.min(t, (rc.top - s.top) / ke)
        r = Math.max(r, (rc.right - s.left) / ke); b = Math.max(b, (rc.bottom - s.top) / ke)
      }
    }
    if (!Number.isFinite(l)) return
    const box = host.getBoundingClientRect()
    const aw = Math.max(320, box.width - inset.current), ah = box.height
    const w = Math.max(r - l, 40), h = Math.max(b - t, 30)
    const k = Math.min(1.25, Math.max(0.15, Math.min((aw - 120) / w, (ah - 120) / h)))
    glide()
    setView({ k, x: (aw - w * k) / 2 - l * k, y: (ah - h * k) / 2 - t * k })
  }, [glide])
  const frame = useCallback((ids: string[], afterRender = false) => {
    if (afterRender) pendingFrame.current = ids
    else frameNow(ids)
  }, [frameNow])

  useImperativeHandle(ref, () => ({ fit: () => fit(), zoom: f => zoom(f), svg: () => inner.current?.querySelector('svg') ?? null, frame }), [fit, zoom, frame])

  // Render the diagram, then wire its parts to the map's ids.
  useEffect(() => {
    let live = true
    const p = toMermaid(map, { collapsed, ghostsFrom })
    plan.current = p
    void (async () => {
      const mermaid = await getMermaid()
      // Mermaid measures text while drawing; with the web font still loading, labels get clipped.
      await document.fonts.ready
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: themeVariables(),
        class: { htmlLabels: true },
        sequence: { mirrorActors: true, showSequenceNumbers: false, messageFontWeight: 400 } as never,
        suppressErrorRendering: true,
        // Class maps: ELK with the map's order, so packages run left to right in the order the map
        // lists them (dagre ignores the order), and keep it when others fold. Boxes tied by lines
        // still go where the lines put them.
        ...(map.diagram === 'class' ? { layout: 'elk', elk: { forceNodeModelOrder: true, considerModelOrder: 'NODES_AND_EDGES' } } : { layout: 'dagre' }),
      } as never)
      const id = `cv${++renderSeq}`
      try {
        const { svg, bindFunctions } = await mermaid.render(id, p.text)
        if (!live || !inner.current) return
        // Only a fold or unfold on an unchanged map is animated; the agent's edits keep their glow.
        const parts = map.elements.map(e => `${e.id}>${e.parent ?? ''}`)
        const shape = parts.join('|') + `#${map.relations.length}`
        const members = [...parts].sort().join('|') + `#${map.relations.length}`
        const prev = shown.current
        const toggled = prev && prev.shape === shape && prev.collapsed !== collapsed ? [...new Set([...prev.collapsed, ...collapsed])].filter(g => prev.collapsed.has(g) !== collapsed.has(g)) : []
        // The same parts in a new order (moved left or right): the boxes slide to their new places too.
        const reordered = Boolean(prev && prev.shape !== shape && prev.members === members && prev.collapsed === collapsed)
        shown.current = { collapsed, shape, members }
        const oldSvg = inner.current.querySelector<SVGSVGElement>(':scope > svg')
        // Measured mid-animation if one is running, so a quick second click carries on from there.
        const before = (toggled.length || reordered) && oldSvg ? measure(oldSvg) : undefined
        running.current?.cancel()
        running.current = undefined
        inner.current.innerHTML = svg
        bindFunctions?.(inner.current)
        const el = inner.current.querySelector('svg')!
        const vb = el.viewBox.baseVal
        el.setAttribute('width', String(vb.width))
        el.setAttribute('height', String(vb.height))
        el.style.maxWidth = 'none'
        annotate(el, id, map, p)
        decorate(el, map, latest.current)
        flowZoom(el, Math.round(viewRef.current.k * 20) / 20)
        setError(null)
        if (!fitted.current) { fitted.current = true; requestAnimationFrame(() => fit(true)) }
        if (before && oldSvg) {
          try {
            let offset: { x: number; y: number } | undefined
            if (toggled.length === 1) {
              // The package that was folded or unfolded keeps its place on screen; the rest moves around it.
              const was = before.get(toggled[0])
              const now = el.querySelector(`[data-target="${CSS.escape(toggled[0])}"]:is(.cv-node, .cv-cluster)`)?.getBoundingClientRect()
              if (was && now) {
                offset = { x: was.left - now.left, y: was.top - now.top }
                const v = viewRef.current
                const next = { ...v, x: v.x + offset.x, y: v.y + offset.y }
                inner.current.style.transition = 'none'
                inner.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.k})`
                void inner.current.offsetWidth
                inner.current.style.transition = ''
                viewRef.current = next
                setView(next)
              }
            }
            if (!reducedMotion()) running.current = morph({ stage: inner.current, oldSvg, before, k: viewRef.current.k, map, offset })
            // Folding or unfolding everything changes the size a lot: frame it again (unless a part asked to be framed).
            if (toggled.length > 1 && !pendingFrame.current) fit()
          } catch {
            // Animation is a nicety: on any trouble the new drawing simply stays.
            running.current?.cancel()
            running.current = undefined
          }
        }
        const want = pendingFrame.current
        if (want) {
          pendingFrame.current = undefined
          // After the fold has slid into place, so the boxes are measured where they end up.
          setTimeout(() => { if (live) frameNow(want) }, running.current ? 480 : 0)
        }
      } catch (e) {
        document.getElementById(`d${id}`)?.remove()
        if (live) setError((e as Error).message.split('\n').slice(0, 3).join('\n'))
      }
    })()
    return () => { live = false }
  }, [map, collapsed, ghostsFrom, themeTick, fit, frameNow])

  // A selected part slides out from under the floating inspector (and back on screen).
  useEffect(() => {
    if (!selected) return
    const host = outer.current
    const el = host?.querySelector<SVGGraphicsElement>(`[data-target="${CSS.escape(selected)}"]:not(.cv-edge-hit)`)
    if (!host || !el) return
    const box = host.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const right = box.right - inset.current - 24, left = box.left + 24, top = box.top + 24, bottom = box.bottom - 24
    let dx = 0, dy = 0
    if (r.right > right) dx = right - r.right
    if (r.left + dx < left) dx = left - r.left
    if (r.bottom > bottom) dy = bottom - r.bottom
    if (r.top + dy < top) dy = top - r.top
    if (dx || dy) { glide(); setView(v => ({ ...v, x: v.x + dx, y: v.y + dy })) }
  }, [selected, glide])

  // Selection, glow and badges change often; they only touch classes.
  // Only when what it shows changes: panning and zooming must not touch every box's classes.
  const kStep = Math.round(view.k * 20) / 20
  useLayoutEffect(() => {
    const svg = inner.current?.querySelector('svg')
    if (!svg) return
    decorate(svg, map, { selected, glow, threads, compare: ghostsFrom })
    flowZoom(svg, kStep)
  }, [map, selected, glow, threads, ghostsFrom, kStep])

  // Wheel: zoom at the cursor. Shift + wheel, or a sideways swipe, pans; dragging pans too.
  useEffect(() => {
    const el = outer.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      // Firefox reports lines or pages; turn them into pixels like everyone else.
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1
      const dx = e.deltaX * unit, dy = e.deltaY * unit
      const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v))
      if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) { setView(v => ({ ...v, x: v.x - dx, y: e.shiftKey && !dx ? v.y - dy : v.y })); return }
      // A pinch (ctrlKey) sends many small steps; a mouse notch sends one big one.
      const f = e.ctrlKey || e.metaKey ? Math.exp(-clamp(dy, 50) * 0.01) : Math.exp(-clamp(dy, 100) * 0.002)
      zoom(f, e.clientX - box.left, e.clientY - box.top)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [zoom])

  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    // Control-click on a Mac is a right click: the menu, not a pick.
    if (e.button !== 0 || e.ctrlKey) return
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) { d.moved = true; outer.current?.setPointerCapture(e.pointerId) }
    setView(v => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    // Only the main button picks; a right click (or control-click) opens the menu instead.
    if (e.button !== 0 || e.ctrlKey) return
    const d = drag.current
    drag.current = null
    if (d?.moved) return
    // A click, not a drag: find what is under the pointer. A decision pin picks its decision.
    const at = document.elementFromPoint(e.clientX, e.clientY) as Element | null
    onSelect(at?.closest('[data-pin]')?.getAttribute('data-pin') ?? at?.closest('[data-target]')?.getAttribute('data-target') ?? undefined)
  }
  const onContextMenu = (e: React.MouseEvent) => {
    if (!onContext) return
    e.preventDefault()
    const hit = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-target]')
    onContext(hit?.getAttribute('data-target') ?? undefined, { x: e.clientX, y: e.clientY })
  }
  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('[data-pin]')) return
    const hit = (e.target as Element).closest('[data-group]')
    if (hit) onToggleGroup(hit.getAttribute('data-group')!)
    else fit()
  }

  return (
    <div
      className={`stage-canvas ${selected ? 'has-selection' : ''} ${gliding ? 'gliding' : ''}`}
      ref={outer}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div className="stage-inner" ref={inner} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }} />
      {error && <div className="stage-error"><b>그리기 실패</b><pre>{error}</pre></div>}
      <div className="zoom-readout">{Math.round(view.k * 100)}%</div>
    </div>
  )
})

/** Tag every drawn part with the map id it stands for. */
function annotate(svg: SVGSVGElement, id: string, map: CanvasMap, p: ReturnType<typeof toMermaid>) {
  const byId = new Map(map.elements.map(e => [e.id, e]))
  const prefix = `${id}-`
  // Mermaid names a nested namespace by its path ("Source.SourceMobile"); the map knows the last part.
  const resolve = (raw: string) => (byId.has(raw) ? raw : raw.split('.').pop() ?? raw)
  if (map.diagram === 'class') {
    for (const g of svg.querySelectorAll<SVGGElement>('g.node')) {
      const m = /-classId-(.+)-\d+$/.exec(g.id)
      if (!m) continue
      const tid = resolve(m[1])
      const el = byId.get(tid)
      g.setAttribute('data-target', tid)
      if (el?.kind === 'group') g.setAttribute('data-group', tid)
      g.classList.add('cv-node')
    }
    for (const g of svg.querySelectorAll<SVGGElement>('g.cluster')) {
      const gid = resolve(g.id.startsWith(prefix) ? g.id.slice(prefix.length) : g.id)
      g.setAttribute('data-target', gid)
      g.setAttribute('data-group', gid)
      g.classList.add('cv-cluster')
    }
    const paths = svg.querySelectorAll<SVGPathElement>('path[id*="-id_"]')
    for (const path of paths) {
      const m = /_(\d+)$/.exec(path.id)
      const keys = m ? p.edgeOrder[Number(m[1]) - 1] : undefined
      if (!keys) continue
      const key = keys.split(' ')[0]
      path.setAttribute('data-target', key)
      path.setAttribute('data-keys', keys)
      path.classList.add('cv-edge')
      // A wide invisible twin makes a 1px line easy to hit.
      const hit = path.cloneNode() as SVGPathElement
      hit.removeAttribute('id')
      hit.removeAttribute('marker-end')
      hit.removeAttribute('marker-start')
      hit.setAttribute('class', 'cv-edge-hit')
      hit.setAttribute('data-target', key)
      path.parentNode?.insertBefore(hit, path.nextSibling)
    }
    for (const label of svg.querySelectorAll<SVGGElement>('.edgeLabel g.label[data-id]')) {
      const m = /_(\d+)$/.exec(label.getAttribute('data-id') ?? '')
      const keys = m ? p.edgeOrder[Number(m[1]) - 1] : undefined
      if (!keys) continue
      const host = label.closest('.edgeLabel') as SVGGElement | null
      host?.setAttribute('data-target', keys.split(' ')[0])
      host?.setAttribute('data-keys', keys)
      host?.classList.add('cv-label')
    }
  } else {
    for (const g of svg.querySelectorAll('[data-et="participant"]')) {
      const pid = g.getAttribute('data-id')
      if (pid) { g.setAttribute('data-target', pid); g.classList.add('cv-actor') }
    }
    for (const g of svg.querySelectorAll('g.actor-man, .actor-bottom')) {
      const name = g.getAttribute('name')
      if (name) g.setAttribute('data-target', name)
    }
    const lines = [...svg.querySelectorAll('[data-et="message"]')]
    const texts = [...svg.querySelectorAll('text.messageText')]
    lines.forEach((l, i) => {
      const mid = p.messageOrder[i]
      if (!mid) return
      l.setAttribute('data-target', mid)
      l.classList.add('cv-msg')
      const t = texts[i]
      if (t) { t.setAttribute('data-target', mid); t.classList.add('cv-msg-text') }
      const hit = l.cloneNode() as SVGLineElement
      hit.setAttribute('class', 'cv-edge-hit')
      hit.removeAttribute('marker-end')
      l.parentNode?.insertBefore(hit, l.nextSibling)
    })
    const notes = [...svg.querySelectorAll('[data-et="note"]')]
    notes.forEach((n, i) => {
      const nid = p.noteOrder[i]
      if (nid && !nid.startsWith('frag:')) { n.setAttribute('data-target', nid); n.classList.add('cv-note') }
    })
  }
}

const CHANGE_CLASS = ['cv-add', 'cv-modify', 'cv-delete', 'cv-result', 'cv-keep', 'cv-ghost', 'cv-open', 'cv-sel', 'cv-in', 'cv-rel', 'cv-ctx', 'cv-dim', 'cv-glow', 'cv-glow-mod', 'cv-new', 'cv-changed']

/** The zoom, on the few lines that flow, so their width and dashes stay the same on screen, and on the decision pins. Set nowhere else: on an ancestor it would restyle the whole drawing at every zoom step. */
function flowZoom(svg: SVGSVGElement, k: number) {
  if (svg.getAttribute('data-k') !== String(k)) svg.setAttribute('data-k', String(k))
  for (const g of svg.querySelectorAll<SVGGElement>('.cv-pins')) pinZoom(g, k)
  for (const el of svg.querySelectorAll<SVGElement>('.cv-edge.cv-sel, .cv-edge.cv-rel, .cv-msg.cv-sel, .cv-msg.cv-rel')) {
    if (el.style.getPropertyValue('--k') !== String(k)) el.style.setProperty('--k', String(k))
  }
  for (const el of svg.querySelectorAll<SVGElement>('[style*="--k"]:not(.cv-sel):not(.cv-rel)')) el.style.removeProperty('--k')
}

type Inside = { added: number; changed: number; removed: number }

/**
 * What changed inside each package, counted for every package that holds it. A folded package
 * stands for everything in it, so a comparison (or the agent's fresh change) must mark it too.
 * Lines with both ends inside a package vanish when it folds: they count for that package.
 */
function insideChanges(map: CanvasMap, d: MapDiff | undefined): Map<string, Inside> {
  const out = new Map<string, Inside>()
  if (!d) return out
  const parentOf = new Map<string, string | undefined>(map.elements.map(e => [e.id, e.parent]))
  for (const [id, e] of d.removedElements) if (!parentOf.has(id)) parentOf.set(id, e.parent)
  const ancestors = (id: string) => { const s: string[] = []; for (let p = parentOf.get(id); p; p = parentOf.get(p)) s.push(p); return s }
  const bump = (groups: Iterable<string>, k: keyof Inside) => { for (const g of groups) { const s = out.get(g) ?? { added: 0, changed: 0, removed: 0 }; s[k]++; out.set(g, s) } }
  for (const id of d.addedElements) bump(ancestors(id), 'added')
  for (const id of d.changedElements) bump(ancestors(id), 'changed')
  for (const id of d.removedElements.keys()) bump(ancestors(id), 'removed')
  const holdingBoth = (from: string, to: string) => { const b = new Set(ancestors(to)); return ancestors(from).filter(g => b.has(g)) }
  const ends = (key: string) => /^(.*)->(.*):[^:]+$/.exec(key)
  for (const key of d.addedRelations) { const m = ends(key); if (m) bump(holdingBoth(m[1], m[2]), 'added') }
  for (const key of d.changedRelations) { const m = ends(key); if (m) bump(holdingBoth(m[1], m[2]), 'changed') }
  for (const r of d.removedRelations.values()) bump(holdingBoth(r.from, r.to), 'removed')
  return out
}

/** "+2 ~1 −1" in the corner of a folded package that hides changes. */
function insideBadge(node: SVGGraphicsElement, s: Inside | undefined, b: DOMRect) {
  const text = s ? [s.added && `+${s.added}`, s.changed && `~${s.changed}`, s.removed && `−${s.removed}`].filter(Boolean).join(' ') : ''
  const old = node.querySelector<SVGGElement>(':scope > .cv-inside')
  if (!text) { old?.remove(); return }
  if (old?.getAttribute('data-text') === text) return
  old?.remove()
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.setAttribute('class', 'cv-inside')
  g.setAttribute('data-text', text)
  const parts = [s!.added && ['a', `+${s!.added}`], s!.changed && ['c', `~${s!.changed}`], s!.removed && ['r', `−${s!.removed}`]].filter(Boolean) as [string, string][]
  g.innerHTML = `<rect rx="7" ry="7"></rect><text dy="3.6">${parts.map(([c, t]) => `<tspan class="${c}">${t}</tspan>`).join(' ')}</text>`
  node.appendChild(g)
  const t = g.querySelector('text')!
  const w = t.getComputedTextLength() + 12
  const r = g.querySelector('rect')!
  r.setAttribute('width', String(w)); r.setAttribute('height', '15'); r.setAttribute('x', String(-w / 2)); r.setAttribute('y', '-7.5')
  t.setAttribute('text-anchor', 'middle')
  g.setAttribute('transform', `translate(${b.x + b.width - w / 2 - 6}, ${b.y + b.height})`)
}

/**
 * Around the picked parts (a part, or everything a selected decision shaped): what they hold (a
 * package: everything inside, nested packages too), what those touch through a line (the lines and
 * their other ends), the packages that hold a picked part (a folded one stands for it), and the
 * packages that frame the picture.
 */
function neighborhood(map: CanvasMap, sel: string | undefined) {
  const byId = new Map(map.elements.map(e => [e.id, e]))
  const shaped = sel && map.decisions?.some(d => d.id === sel) ? shapedBy(map, sel) : undefined
  const picked = new Set<string>(shaped ? [...shaped.elements.map(e => e.id), ...shaped.relations.map(relationKey), ...shaped.messages.map(m => m.id)] : sel ? [sel] : [])
  const inside = new Set<string>()
  const related = new Set<string>()
  const holding = new Set<string>()
  const context = new Set<string>()
  const ancestors = (id: string) => { const out: string[] = []; for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) out.push(p); return out }
  for (const e of map.elements) if (!picked.has(e.id) && ancestors(e.id).some(p => picked.has(p))) inside.add(e.id)
  const mine = (id: string) => picked.has(id) || inside.has(id)
  for (const r of map.relations) {
    const k = relationKey(r)
    if (mine(r.from) || mine(r.to)) { related.add(k); related.add(r.from); related.add(r.to) }
    if (picked.has(k)) { related.add(r.from); related.add(r.to) }
  }
  for (const m of map.messages ?? []) {
    if (picked.has(m.from) || (m.to && picked.has(m.to))) { related.add(m.id); related.add(m.from); if (m.to) related.add(m.to) }
    if (picked.has(m.id)) { related.add(m.from); if (m.to) related.add(m.to) }
  }
  for (const id of picked) for (const p of ancestors(id)) holding.add(p)
  // The packages that hold a lit box stay as the frame of the picture.
  for (const id of [...picked, ...related, ...inside]) for (const p of ancestors(id)) context.add(p)
  return { picked, inside, related, holding, context }
}

/**
 * The decisions each box carries a pin for: its own tag, and for a package what is inside it too
 * (shown while it is folded: lines with both ends inside count, as they vanish with it).
 */
function pinsByBox(map: CanvasMap) {
  const parentOf = new Map(map.elements.map(e => [e.id, e.parent]))
  const ancestors = (id: string) => { const out: string[] = []; for (let p = parentOf.get(id); p; p = parentOf.get(p)) out.push(p); return out }
  const own = new Map<string, Set<string>>()
  const inside = new Map<string, Set<string>>()
  const put = (m: Map<string, Set<string>>, id: string, d: string) => m.set(id, (m.get(id) ?? new Set()).add(d))
  for (const e of map.elements) {
    if (!e.decision) continue
    put(own, e.id, e.decision)
    for (const g of ancestors(e.id)) put(inside, g, e.decision)
  }
  for (const r of map.relations) {
    if (!r.decision) continue
    const to = new Set(ancestors(r.to))
    for (const g of ancestors(r.from)) if (to.has(g)) put(inside, g, r.decision)
  }
  return { own, inside }
}

const decisionOrder = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1)) || a.localeCompare(b)
const MAX_PINS = 4

/** "D3" tags along a box's top edge, from its left corner: accent while the decision is open, green once made. A click picks the decision. */
function drawPins(node: SVGGraphicsElement, ids: string[], open: Set<string>, b: DOMRect) {
  const key = ids.map(id => (open.has(id) ? `${id}?` : id)).join(' ')
  const old = node.querySelector<SVGGElement>(':scope > .cv-pins')
  if ((old?.getAttribute('data-key') ?? '') === key) return
  old?.remove()
  if (!ids.length) return
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.setAttribute('class', 'cv-pins')
  g.setAttribute('data-key', key)
  g.setAttribute('data-at', `${b.x + 8},${b.y}`)
  node.appendChild(g)
  const shown = ids.length > MAX_PINS ? ids.slice(0, MAX_PINS - 1) : ids
  const labels = [...shown.map(id => ({ id, text: id })), ...(ids.length > shown.length ? [{ id: '', text: `+${ids.length - shown.length}` }] : [])]
  let x = 0
  for (const { id, text } of labels) {
    const pin = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    pin.setAttribute('class', `cv-pin ${!id ? 'more' : open.has(id) ? 'open' : 'made'}`)
    if (id) pin.setAttribute('data-pin', id)
    pin.innerHTML = `<rect rx="4" ry="4" height="16" y="-8"></rect><text dy="3.9" text-anchor="middle">${text}</text>`
    g.appendChild(pin)
    const w = pin.querySelector('text')!.getComputedTextLength() + 10
    pin.querySelector('rect')!.setAttribute('width', String(w))
    pin.querySelector('text')!.setAttribute('x', String(w / 2))
    pin.setAttribute('transform', `translate(${x}, 0)`)
    x += w + 3
  }
  pinZoom(g, Number(node.ownerSVGElement?.getAttribute('data-k')) || 1)
}

/** Zoomed out, pins grow (up to 2.4×) so the decisions still read when the boxes' own text no longer does. */
function pinZoom(g: SVGGElement, k: number) {
  const s = Math.min(2.4, Math.max(1, 0.8 / k)).toFixed(2)
  const t = `translate(${g.getAttribute('data-at')}) scale(${s})`
  if (g.getAttribute('transform') !== t) g.setAttribute('transform', t)
}

/** A box's own outline, measured before any badge or pin was added to it (they would grow it). */
const plainBoxes = new WeakMap<Element, DOMRect>()
function plainBox(node: SVGGraphicsElement): DOMRect | undefined {
  let b = plainBoxes.get(node)
  if (!b) {
    const r = node.getBBox?.()
    if (!r) return undefined
    b = new DOMRect(r.x, r.y, r.width, r.height)
    plainBoxes.set(node, b)
  }
  return b
}

function decorate(svg: SVGSVGElement, map: CanvasMap, o: { selected?: string; glow?: MapDiff; compare?: MapDiff; threads: CanvasThread[] }) {
  const comparedInside = insideChanges(map, o.compare)
  const glowInside = insideChanges(map, o.glow)
  const byId = new Map(map.elements.map(e => [e.id, e]))
  const rels = new Map(map.relations.map(r => [relationKey(r), r]))
  const msgs = new Map((map.messages ?? []).map(m => [m.id, m]))
  const openDecisions = new Set((map.decisions ?? []).filter(d => !d.chosen).map(d => d.id))
  const pins = pinsByBox(map)
  // Everything outside the selection's neighborhood steps back a little.
  const { picked, inside, related, holding, context } = neighborhood(map, o.selected)
  const threadCount = new Map<string, number>()
  for (const t of o.threads) if (t.state === 'open') threadCount.set(t.target, (threadCount.get(t.target) ?? 0) + 1)

  for (const node of svg.querySelectorAll<SVGElement>('[data-target]')) {
    if (node.classList.contains('cv-edge-hit')) continue
    const target = node.getAttribute('data-target')!
    const keys = (node.getAttribute('data-keys') ?? target).split(' ')
    // Collect the classes this part should have, then touch only the ones that differ.
    const want = new Set<string>()
    const add = (c: string) => want.add(c)
    const el = byId.get(target)
    const rel = rels.get(keys[0])
    const msg = msgs.get(target)
    const isGhost = !el && !rel && !msg && !node.classList.contains('cv-cluster')
    const folded = node.classList.contains('cv-node') && node.hasAttribute('data-group')
    const box = node.classList.contains('cv-node') || node.classList.contains('cv-cluster') ? plainBox(node as SVGGraphicsElement) : undefined
    if (isGhost) add('cv-ghost')
    const change = el?.change ?? msg?.change ?? (rel?.change === 'add' ? 'add' : rel?.change === 'delete' ? 'delete' : undefined)
    if (change && !node.classList.contains('cv-cluster')) add(`cv-${change}`)
    const decision = el?.decision ?? rel?.decision ?? msg?.decision
    if (decision && openDecisions.has(decision)) add('cv-open')
    if (picked.size) {
      if (keys.some(k => picked.has(k)) || (folded && holding.has(target))) add('cv-sel')
      else if (keys.some(k => inside.has(k))) add('cv-in')
      else if (keys.some(k => related.has(k))) add('cv-rel')
      else if (keys.some(k => context.has(k))) add('cv-ctx')
      else add('cv-dim')
    }
    if (o.compare) {
      const c = o.compare
      if (c.addedElements.has(target) || keys.some(k => c.addedRelations.has(k)) || c.addedMessages.has(target)) add('cv-new')
      else if (c.changedElements.has(target) || keys.some(k => c.changedRelations.has(k)) || c.changedMessages.has(target)) add('cv-changed')
    }
    if (o.glow) {
      if (o.glow.addedElements.has(target) || keys.some(k => o.glow!.addedRelations.has(k)) || o.glow.addedMessages.has(target)) add('cv-glow')
      else if (o.glow.changedElements.has(target) || keys.some(k => o.glow!.changedRelations.has(k)) || o.glow.changedMessages.has(target)) add('cv-glow-mod')
    }
    // A folded package shows what changed inside it.
    if (folded) {
      const s = o.compare ? comparedInside.get(target) : undefined
      if (s && !want.has('cv-new')) add(s.added ? 'cv-new' : 'cv-changed')
      const g = o.glow ? glowInside.get(target) : undefined
      if (g && !want.has('cv-glow')) add(g.added ? 'cv-glow' : 'cv-glow-mod')
      if (box) insideBadge(node as SVGGraphicsElement, s, box)
    }
    if (box) {
      const ids = new Set([...(pins.own.get(target) ?? []), ...(folded ? pins.inside.get(target) ?? [] : [])])
      drawPins(node as SVGGraphicsElement, [...ids].sort(decisionOrder), openDecisions, box)
    }
    for (const c of CHANGE_CLASS) if (want.has(c) !== node.classList.contains(c)) node.classList.toggle(c)
    // Comment badges on boxes and line labels.
    const count = keys.reduce((n, k) => n + (threadCount.get(k) ?? 0), 0)
    const badge = node.querySelector(':scope > .cv-badge')
    if (count && (node.classList.contains('cv-node') || node.classList.contains('cv-label') || node.classList.contains('cv-actor'))) {
      if (!badge || badge.getAttribute('data-n') !== String(count)) {
        badge?.remove()
        const b = box ?? (node as SVGGraphicsElement).getBBox?.()
        if (!b) continue
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        g.setAttribute('class', 'cv-badge')
        g.setAttribute('data-n', String(count))
        g.setAttribute('transform', `translate(${b.x + b.width - 2}, ${b.y + 2})`)
        g.innerHTML = `<circle r="9"></circle><text text-anchor="middle" dy="3.5">${count}</text>`
        node.appendChild(g)
      }
    } else badge?.remove()
  }
}
