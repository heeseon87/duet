import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** A floating panel anchored to an element; closes on outside click and Escape. */
export function Popover({ anchor, onClose, children, align = 'start', width, className }: {
  anchor: HTMLElement | null
  onClose: () => void
  children: ReactNode
  align?: 'start' | 'end'
  width?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const w = width ?? ref.current?.offsetWidth ?? 240
    const h = ref.current?.offsetHeight ?? 200
    let left = align === 'end' ? r.right - w : r.left
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    let top = r.bottom + 6
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
    setPos({ top, left })
  }, [anchor, align, width])
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key, true)
    }
  }, [anchor, onClose])
  return createPortal(
    <div ref={ref} className={`popover ${className ?? ''}`} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}>
      {children}
    </div>,
    document.body,
  )
}

export function useAnchor<T extends HTMLElement = HTMLButtonElement>() {
  const ref = useRef<T>(null)
  const [open, setOpen] = useState(false)
  return { ref, open, setOpen, toggle: () => setOpen(o => !o), close: () => setOpen(false) }
}

export function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 10) return '방금'
  if (s < 60) return `${s}초 전`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}분 전`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}일 전`
  return new Date(ts).toLocaleDateString('ko-KR')
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

export function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Ticks every second while `active`, for live elapsed counters. */
export function useNow(active: boolean, every = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(t)
  }, [active, every])
  return now
}

export function relPath(path: string, root?: string): string {
  if (root && path.startsWith(root + '/')) return path.slice(root.length + 1)
  return path
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  if (el.tagName === 'INPUT') return !['checkbox', 'radio'].includes((el as HTMLInputElement).type)
  return el.tagName === 'TEXTAREA' || el.isContentEditable
}

/**
 * The key a shortcut reads. With the Korean input source a letter key arrives as its jamo ("ㄹ" for f, "ㅒ" for ⇧o),
 * or as "Process" while the IME composes, so those read as the letter of the key pressed.
 */
export function shortcutKey(e: KeyboardEvent): string {
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1]
  if (!letter || !(e.key === 'Process' || /^[\u3131-\u318e]$/.test(e.key))) return e.key
  return e.shiftKey ? letter : letter.toLowerCase()
}
