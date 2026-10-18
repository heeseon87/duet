import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type Point = { x: number; y: number }

export type MenuEntry =
  | { kind: 'head'; label: string; sub?: string }
  | { kind: 'sep' }
  | { kind: 'item'; key: string; icon: ReactNode; label: string; sub?: string; hint?: string; disabled?: boolean; run: () => void }

/**
 * A card that floats at a screen point (where the right click was), kept inside the window.
 * It closes on Esc; unless `sticky`, also on a click or a wheel outside it, or when the window changes.
 */
export function FloatAt({ at, onClose, width, sticky, className, children }: {
  at: Point
  onClose: () => void
  width?: number
  sticky?: boolean
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Point | null>(null)
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? width ?? 240
    const h = ref.current?.offsetHeight ?? 200
    const x = Math.max(8, Math.min(at.x, window.innerWidth - w - 8))
    const y = at.y + h > window.innerHeight - 8 ? Math.max(8, at.y - h) : at.y
    setPos({ x, y })
  }, [at.x, at.y, width])
  useEffect(() => {
    const outside = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose() } }
    document.addEventListener('keydown', key, true)
    if (!sticky) {
      document.addEventListener('mousedown', outside, true)
      document.addEventListener('wheel', outside, true)
      window.addEventListener('blur', onClose)
      window.addEventListener('resize', onClose)
    }
    return () => {
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('mousedown', outside, true)
      document.removeEventListener('wheel', outside, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose, sticky])
  return createPortal(
    <div ref={ref} className={`popover ${className ?? ''}`} style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, width }} onContextMenu={e => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  )
}

/** The right-click menu: ↑↓ to move, ⏎ to run, Esc to close. */
export function ContextMenu({ at, entries, onClose }: { at: Point; entries: MenuEntry[]; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null)
  const items = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])]
  useEffect(() => { items()[0]?.focus({ preventScroll: true }) }, [])
  return (
    <FloatAt at={at} onClose={onClose} width={250} className="ctx-menu">
      <div
        ref={list}
        role="menu"
        onKeyDown={e => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          e.preventDefault()
          const all = items()
          const i = all.indexOf(document.activeElement as HTMLButtonElement)
          all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
        }}
      >
        {entries.map((m, i) => {
          if (m.kind === 'sep') return <div key={`sep${i}`} className="menu-sep" />
          if (m.kind === 'head') return <div key={`head${i}`} className="menu-label ctx-head"><span className="ellipsis">{m.label}</span>{m.sub && <span className="ctx-head-sub">{m.sub}</span>}</div>
          return (
            <button key={m.key} role="menuitem" className="menu-item" disabled={m.disabled} onClick={() => { onClose(); m.run() }}>
              <span className="ctx-icon">{m.icon}</span>
              <span className="grow ellipsis">{m.label}{m.sub && <span className="ctx-sub"> {m.sub}</span>}</span>
              {m.hint && <kbd>{m.hint}</kbd>}
            </button>
          )
        })}
      </div>
    </FloatAt>
  )
}
