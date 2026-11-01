import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EyeOff } from 'lucide-react'
import { local, targetTerminal, useApp } from '../state.ts'
import { shortcutKey } from '../lib/ui.tsx'
import { useCanvas } from '../canvas/store.ts'
import { Composer } from './Composer.tsx'

/**
 * The box over the map that writes to the terminal picked on the rail. Bottom left, clear of the zoom bar; above it
 * when narrow. It can be put away (and stays so); ⌘L brings it back.
 */
export function FloatComposer() {
  const currentTerminal = useApp(targetTerminal)
  const terminal = useApp(s => s.terminals.find(x => x.id === currentTerminal))
  const count = useApp(s => s.terminals.length)
  const deciding = useCanvas(s => s.deciding)
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ width: number; raised: boolean }>()
  const [hidden, setHidden] = useState(() => local.get('float.hidden') === '1')
  const focusNext = useRef(false)

  // Put away, ⌘L (which focuses the box when it is there) brings it back to be typed in.
  useEffect(() => {
    if (!hidden || deciding) return
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || shortcutKey(e).toLowerCase() !== 'l') return
      e.preventDefault()
      focusNext.current = true
      local.set('float.hidden', '0')
      setHidden(false)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [hidden, deciding])
  useEffect(() => {
    if (hidden || !focusNext.current) return
    focusNext.current = false
    box.current?.querySelector('textarea')?.focus()
  }, [hidden])

  // Beside the zoom bar when there is room for a usable box, otherwise the whole width above it.
  useLayoutEffect(() => {
    const el = box.current, host = el?.parentElement
    if (!el || !host) return
    const fit = () => {
      const h = host.getBoundingClientRect()
      const bar = host.querySelector('.zoom-bar')?.getBoundingClientRect()
      const beside = (bar ? bar.left : h.right) - h.left - 20 - 16
      const raised = beside < 360
      setPlace({ width: Math.min(600, raised ? h.width - 40 : beside), raised })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(host)
    const bar = host.querySelector('.zoom-bar')
    if (bar) ro.observe(bar)
    return () => ro.disconnect()
  }, [deciding, hidden])

  if (deciding || hidden) return null
  const status = terminal?.status ?? 'none'
  const said = terminal ? (terminal.status === 'working' ? '일하는 중' : '쉬는 중') : count ? '레일의 터미널 칸에서 보낼 터미널을 골라 줘' : 'Claude Code 터미널에서 /duet을 켜 줘'
  return (
    <div ref={box} className={`float-composer ${place?.raised ? 'raised' : ''}`} style={{ width: place?.width }}>
      <div className="float-head">
        <span className={`float-who ${status}`}>{terminal?.label ?? '터미널 없음'}</span>
        <span className="float-said" title={said}>{said}</span>
        <button className="iconbtn" title="입력창 숨기기 (⌘L로 다시 열기)" onClick={() => { local.set('float.hidden', '1'); setHidden(true); useApp.getState().toast('입력창을 숨겼어 · ⌘L로 다시 열어') }}><EyeOff size={14} /></button>
      </div>
      <Composer floating />
    </div>
  )
}
