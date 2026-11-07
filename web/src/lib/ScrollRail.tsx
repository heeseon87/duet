import { useEffect, useRef, useState } from 'react'

/** How long a scroller counts as scrolling after its last scroll: its thin bars and a rail's thumb stay that long. */
const QUIET_MS = 900
/** How long after the last scroll or wheel the page counts as moving: the map's lit lines hold still that long. */
const STILL_MS = 250

/**
 * Marks a `.quiet-scroll` element `.scrolling` while it scrolls and a little after, so its thin native bars show only
 * then (base.css). One listener for the page, so a scroller needs only the class.
 *
 * Any scroll or wheel (a map zoom too) also marks the page `.page-scrolling`, and the map's lit lines stop flowing
 * meanwhile (canvas.css): each step of the flow repaints the map under the lines, wobbly boxes included, and on a busy
 * GPU that cost the decision pane's scroll half its frames.
 */
export function watchScrolling() {
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
  const root = document.documentElement
  let still: ReturnType<typeof setTimeout>
  const moving = () => {
    root.classList.add('page-scrolling')
    clearTimeout(still)
    still = setTimeout(() => root.classList.remove('page-scrolling'), STILL_MS)
  }
  document.addEventListener('wheel', moving, { capture: true, passive: true })
  document.addEventListener('scroll', e => {
    moving()
    const el = e.target
    if (!(el instanceof Element) || !el.classList.contains('quiet-scroll')) return
    el.classList.add('scrolling')
    clearTimeout(timers.get(el))
    timers.set(el, setTimeout(() => el.classList.remove('scrolling'), QUIET_MS))
  }, { capture: true, passive: true })
}

/** A block of changed lines on the rail: where it stands and how tall it is, in fractions of the scrolled height. */
export type RailTick = { key: string | number; top: number; size: number; kind: 'add' | 'del' | 'mod'; title: string; go: () => void }

/**
 * A scroller's own vertical scrollbar, in place of the native one (`.quiet-scroll.railed`): the blocks of changed lines
 * as ticks that always show (a click goes to the block), over a thin thumb that shows only while scrolling, dragged, or
 * under the pointer. It stands beside the scroller, not in it, and keeps its state here so a scroll redraws the rail,
 * not the scroller's rows. `ticks` is read again whenever the scroller's content is laid out anew, never on a scroll.
 */
export function ScrollRail({ body, ticks }: { body: React.RefObject<HTMLElement | null>; ticks: (body: HTMLElement) => RailTick[] }) {
  const [view, setView] = useState<{ top: number; size: number; bottom: number }>()
  const [marks, setMarks] = useState<RailTick[]>([])
  const [scrolling, setScrolling] = useState(false)
  const [over, setOver] = useState(false)
  const drag = useRef<{ y: number; top: number }>(undefined)
  useEffect(() => {
    const b = body.current
    if (!b) return
    let idle: ReturnType<typeof setTimeout>, frame = 0
    const measure = () => setView(b.scrollHeight > b.clientHeight + 1 ? { top: b.scrollTop / b.scrollHeight, size: b.clientHeight / b.scrollHeight, bottom: b.offsetHeight - b.clientHeight } : undefined)
    const layout = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { measure(); setMarks(ticks(b)) })
    }
    const scrolled = () => {
      measure()
      setScrolling(true)
      clearTimeout(idle)
      idle = setTimeout(() => setScrolling(false), QUIET_MS)
    }
    // The scroller and each of its children: a child growing (a thread, a revealed gap) moves what lies below it.
    const sizes = new ResizeObserver(layout)
    const observe = () => { sizes.disconnect(); sizes.observe(b); for (const c of b.children) sizes.observe(c) }
    const children = new MutationObserver(() => { observe(); layout() })
    children.observe(b, { childList: true })
    observe()
    b.addEventListener('scroll', scrolled, { passive: true })
    layout()
    return () => { sizes.disconnect(); children.disconnect(); b.removeEventListener('scroll', scrolled); clearTimeout(idle); cancelAnimationFrame(frame) }
  }, [body, ticks])
  if (!view) return null
  // Pressed off the thumb, the view centers there first; either way the thumb then follows the pointer.
  const press = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = body.current
    if (!b || e.button !== 0) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    if (!(e.target as Element).classList.contains('scroll-rail-thumb')) b.scrollTop = ((e.clientY - r.top) / r.height) * b.scrollHeight - b.clientHeight / 2
    drag.current = { y: e.clientY, top: b.scrollTop }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = body.current, d = drag.current
    if (b && d) b.scrollTop = d.top + ((e.clientY - d.y) * b.scrollHeight) / e.currentTarget.getBoundingClientRect().height
  }
  const release = () => { drag.current = undefined }
  // Beside the scroller, a wheel over the rail scrolls it by hand (⌘/ctrl+wheel stays a zoom's).
  const wheel = (e: React.WheelEvent) => { if (!e.metaKey && !e.ctrlKey) body.current?.scrollBy({ top: e.deltaY, left: e.deltaX }) }
  const pct = (n: number) => `${n * 100}%`
  return (
    <div className={`scroll-rail${scrolling || over ? ' shown' : ''}`} style={{ bottom: view.bottom }}
      onPointerDown={press} onPointerMove={move} onPointerUp={release} onPointerCancel={release}
      onPointerEnter={() => setOver(true)} onPointerLeave={() => setOver(false)} onWheel={wheel}>
      <div className="scroll-rail-thumb" style={{ top: `min(${pct(view.top)}, calc(100% - max(16px, ${pct(view.size)})))`, height: pct(view.size) }} />
      {marks.map(t => (
        <span key={t.key} className={`scroll-rail-tick ${t.kind}`} title={t.title} style={{ top: pct(t.top), height: `max(3px, ${pct(t.size)})` }}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }} onClick={t.go} />
      ))}
    </div>
  )
}
