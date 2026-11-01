import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EyeOff } from 'lucide-react'
import { local, targetTerminal, useApp, useTranscript } from '../state.ts'
import { shortcutKey } from '../lib/ui.tsx'
import { useCanvas } from '../canvas/store.ts'
import { Composer } from './Composer.tsx'
import { lastWords, waitLabel } from './transcript.ts'

/**
 * The conversation over the map while the panel is folded: what Claude said last (or what it waits for) and the same
 * draft as the panel's composer. Bottom left, clear of the zoom bar; above it when narrow. It can be put away (and stays
 * so, the panel opening and closing or not); ⌘L brings it back.
 */
export function FloatComposer() {
  const sideOpen = useApp(s => s.sideOpen)
  const sideWidth = useApp(s => s.sideWidth)
  const setSide = useApp(s => s.setSide)
  const session = useApp(s => s.sessions.find(x => x.id === s.currentSession))
  const currentTerminal = useApp(targetTerminal)
  const terminal = useApp(s => s.terminals.find(x => x.id === currentTerminal))
  const t = useTranscript(currentTerminal ? undefined : session?.id)
  const deciding = useCanvas(s => s.deciding)
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ width: number; raised: boolean }>()
  const [hidden, setHidden] = useState(() => local.get('float.hidden') === '1')
  const focusNext = useRef(false)

  // Put away, ⌘L (which focuses the box when it is there) brings it back to be typed in.
  useEffect(() => {
    if (!hidden || sideOpen || deciding) return
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || shortcutKey(e).toLowerCase() !== 'l') return
      e.preventDefault()
      focusNext.current = true
      local.set('float.hidden', '0')
      setHidden(false)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [hidden, sideOpen, deciding])
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
  }, [sideOpen, deciding, hidden])

  if (sideOpen || deciding || hidden) return null
  const waits = t?.waiting() ?? []
  const said = waits.length ? undefined : t && lastWords(t.blocks)
  const unfold = () => setSide(sideWidth, true)
  const status = currentTerminal ? 'terminal' : session?.status ?? 'idle'
  return (
    <div ref={box} className={`float-composer ${place?.raised ? 'raised' : ''}`} style={{ width: place?.width }}>
      <div className="float-head">
        <span className={`float-who ${status}`}>{currentTerminal ? terminal?.label ?? '터미널' : 'Claude'}</span>
        {waits.length
          ? <button className="float-said wait" title="대화를 펼쳐서 답하기 (⌘3)" onClick={unfold}>{waitLabel(waits)}</button>
          : <span className="float-said" title={said?.text}>{said?.text ?? (session?.title || '새 대화')}</span>}
        <button className="iconbtn" title="입력창 숨기기 (⌘L로 다시 열기)" onClick={() => { local.set('float.hidden', '1'); setHidden(true); useApp.getState().toast('입력창을 숨겼어 · ⌘L로 다시 열어') }}><EyeOff size={14} /></button>
      </div>
      {currentTerminal ? <Composer terminal floating /> : <Composer session={session} transcript={t} floating />}
    </div>
  )
}
